"""EA FC-style "Match Stats" panel: home vs away team totals, optionally over
the last N minutes only. Pure and deterministic, read straight off the event
stream; PPDA reuses metrics.compute_ppda.

Definitions:
  * possession -- share of the two teams' passes + carries (the on-ball
    actions of the team in possession). Not live_analytics' "touches" split,
    which also counts the defending side's tackles, pressures and fouls.
  * shots -- total, with on target (goal or saved) in brackets.
  * pass accuracy -- completed / attempted passes.
  * duels won -- a duel event's team when it is "won", the other team when
    it is "lost".
  * cards -- value = yellows + 2 x reds (lower is better).
The window is [to_min - last_minutes + 1, to_min] by event minute, where
to_min is the latest minute in the events; the score is always the
full-match score up to that minute, whatever the window.
"""
from __future__ import annotations

from typing import Any

from agents.analyst0.live_rating import ON_PITCH_TYPES
from agents.analyst0.match_maps import event_field
from agents.analyst0.metrics import compute_ppda, opponent_of

TEAMS = ("home", "away")

# (key, French label, higher_is_better), in panel order.
STATS: tuple[tuple[str, str, bool], ...] = (
    ("possession", "Possession", True),
    ("xg", "Buts attendus (xG)", True),
    ("shots", "Tirs (cadrés)", True),
    ("pass_accuracy", "Précision des passes", True),
    ("ppda", "PPDA (pressing)", False),
    ("duels_won", "Duels gagnés", True),
    ("interceptions", "Interceptions", True),
    ("tackles_won", "Tacles réussis", True),
    ("fouls", "Fautes", False),
    ("cards", "Cartons", False),
)
STAT_KEYS = tuple(k for k, _, _ in STATS)
_NONE = "–"


def _minute_of(e: Any) -> int:
    minute = event_field(e, "minute")
    if minute is not None:
        return int(minute)
    return int(event_field(e, "match_clock_ms", 0) or 0) // 60000


def _fr(x: float, decimals: int) -> str:
    return f"{x:.{decimals}f}".replace(".", ",")


def _pct(x: float) -> str:
    return f"{round(x)} %"


def _cards_display(yellow: int, red: int) -> str:
    parts = ([f"{yellow} 🟨"] if yellow else []) + ([f"{red} 🟥"] if red else [])
    return " ".join(parts) or "0"


def compute_match_stats(events: list[Any], last_minutes: int | None = None) -> dict:
    on_pitch = [e for e in events if event_field(e, "type") in ON_PITCH_TYPES]
    minute = max((_minute_of(e) for e in on_pitch), default=0)
    from_min = max(0, minute - last_minutes + 1) if last_minutes else 0

    score = {t: 0 for t in TEAMS}
    for e in on_pitch:
        if event_field(e, "type") == "shot" and event_field(e, "outcome") == "goal" and event_field(e, "team") in TEAMS:
            score[event_field(e, "team")] += 1

    window = [e for e in on_pitch if from_min <= _minute_of(e) <= minute]
    zero = {t: 0 for t in TEAMS}
    on_ball, xg = dict(zero), {t: 0.0 for t in TEAMS}
    shots, on_target, passes, completed = dict(zero), dict(zero), dict(zero), dict(zero)
    duels, interceptions, tackles, fouls, yellows, reds = (dict(zero) for _ in range(6))
    for e in window:
        etype, team = event_field(e, "type"), event_field(e, "team")
        if team not in TEAMS:
            continue
        if etype in ("pass", "carry"):
            on_ball[team] += 1
        if etype == "pass":
            passes[team] += 1
            completed[team] += event_field(e, "outcome") == "complete"
        elif etype == "shot":
            shots[team] += 1
            xg[team] += float(event_field(e, "xg", 0.0) or 0.0)
            on_target[team] += event_field(e, "outcome") in ("goal", "saved")
        elif etype == "duel":
            duels[team if event_field(e, "outcome") == "won" else opponent_of(team)] += 1
        elif etype == "interception":
            interceptions[team] += 1
        elif etype == "tackle" and event_field(e, "outcome") == "won":
            tackles[team] += 1
        elif etype == "foul":
            fouls[team] += 1
        elif etype == "card":
            (reds if event_field(e, "card_type") == "red" else yellows)[team] += 1

    rows: dict[str, tuple[dict[str, float], dict[str, str]]] = {}

    total_on_ball = on_ball["home"] + on_ball["away"]
    home_pos = round(100.0 * on_ball["home"] / total_on_ball, 1) if total_on_ball else 50.0
    home_pos_display = round(home_pos)
    rows["possession"] = (
        {"home": home_pos, "away": round(100.0 - home_pos, 1)},
        {"home": f"{home_pos_display} %", "away": f"{100 - home_pos_display} %"},
    )
    rows["xg"] = ({t: round(xg[t], 2) for t in TEAMS}, {t: _fr(xg[t], 2) for t in TEAMS})
    rows["shots"] = ({t: float(shots[t]) for t in TEAMS}, {t: f"{shots[t]} ({on_target[t]})" for t in TEAMS})
    acc = {t: (100.0 * completed[t] / passes[t]) if passes[t] else None for t in TEAMS}
    rows["pass_accuracy"] = (
        {t: round(acc[t], 1) if acc[t] is not None else 0.0 for t in TEAMS},
        {t: _pct(acc[t]) if acc[t] is not None else _NONE for t in TEAMS},
    )
    ppda = {t: compute_ppda(window, t, 0, 10**12) for t in TEAMS}
    rows["ppda"] = (
        {t: float(ppda[t]) if ppda[t] is not None else 0.0 for t in TEAMS},
        {t: _fr(ppda[t], 1) if ppda[t] is not None else _NONE for t in TEAMS},
    )
    for key, counts in (("duels_won", duels), ("interceptions", interceptions), ("tackles_won", tackles),
                        ("fouls", fouls)):
        rows[key] = ({t: float(counts[t]) for t in TEAMS}, {t: str(counts[t]) for t in TEAMS})
    rows["cards"] = (
        {t: float(yellows[t] + 2 * reds[t]) for t in TEAMS},
        {t: _cards_display(yellows[t], reds[t]) for t in TEAMS},
    )

    stats = []
    for key, label, higher_is_better in STATS:
        values, displays = rows[key]
        stats.append({
            "key": key, "label": label,
            "home": values["home"], "away": values["away"],
            "home_display": displays["home"], "away_display": displays["away"],
            "higher_is_better": higher_is_better,
        })
    return {
        "minute": minute,
        "score": score,
        "window": {"from_min": from_min, "to_min": minute},
        "stats": stats,
    }
