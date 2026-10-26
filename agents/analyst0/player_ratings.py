"""FIFA-style player ratings and per-player heatmaps for one match.

Pure, deterministic, no LLM calls. Every raw number is read off the match's
own event stream / synthetic position track, and reuses the existing
analytics instead of re-deriving them:
  * xT added      -- metrics.successful_action_xt (Markov xT grid), positive
                     deltas only (a backward pass adds no threat, it isn't
                     penalised either);
  * threat prevented -- match_maps.compute_threat_prevented;
  * distance / top speed / sprints -- player_tags.compute_player_tags.

Attributes are *relative to this match*: each component is percentile-ranked
across every player in the match (min-rank, so tied players -- e.g. all the
non-shooters -- share the bottom), blended, and mapped to
ATTRIBUTE_FLOOR + ATTRIBUTE_SPAN * percentile (35..99, nobody shows 0). A 99
means "best in this match at this", not "world class".

The overall rating is a weighted blend of the six attributes -- position-aware
when the player's role is known -- plus a flat bonus per goal, clamped to
RATING_MIN..RATING_MAX.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any

from agents.analyst0.match_maps import compute_threat_prevented
from agents.analyst0.metrics import direction_of, successful_action_xt
from agents.analyst0.player_tags import compute_player_tags, team_for
from datagen.schema import PITCH_X_MAX, PITCH_Y_MAX

ATTRIBUTES = ("passing", "shooting", "pace", "defending", "work_rate", "involvement")
ATTRIBUTE_FLOOR = 35
ATTRIBUTE_SPAN = 64
RATING_MIN = 40
RATING_MAX = 99
GOAL_BONUS = 4
# Completion % is shrunk toward the match-wide rate by this many "phantom"
# passes, so 3/3 doesn't outrank 45/50 -- this is the volume weighting.
PASS_PCT_PRIOR_PASSES = 5

# On-ball actions that count as a touch (passes received are tracked apart).
TOUCH_TYPES = frozenset({"pass", "shot", "carry", "dribble", "tackle", "interception", "duel"})

# Component weights within each attribute (each row sums to 1).
COMPONENT_WEIGHTS: dict[str, dict[str, float]] = {
    "passing": {"pass_pct_shrunk": 0.45, "passes_attempted": 0.20, "xt_passes": 0.35},
    "shooting": {"xg": 0.50, "goals": 0.25, "shots_on_target": 0.25},
    "pace": {"top_speed_kmh": 0.70, "sprints": 0.30},
    "defending": {"ball_wins": 0.50, "threat_prevented": 0.50},
    "work_rate": {"distance_km": 0.60, "sprints": 0.40},
    "involvement": {"touches": 0.60, "passes_received": 0.40},
}

# Overall-rating weights per role group (each row sums to 1).
RATING_WEIGHTS: dict[str, dict[str, float]] = {
    "default": {"passing": 0.22, "shooting": 0.14, "pace": 0.10, "defending": 0.18, "work_rate": 0.14, "involvement": 0.22},
    "goalkeeper": {"passing": 0.35, "shooting": 0.00, "pace": 0.05, "defending": 0.40, "work_rate": 0.05, "involvement": 0.15},
    "defender": {"passing": 0.20, "shooting": 0.04, "pace": 0.10, "defending": 0.36, "work_rate": 0.12, "involvement": 0.18},
    "midfielder": {"passing": 0.30, "shooting": 0.10, "pace": 0.08, "defending": 0.14, "work_rate": 0.16, "involvement": 0.22},
    "forward": {"passing": 0.16, "shooting": 0.38, "pace": 0.14, "defending": 0.04, "work_rate": 0.10, "involvement": 0.18},
}
ROLE_GROUP = {"GK": "goalkeeper", "CB": "defender", "FB": "defender", "CM": "midfielder", "WM": "midfielder", "FW": "forward"}

METHOD = (
    "Notes sur match synthétique : chaque attribut classe en centile les chiffres d'événements/tracking du joueur "
    "par rapport à tous les autres joueurs du match (35-99) ; la note globale est un mélange pondéré par poste "
    "plus un bonus par but -- relative à ce match uniquement, pas une note de scouting calibrée."
)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _percentiles(values: Mapping[str, float]) -> dict[str, float]:
    """Min-rank percentile in [0, 1]: share of the *other* players strictly
    below this one. Ties share the lower rank; a single player gets 0."""
    ordered = sorted(values.values())
    n = len(ordered)
    out: dict[str, float] = {}
    for pid, v in values.items():
        below = _count_below(ordered, v)
        out[pid] = below / (n - 1) if n > 1 else 0.0
    return out


def _count_below(ordered: list[float], v: float) -> int:
    lo, hi = 0, len(ordered)
    while lo < hi:
        mid = (lo + hi) // 2
        if ordered[mid] < v:
            lo = mid + 1
        else:
            hi = mid
    return lo


def _empty_raw() -> dict[str, float]:
    return {
        "passes_attempted": 0, "passes_completed": 0, "xg": 0.0, "shots": 0, "shots_on_target": 0, "goals": 0,
        "xt_added": 0.0, "xt_passes": 0.0, "threat_prevented": 0.0, "ball_wins": 0, "top_speed_kmh": 0.0,
        "sprints": 0, "distance_km": 0.0, "touches": 0, "passes_received": 0,
    }


def _collect_raw(
    events: list[Any], frames: Iterable[Any] | None, names: Mapping[str, str], tracking: list[dict] | None,
) -> tuple[dict, dict]:
    raw: dict[str, dict] = defaultdict(_empty_raw)
    teams: dict[str, str] = {}
    for e in events:
        team, pid = _get(e, "team"), _get(e, "player_id")
        if team not in ("home", "away") or not pid:
            continue
        pid = str(pid)
        teams.setdefault(pid, team)
        r = raw[pid]
        etype = _get(e, "type")
        if etype in TOUCH_TYPES:
            r["touches"] += 1
        if etype == "pass":
            r["passes_attempted"] += 1
            if _get(e, "outcome") == "complete":
                r["passes_completed"] += 1
                rid = _get(e, "recipient_id")
                if rid:
                    raw[str(rid)]["passes_received"] += 1
                    teams.setdefault(str(rid), team)
        elif etype == "shot":
            r["shots"] += 1
            r["xg"] += float(_get(e, "xg", 0.0) or 0.0)
            outcome = _get(e, "outcome")
            r["goals"] += outcome == "goal"
            r["shots_on_target"] += outcome in ("goal", "saved")
        elif etype in ("tackle", "duel") and _get(e, "outcome") == "won":
            r["ball_wins"] += 1
        elif etype == "interception":
            r["ball_wins"] += 1
        xt = successful_action_xt(e)
        if xt is not None and xt > 0:
            r["xt_added"] += xt
            if etype == "pass":
                r["xt_passes"] += xt

    for row in compute_threat_prevented(events, dict(names))["players"]:
        raw[row["player_id"]]["threat_prevented"] = float(row["xt_prevented"])
        teams.setdefault(row["player_id"], row["team"])

    if tracking is None and frames is not None:
        tracking = compute_player_tags(frames, events, names)["players"]
    if tracking is not None:
        for row in tracking:
            r = raw[row["player_id"]]
            r["distance_km"] = row["distance_km"]
            r["top_speed_kmh"] = row["top_speed_kmh"]
            r["sprints"] = row["sprints"]

    for pid in names:
        if team_for(pid, teams) in ("home", "away"):
            raw[pid]  # noqa: B018 -- touch the defaultdict: named squad players are rated even if idle
    return dict(raw), teams


def _components(raw: dict[str, dict]) -> dict[str, dict[str, float]]:
    """Per-player component values the attribute percentiles are taken over."""
    attempted = sum(r["passes_attempted"] for r in raw.values())
    completed = sum(r["passes_completed"] for r in raw.values())
    prior = completed / attempted if attempted else 0.0
    out = {}
    for pid, r in raw.items():
        shrunk = (r["passes_completed"] + PASS_PCT_PRIOR_PASSES * prior) / (r["passes_attempted"] + PASS_PCT_PRIOR_PASSES)
        out[pid] = {**r, "pass_pct_shrunk": shrunk}
    return out


def _role_group(role: str | None) -> str:
    return ROLE_GROUP.get(role or "", "default")


def _reason(raw: dict, attributes: dict[str, int]) -> str:
    """Short, number-backed explanation built from the player's standout stats."""
    parts: list[str] = []
    if raw["goals"]:
        goals = raw["goals"]
        parts.append(f"{goals} goal{'s' if goals > 1 else ''} from {raw['xg']:.2f} xG")
    phrases = {
        "passing": lambda: f"{raw['passes_completed']}/{raw['passes_attempted']} passes ({raw['pass_pct']:.0f}%)",
        "shooting": lambda: f"{raw['shots']} shots, {raw['xg']:.2f} xG",
        "pace": lambda: f"top speed {raw['top_speed_kmh']:.1f} km/h",
        "defending": lambda: f"{raw['ball_wins']} ball wins, {raw['threat_prevented']:.2f} xT prevented",
        "work_rate": lambda: f"{raw['distance_km']:.1f} km covered, {raw['sprints']} sprints",
        "involvement": lambda: f"{raw['touches']} touches",
    }
    ranked = sorted(ATTRIBUTES, key=lambda a: (-attributes[a], ATTRIBUTES.index(a)))
    for attr in ranked:
        if len(parts) >= 3:
            break
        if attr == "shooting" and raw["goals"]:
            continue
        parts.append(phrases[attr]())
    if raw["xt_added"] > 0 and len(parts) < 3:
        parts.append(f"{raw['xt_added']:.2f} xT added")
    return ", ".join(parts)


