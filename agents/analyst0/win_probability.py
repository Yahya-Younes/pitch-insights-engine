"""Live win probability: P(home win / draw / away win) at every match minute.

Pure, deterministic, offline -- no LLM, no randomness. At each minute ``t``
it looks ONLY at events with ``match_clock_ms <= t * 60000`` and:

1. reads the current score (shot events with ``outcome == "goal"``) and each
   side's cumulative xG;
2. estimates each side's scoring rate per 90 minutes as a shrinkage blend of
   a league-typical prior (``PRIOR_XG_PER_90``) and the side's observed xG
   pace. The prior counts as ``PRIOR_WEIGHT_MIN`` minutes of evidence, so
   the observed pace takes over as ``t`` grows:

       rate_90 = (PRIOR_XG_PER_90 * PRIOR_WEIGHT_MIN + xG_so_far * 90)
                 / (PRIOR_WEIGHT_MIN + t)

3. treats each side's remaining goals as an independent Poisson with mean
   ``rate_90 * (90 - t) / 90`` and sums the joint distribution (truncated at
   ``MAX_EXTRA_GOALS`` per side, then renormalised) into final-result
   probabilities.

Known simplifications (surfaced in ``METHOD``): no home advantage, no
red-card / game-state effects, independent Poisson (no draw inflation), and
xG comes from the synthetic generator's own shot model.
"""
from __future__ import annotations

import math
from typing import Any

FULL_TIME_MIN = 90
PRIOR_XG_PER_90 = 1.4      # league-typical xG per team per 90 minutes
PRIOR_WEIGHT_MIN = 45.0    # the prior is worth this many minutes of observed play
MAX_EXTRA_GOALS = 10       # Poisson truncation per side
BIG_CHANCE_XG = 0.3        # a non-goal shot at/above this xG counts as a "big chance"
MIN_SWING = 0.02           # ignore minute-to-minute moves smaller than this
N_SWINGS = 3

METHOD = (
    "Score + xG so far -> each side's remaining goals as independent Poisson "
    f"(rate blends a {PRIOR_XG_PER_90} xG/90 prior worth {PRIOR_WEIGHT_MIN:.0f} min with observed xG pace); "
    "no home advantage, cards or game-state effects; synthetic data."
)


def _get(event: Any, key: str, default: Any = None) -> Any:
    if isinstance(event, dict):
        return event.get(key, default)
    return getattr(event, key, default)


def _poisson_pmf(lam: float, n_max: int) -> list[float]:
    if lam <= 0.0:
        return [1.0] + [0.0] * n_max
    pmf = [math.exp(-lam)]
    for k in range(1, n_max + 1):
        pmf.append(pmf[-1] * lam / k)
    total = sum(pmf)
    return [p / total for p in pmf]


def outcome_probabilities(
    goal_diff: int, lam_home: float, lam_away: float, max_goals: int = MAX_EXTRA_GOALS,
) -> tuple[float, float, float]:
    """(home win, draw, away win) given the current home-minus-away goal
    difference and the expected remaining goals for each side."""
    ph = _poisson_pmf(lam_home, max_goals)
    pa = _poisson_pmf(lam_away, max_goals)
    home = draw = away = 0.0
    for i, p_i in enumerate(ph):
        if p_i == 0.0:
            continue
        for j, p_j in enumerate(pa):
            if p_j == 0.0:
                continue
            final = goal_diff + i - j
            if final > 0:
                home += p_i * p_j
            elif final < 0:
                away += p_i * p_j
            else:
                draw += p_i * p_j
    total = home + draw + away
    return home / total, draw / total, away / total


def _rate_per_90(xg_so_far: float, minute: float) -> float:
    return (PRIOR_XG_PER_90 * PRIOR_WEIGHT_MIN + xg_so_far * FULL_TIME_MIN) / (PRIOR_WEIGHT_MIN + minute)


def _shots(events: list[Any]) -> list[Any]:
    shots = [
        e for e in events
        if _get(e, "type") == "shot" and _get(e, "team") in ("home", "away")
    ]
    return sorted(shots, key=lambda e: _get(e, "match_clock_ms", 0))


