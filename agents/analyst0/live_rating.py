"""Live player ratings (3.0-10.0, broadcast style) and a live man of the match.

Pure, deterministic, no LLM calls. Every player starts at BASE_RATING (6.0)
and the events up to minute t add or remove fixed points; the rating is
clamped to [RATING_MIN, RATING_MAX] and shown with one decimal.

Scale (raw points, before role weighting):
  Attack      goal +1.0 (+0.2 more when the shot's xG < 0.15); assist +0.6;
              key pass +0.15; non-goal shot +0.3 x xG (+0.05 when saved, i.e.
              on target); xT created by completed passes / carries
              +0.5 x xT (positive deltas only) capped at +0.8 in total;
              dribble won +0.05 / lost -0.03.
  Possession  pass accuracy >= 85 % on >= 20 attempts +0.1, < 65 % on >= 15
              attempts -0.1; ball loss -0.03 each.
  Defence     tackle won / interception +0.06; duel won +0.03 / lost -0.03;
              threat prevented +0.5 x xT stopped; GK save +0.15 + 0.1 x xG of
              the saved shot; goal conceded: GK -0.3, every CB/FB -0.1.
  Discipline  foul -0.05; yellow -0.3; red -1.0.
Role weighting: defence points x1.3 for GK/CB/FB (saves and goals conceded
are defence points, so a GK's -0.3 per goal reads -0.39); attack points x1.2
for FW; everything else x1.0. No team-result bonus, no physical data.

Definitions the event stream forces us to pin down:
  * Assist  -- the latest pass of the scoring team in the goal's possession
    is complete and its recipient is the scorer (the scorer may carry or
    dribble before shooting). Credited at the goal's minute.
  * Key pass -- a completed pass whose recipient's very next on-ball action
    (pass / carry / dribble / shot) is a shot that is NOT a goal (a goal makes
    it an assist instead -- one pass is never both). Credited at the shot.
  * Ball loss -- a possession_change with reason "turnover" attributed to the
    player (player_id set: the simulator's "lost it" action). Failed passes
    are scored only through pass accuracy and tackled dribbles only through
    "Dribbles", so an attributed turnover straight after the same player's
    failed pass / dribble is not charged again.
  * Duels -- the duel event's player gets its outcome, its opponent_id the
    opposite one.
  * Threat prevented -- the same per-action value as
    match_maps.compute_threat_prevented (won tackles and interceptions, the
    latter valued at the intercepted pass's destination), via its helpers.
  * Saves credit the opposing team's GK and goals conceded its GK / CB / FB,
    all from player_roles_by_match; without roles nobody gets them.

Implementation: one pass over the time-sorted events, snapshotting every
player's rating at the end of each minute, so the per-minute series costs one
walk rather than one recomputation per minute.
"""
from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from agents.analyst0.match_maps import _intercepted_pass_target, event_field, event_location
from agents.analyst0.metrics import direction_of, opponent_of, successful_action_xt, xt_value
from agents.analyst0.player_tags import team_for

BASE_RATING = 6.0
RATING_MIN = 3.0
RATING_MAX = 10.0
MOTM_MARGIN = 0.1
XT_FACTOR = 0.5
XT_CAP = 0.8
DELTA_WINDOW_MIN = 10
_EPS = 1e-9

ATTACK, POSSESSION, DEFENCE, DISCIPLINE = "attack", "possession", "defence", "discipline"

# (key, French label, category) -- also the breakdown order.
ITEMS: tuple[tuple[str, str, str], ...] = (
    ("goal", "But", ATTACK),
    ("assist", "Passe décisive", ATTACK),
    ("key_pass", "Passe clé", ATTACK),
    ("shots", "Tirs (xG)", ATTACK),
    ("xt", "Menace créée (xT)", ATTACK),
    ("dribbles", "Dribbles", ATTACK),
    ("pass_accuracy", "Précision de passe", POSSESSION),
    ("ball_loss", "Pertes de balle", POSSESSION),
    ("tackles", "Tacles/interceptions", DEFENCE),
    ("duels", "Duels", DEFENCE),
    ("threat", "Menace évitée", DEFENCE),
    ("saves", "Arrêts", DEFENCE),
    ("conceded", "Buts encaissés", DEFENCE),
    ("fouls", "Fautes", DISCIPLINE),
    ("cards", "Cartons", DISCIPLINE),
)
_KEYS = tuple(k for k, _, _ in ITEMS)