def compute_player_ratings(
    events: Iterable[Any],
    frames: Iterable[Any] | None,
    player_names: Mapping[str, str],
    *,
    roles: Mapping[str, str] | None = None,
    tracking: list[dict] | None = None,
) -> dict:
    """Ratings for every player in the match. `frames` is the PositionFrame
    track (or None: pace / work rate then read 0 for everyone); `roles` maps
    player_id -> GK/CB/FB/CM/WM/FW when known. `tracking` lets a caller pass
    already-computed compute_player_tags()["players"] rows instead of
    re-walking `frames` (a full match is ~1-2 s of CPU)."""
    events = list(events)
    roles = roles or {}
    raw, teams = _collect_raw(events, frames, player_names, tracking)
    comps = _components(raw)

    pct: dict[str, dict[str, float]] = {}
    keys = {k for weights in COMPONENT_WEIGHTS.values() for k in weights}
    for key in sorted(keys):
        pct[key] = _percentiles({pid: c[key] for pid, c in comps.items()})

    players = []
    for pid in sorted(raw):
        attributes = {
            attr: round(ATTRIBUTE_FLOOR + ATTRIBUTE_SPAN * sum(w * pct[k][pid] for k, w in weights.items()))
            for attr, weights in COMPONENT_WEIGHTS.items()
        }
        role = roles.get(pid)
        weights = RATING_WEIGHTS[_role_group(role)]
        r = raw[pid]
        blend = sum(weights[a] * attributes[a] for a in ATTRIBUTES) + GOAL_BONUS * r["goals"]
        rating = int(max(RATING_MIN, min(RATING_MAX, round(blend))))
        attempted = r["passes_attempted"]
        players.append({
            "player_id": pid,
            "name": player_names.get(pid, pid),
            "team": team_for(pid, teams),
            "position": role,
            "rating": rating,
            "attributes": {a: int(attributes[a]) for a in ATTRIBUTES},
            "raw": {
                "passes_attempted": attempted,
                "passes_completed": r["passes_completed"],
                "pass_pct": round(100.0 * r["passes_completed"] / attempted, 1) if attempted else 0.0,
                "xg": round(r["xg"], 3),
                "shots": r["shots"],
                "shots_on_target": r["shots_on_target"],
                "goals": r["goals"],
                "xt_added": round(r["xt_added"], 4),
                "threat_prevented": round(r["threat_prevented"], 4),
                "ball_wins": r["ball_wins"],
                "top_speed_kmh": round(r["top_speed_kmh"], 1),
                "sprints": r["sprints"],
                "distance_km": round(r["distance_km"], 3),
                "touches": r["touches"],
                "passes_received": r["passes_received"],
            },
            "_blend": blend,
        })

    players.sort(key=lambda p: (-p["rating"], -p["_blend"], p["player_id"]))
    motm = None
    if players:
        best = players[0]
        motm = {"player_id": best["player_id"], "rating": best["rating"], "reason": _reason(best["raw"], best["attributes"])}
    for p in players:
        del p["_blend"]
    return {"players": players, "man_of_the_match": motm, "method": METHOD}