def _describe(shot: Any, kind: str) -> dict:
    xg = float(_get(shot, "xg", 0.0) or 0.0)
    player = _get(shot, "player_name") or "Unknown"
    if kind == "goal":
        text = f"{player} scores (xG {xg:.2f})"
    else:
        label = "big chance" if kind == "big_chance" else "chance"
        text = f"{player} {label}, {str(_get(shot, 'outcome', 'missed')).replace('_', ' ')} (xG {xg:.2f})"
    return {
        "kind": kind,
        "team": _get(shot, "team"),
        "player_name": player,
        "xg": xg,
        "event_id": _get(shot, "event_id"),
        "match_clock_ms": int(_get(shot, "match_clock_ms", 0)),
        "description": text,
    }


def _cause(shots_in_minute: list[Any]) -> dict:
    goals = [s for s in shots_in_minute if _get(s, "outcome") == "goal"]
    if goals:
        return _describe(goals[-1], "goal")
    if shots_in_minute:
        best = max(shots_in_minute, key=lambda s: float(_get(s, "xg", 0.0) or 0.0))
        if float(_get(best, "xg", 0.0) or 0.0) >= BIG_CHANCE_XG:
            return _describe(best, "big_chance")
        return _describe(best, "chance")
    return {"kind": "time", "team": None, "player_name": None, "xg": None,
            "event_id": None, "match_clock_ms": None, "description": "Clock running down"}


def compute_win_probability(events: list[Any], duration_ms: int) -> dict:
    """Minute-by-minute home/draw/away probabilities plus the top swing moments.

    ``events`` are on-pitch events (pydantic models or dicts); only shots are
    read. The series runs from minute 0 to ``min(90, duration_ms // 60000)``;
    a match simulated for fewer than 90 minutes is reported as not resolved.
    """
    end_minute = max(0, min(FULL_TIME_MIN, int(duration_ms) // 60000))
    full_time = end_minute >= FULL_TIME_MIN
    shots = _shots(events)

    series: list[dict] = []
    shots_by_minute: dict[int, list[Any]] = {}
    idx = 0
    goals = {"home": 0, "away": 0}
    xg = {"home": 0.0, "away": 0.0}
    for t in range(end_minute + 1):
        cutoff = t * 60000
        # At full time also take any stoppage-time shots logged past 90:00.
        while idx < len(shots) and (
            _get(shots[idx], "match_clock_ms", 0) <= cutoff or (full_time and t == end_minute)
        ):
            s = shots[idx]
            team = _get(s, "team")
            xg[team] += float(_get(s, "xg", 0.0) or 0.0)
            if _get(s, "outcome") == "goal":
                goals[team] += 1
            shots_by_minute.setdefault(t, []).append(s)
            idx += 1

        remaining = FULL_TIME_MIN - t
        lam_h = _rate_per_90(xg["home"], t) * remaining / FULL_TIME_MIN
        lam_a = _rate_per_90(xg["away"], t) * remaining / FULL_TIME_MIN
        home, draw, away = outcome_probabilities(goals["home"] - goals["away"], lam_h, lam_a)
        series.append({
            "minute": t, "home": home, "draw": draw, "away": away,
            "home_goals": goals["home"], "away_goals": goals["away"],
            "home_xg": round(xg["home"], 3), "away_xg": round(xg["away"], 3),
        })

    swings: list[dict] = []
    for prev, cur in zip(series, series[1:], strict=False):
        delta = cur["home"] - prev["home"]
        if abs(delta) < MIN_SWING:
            continue
        swings.append({
            "minute": cur["minute"],
            "delta_home": delta,
            "home_before": prev["home"],
            "home_after": cur["home"],
            "score_after": f"{cur['home_goals']}-{cur['away_goals']}",
            "cause": _cause(shots_by_minute.get(cur["minute"], [])),
        })
    swings.sort(key=lambda s: (-abs(s["delta_home"]), s["minute"]))

    return {
        "series": series,
        "swings": swings[:N_SWINGS],
        "full_time": full_time,
        "method": METHOD,
    }