ON_PITCH_TYPES = frozenset({
    "pass", "shot", "carry", "dribble", "tackle", "interception", "duel", "pressure",
    "possession_change", "foul", "card",
})
_ON_BALL = frozenset({"pass", "carry", "dribble", "shot"})
_DEFENSIVE_ROLES = frozenset({"GK", "CB", "FB"})
_BACK_LINE = frozenset({"CB", "FB"})

METHOD = (
    "Note live sur 10 : chaque joueur part de 6,0 et chaque action jusqu'à la minute choisie ajoute ou retire "
    "des points selon un barème fixe (buts, passes décisives, xG, xT créé plafonné, duels, menace évitée, "
    "arrêts, fautes, cartons), pondéré ×1,3 en défense pour GK/CB/FB et ×1,2 en attaque pour les FW ; "
    "barème calibré à la main sur données synthétiques, sans bonus de résultat ni données physiques."
)


def _multipliers(role: str | None) -> dict[str, float]:
    return {
        ATTACK: 1.2 if role == "FW" else 1.0,
        POSSESSION: 1.0,
        DEFENCE: 1.3 if role in _DEFENSIVE_ROLES else 1.0,
        DISCIPLINE: 1.0,
    }


def _round1(x: float) -> float:
    """One decimal, half away from zero (6.25 -> 6.3), immune to float noise."""
    return math.copysign(math.floor(abs(x) * 10 + 0.5 + _EPS) / 10, x) + 0.0


class _Player:
    __slots__ = ("pid", "role", "mult", "pts", "cnt", "xt_raw", "pass_att", "pass_comp", "contrib")

    def __init__(self, pid: str, role: str | None):
        self.pid = pid
        self.role = role
        self.mult = _multipliers(role)
        self.pts = dict.fromkeys(_KEYS, 0.0)
        self.cnt = dict.fromkeys(_KEYS, 0)
        self.xt_raw = 0.0
        self.pass_att = 0
        self.pass_comp = 0
        self.contrib = 0.0  # xG + xT, the MOTM tie-break

    def add(self, key: str, points: float, count: int = 1) -> None:
        self.pts[key] += points
        self.cnt[key] += count

    def _pass_accuracy_points(self) -> float:
        if self.pass_att >= 20 and self.pass_comp / self.pass_att >= 0.85:
            return 0.1
        if self.pass_att >= 15 and self.pass_comp / self.pass_att < 0.65:
            return -0.1
        return 0.0

    def raw_points(self, key: str) -> float:
        if key == "xt":
            return min(XT_FACTOR * self.xt_raw, XT_CAP)
        if key == "pass_accuracy":
            return self._pass_accuracy_points()
        return self.pts[key]

    def rating(self) -> float:
        total = BASE_RATING
        for key, _, cat in ITEMS:
            total += self.mult[cat] * self.raw_points(key)
        return min(RATING_MAX, max(RATING_MIN, total))

    def breakdown(self) -> list[dict]:
        rows = []
        for key, label, cat in ITEMS:
            count = self.pass_att if key == "pass_accuracy" else self.cnt[key]
            if count <= 0:
                continue
            rows.append({"label": label, "points": round(self.mult[cat] * self.raw_points(key), 3) + 0.0,
                         "count": count})
        return rows


def _minute_of(e: Any) -> int:
    minute = event_field(e, "minute")
    if minute is not None:
        return int(minute)
    return int(event_field(e, "match_clock_ms", 0) or 0) // 60000


def _fr_number(x: float, decimals: int = 2) -> str:
    text = f"{x:+.{decimals}f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def _motm_reason(player: _Player) -> str:
    items = []
    for key, label, cat in ITEMS:
        count = player.pass_att if key == "pass_accuracy" else player.cnt[key]
        pts = player.mult[cat] * player.raw_points(key)
        if count > 0 and pts > _EPS:
            if key == "pass_accuracy":
                text = f"{round(100 * player.pass_comp / player.pass_att)} % de passes"
            else:
                text = label if count == 1 else f"{label} ×{count}"
            items.append((pts, text))
    items.sort(key=lambda it: -it[0])
    parts = []
    for i, (pts, text) in enumerate(items[:3]):
        if i > 0 and text[:1].isupper():
            text = text[:1].lower() + text[1:]
        parts.append(f"{text} ({_fr_number(pts)})")
    return ", ".join(parts)