# ---------------------------------------------------------------------------
# Heatmap
# ---------------------------------------------------------------------------

def _grid_cell(x: float, y: float, cols: int, rows: int) -> tuple[int, int]:
    col = min(cols - 1, max(0, int(x / PITCH_X_MAX * cols)))
    row = min(rows - 1, max(0, int(y / PITCH_Y_MAX * rows)))
    return row, col


def compute_player_heatmap(
    player_id: str,
    frames: Iterable[Any] | None,
    events: Iterable[Any],
    player_names: Mapping[str, str],
    *,
    cols: int = 12,
    rows: int = 8,
) -> dict | None:
    """Occupancy grid (rows x cols, row 0 = y near 0, col 0 = x near 0 in
    StatsBomb units) for one player, normalised so the busiest cell is 1.0.
    Built from the position track when it has this player, else from the
    locations of the player's own events. None if the player never appears."""
    events = list(events)
    counts = [[0] * cols for _ in range(rows)]
    team: str | None = None
    touches = 0
    event_locs: list[tuple[float, float]] = []
    for e in events:
        if str(_get(e, "player_id", "")) != player_id or _get(e, "team") not in ("home", "away"):
            continue
        team = team or _get(e, "team")
        if _get(e, "type") in TOUCH_TYPES:
            touches += 1
        loc = _get(e, "location")
        if loc is not None:
            event_locs.append((float(loc[0]), float(loc[1])))

    samples = 0
    if frames is not None:
        for frame in frames:
            pos = (_get(frame, "players") or {}).get(player_id)
            if pos is None:
                continue
            r, c = _grid_cell(float(pos[0]), float(pos[1]), cols, rows)
            counts[r][c] += 1
            samples += 1
    source = "positions"
    if samples == 0:
        source = "events"
        for x, y in event_locs:
            r, c = _grid_cell(x, y, cols, rows)
            counts[r][c] += 1
            samples += 1
    if samples == 0 and player_id not in player_names:
        return None

    team = team_for(player_id, {player_id: team} if team else {})
    peak = max((v for row in counts for v in row), default=0)
    cells = [[round(v / peak, 4) if peak else 0.0 for v in row] for row in counts]
    return {
        "player_id": player_id,
        "name": player_names.get(player_id, player_id),
        "team": team,
        "grid": {"cols": cols, "rows": rows},
        "cells": cells,
        "samples": samples,
        "source": source,
        "touches": touches,
        "attack_direction": direction_of(team) if team in ("home", "away") else None,
    }