def track_motm(
    snapshots: list[tuple[int, Mapping[str, tuple[float, float]]]],
) -> tuple[str | None, int | None, list[dict]]:
    """Man of the match over time with hysteresis.

    `snapshots` is [(minute, {player_id: (rating, xg_plus_xt)})] in minute
    order. The best player is the highest rating, ties broken by the higher
    xG + xT contribution (then player_id, for determinism). Nobody leads
    until someone is above the 6.0 base; after that a challenger must beat
    the current leader by >= MOTM_MARGIN to take over. Returns
    (leader_id, leader_since_minute, leader_history -- changes only)."""
    leader: str | None = None
    since: int | None = None
    history: list[dict] = []
    for minute, ratings in snapshots:
        if not ratings:
            continue
        best = min(ratings, key=lambda p: (-ratings[p][0], -ratings[p][1], p))
        best_rating = ratings[best][0]
        if leader is None:
            if best_rating > BASE_RATING + _EPS:
                leader, since = best, minute
                history.append({"minute": minute, "player_id": best})
        elif best != leader:
            leader_rating = ratings.get(leader, (BASE_RATING, 0.0))[0]
            if best_rating >= leader_rating + MOTM_MARGIN - _EPS:
                leader, since = best, minute
                history.append({"minute": minute, "player_id": best})
    return leader, since, history


def compute_live_ratings(
    events: list[Any],
    player_names: Mapping[str, str] | None = None,
    roles: Mapping[str, str] | None = None,
    minute: int | None = None,
) -> dict:
    """Ratings for every player at `minute` (default: the latest minute in
    the events), each with its breakdown and per-minute series, plus the
    hysteresis MOTM. Returns {minute, players, motm, leader_history, method}."""
    names = dict(player_names or {})
    roles = dict(roles or {})
    on_pitch = [e for e in events if event_field(e, "type") in ON_PITCH_TYPES]
    on_pitch.sort(key=lambda e: int(event_field(e, "match_clock_ms", 0) or 0))  # stable
    upto = minute if minute is not None else max((_minute_of(e) for e in on_pitch), default=0)
    upto = max(0, int(upto))

    # Roster: everyone with a role plus everyone the events up to `upto` name.
    teams: dict[str, str] = {}
    event_names: dict[str, str] = {}
    roster: list[str] = list(roles)
    for e in on_pitch:
        if _minute_of(e) > upto:
            break
        pid = str(event_field(e, "player_id") or "")
        if pid:
            teams.setdefault(pid, str(event_field(e, "team")))
            if event_field(e, "player_name"):
                event_names.setdefault(pid, str(event_field(e, "player_name")))
        for key in ("player_id", "recipient_id", "opponent_id", "target_player_id"):
            other = event_field(e, key)
            if other:
                roster.append(str(other))
    players: dict[str, _Player] = {}
    for pid in roster:
        if pid not in players and team_for(pid, teams) in ("home", "away"):
            players[pid] = _Player(pid, roles.get(pid))
    team_of = {pid: team_for(pid, teams) for pid in players}
    keepers = {t: sorted(p for p in players if team_of[p] == t and roles.get(p) == "GK") for t in ("home", "away")}
    back_line = {t: sorted(p for p in players if team_of[p] == t and roles.get(p) in _BACK_LINE) for t in ("home", "away")}

    series: dict[str, list[float]] = {pid: [] for pid in players}
    snapshots: list[tuple[int, dict[str, tuple[float, float]]]] = []

    def snapshot(m: int) -> None:
        current = {}
        for pid, p in players.items():
            r = p.rating()
            series[pid].append(r)
            current[pid] = (r, p.contrib)
        snapshots.append((m, current))

    def get(pid: Any) -> _Player | None:
        return players.get(str(pid)) if pid else None

    last_pass: dict[str, tuple[Any, str, str | None, bool]] = {}  # team -> (possession, passer, recipient, complete)
    pending_key_pass: tuple[str, Any, str, str] | None = None     # (team, possession, passer, recipient)
    last_on_ball: tuple[str, bool] | None = None                   # (player, failed)

    cur = 0
    for idx, e in enumerate(on_pitch):
        m = _minute_of(e)
        while cur < m and cur <= upto:
            snapshot(cur)
            cur += 1
        if m > upto:
            break
        etype = event_field(e, "type")
        team = event_field(e, "team")
        pid = str(event_field(e, "player_id") or "")
        possession = event_field(e, "possession_id")
        player = get(pid)

        if etype in _ON_BALL:
            kp = pending_key_pass
            pending_key_pass = None
        else:
            kp = None

        if etype == "pass":
            complete = event_field(e, "outcome") == "complete"
            recipient = event_field(e, "recipient_id")
            if player is not None:
                player.pass_att += 1
                player.pass_comp += complete
            last_pass[team] = (possession, pid, str(recipient) if recipient else None, complete)
            if complete and recipient:
                pending_key_pass = (team, possession, pid, str(recipient))
            last_on_ball = (pid, not complete)
        elif etype == "carry":
            last_on_ball = (pid, False)
        elif etype == "dribble":
            won = event_field(e, "outcome") in ("complete", "nutmeg")
            if player is not None:
                player.add("dribbles", 0.05 if won else -0.03)
            last_on_ball = (pid, not won)
        elif etype == "shot":
            last_on_ball = (pid, False)
            xg = float(event_field(e, "xg", 0.0) or 0.0)
            outcome = event_field(e, "outcome")
            if player is not None:
                player.contrib += xg
            if outcome == "goal":
                if player is not None:
                    player.add("goal", 1.0 + (0.2 if xg < 0.15 else 0.0))
                lp = last_pass.get(team)
                if lp is not None and lp[0] == possession and lp[3] and lp[2] == pid and lp[1] != pid:
                    passer = get(lp[1])
                    if passer is not None:
                        passer.add("assist", 0.6)
                conceding = opponent_of(team)
                for gk in keepers.get(conceding, ()):
                    players[gk].add("conceded", -0.3)
                for d in back_line.get(conceding, ()):
                    players[d].add("conceded", -0.1)
            else:
                if player is not None:
                    player.add("shots", 0.3 * xg + (0.05 if outcome == "saved" else 0.0))
                if kp is not None and kp[0] == team and kp[1] == possession and kp[3] == pid:
                    passer = get(kp[2])
                    if passer is not None:
                        passer.add("key_pass", 0.15)
                if outcome == "saved":
                    for gk in keepers.get(opponent_of(team), ()):
                        players[gk].add("saves", 0.15 + 0.1 * xg)
        elif etype in ("tackle", "interception"):
            if etype == "interception" or event_field(e, "outcome") == "won":
                if player is not None and team in ("home", "away"):
                    player.add("tackles", 0.06)
                    if etype == "interception":
                        target = _intercepted_pass_target(on_pitch, idx)
                        valued_at = target if target is not None else event_location(event_field(e, "location"))
                    else:
                        valued_at = event_location(event_field(e, "location"))
                    stopped = xt_value(valued_at, direction_of(opponent_of(team)))
                    player.add("threat", XT_FACTOR * stopped)
        elif etype == "duel":
            won = event_field(e, "outcome") == "won"
            opponent = get(event_field(e, "opponent_id"))
            if player is not None:
                player.add("duels", 0.03 if won else -0.03)
            if opponent is not None:
                opponent.add("duels", -0.03 if won else 0.03)
        elif etype == "possession_change":
            if event_field(e, "reason") == "turnover" and player is not None:
                already_scored = last_on_ball is not None and last_on_ball == (pid, True)
                if not already_scored:
                    player.add("ball_loss", -0.03)
        elif etype == "foul":
            if player is not None:
                player.add("fouls", -0.05)
        elif etype == "card":
            if player is not None:
                player.add("cards", -1.0 if event_field(e, "card_type") == "red" else -0.3)

        # xT created by completed passes / carries (positive deltas only).
        if etype in ("pass", "carry") and player is not None:
            delta = successful_action_xt(e)
            if delta is not None and delta > 0:
                player.xt_raw += delta
                player.cnt["xt"] += 1
                player.contrib += delta

    while cur <= upto:
        snapshot(cur)
        cur += 1

    leader, since, history = track_motm(snapshots)

    rows = []
    for pid, p in players.items():
        s = series[pid]
        now = _round1(s[upto])
        then = _round1(s[upto - DELTA_WINDOW_MIN]) if upto >= DELTA_WINDOW_MIN else BASE_RATING
        rows.append({
            "player_id": pid,
            "number": pid.rsplit("_", 1)[-1],
            "name": names.get(pid) or event_names.get(pid) or pid,
            "team": team_of[pid],
            "position": roles.get(pid),
            "rating": now,
            "delta_10min": _round1(now - then),
            "breakdown": p.breakdown(),
            "series": [{"minute": i, "rating": _round1(r)} for i, r in enumerate(s)],
            "_sort": (-s[upto], -p.contrib, pid),
        })
    rows.sort(key=lambda r: r["_sort"])
    for r in rows:
        del r["_sort"]

    motm = None
    if leader is not None:
        lp = players[leader]
        motm = {
            "player_id": leader,
            "name": names.get(leader) or event_names.get(leader) or leader,
            "rating": _round1(series[leader][upto]),
            "leader_since_minute": since,
            "reason": _motm_reason(lp),
        }

    return {"minute": upto, "players": rows, "motm": motm, "leader_history": history, "method": METHOD}
