"""Deterministic football-analytics layer. No LLM calls live here — this module
is the ground truth the Narrator agent is only ever allowed to explain, never
invent. Every formula below is grounded in a named, real analytics concept and
is honestly scoped where it's hand-calibrated rather than fit from data (we
only have one synthetic match's worth of events, which is not enough to fit a
Markov transition model or an xG model from scratch).
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

from datagen.schema import PITCH_X_MAX, PITCH_Y_MAX, AnyEvent, Location, Team

HOME_DIRECTION = "left_to_right"
AWAY_DIRECTION = "right_to_left"


def direction_of(team: Team) -> str:
    return HOME_DIRECTION if team == "home" else AWAY_DIRECTION


def opponent_of(team: Team) -> Team:
    return "away" if team == "home" else "home"


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _distance(a: Location, b: Location) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


# ---------------------------------------------------------------------------
# PPDA — passes-per-defensive-action, Colin Trainor's pressing-intensity metric.
# Restricted to the opponent's defensive 60% of the pitch (i.e. excluding their
# attacking-most 40%), the standard convention, so deep unpressured goalkeeper
# build-up doesn't get counted as "the opponent failed to press."
# ---------------------------------------------------------------------------

def _defensive_60pct_zone(team: Team) -> tuple[float, float]:
    """x-range of `team`'s own defensive 60% of the pitch."""
    if direction_of(team) == HOME_DIRECTION:
        return (0.0, PITCH_X_MAX * 0.6)
    return (PITCH_X_MAX * 0.4, PITCH_X_MAX)


def _in_zone(x: float, zone: tuple[float, float]) -> bool:
    return zone[0] <= x <= zone[1]


def ppda_counts(events: list[AnyEvent], pressing_team: Team, start_ms: int, end_ms: int) -> tuple[int, int]:
    """Raw (opponent_passes, defensive_actions) counts behind a PPDA ratio.
    Exposed separately from compute_ppda so callers can gate on sample size —
    PPDA is a ratio of small integer counts over short windows, and a window
    with e.g. 1 defensive action can swing wildly without representing a real
    pressing-intensity change."""
    opponent = opponent_of(pressing_team)
    zone = _defensive_60pct_zone(opponent)

    opponent_passes = 0
    defensive_actions = 0
    for e in events:
        ms = getattr(e, "match_clock_ms", None)
        if ms is None or not (start_ms <= ms < end_ms):
            continue
        if not _in_zone_event(e, zone):
            continue
        if e.type == "pass" and e.team == opponent:
            opponent_passes += 1
        elif e.type == "tackle" and e.team == pressing_team:
            defensive_actions += 1
        elif e.type == "interception" and e.team == pressing_team:
            defensive_actions += 1
        elif e.type == "foul" and e.team == pressing_team:
            defensive_actions += 1
        elif e.type == "duel" and e.team == pressing_team and getattr(e, "outcome", None) == "won":
            defensive_actions += 1
    return opponent_passes, defensive_actions


def compute_ppda(events: list[AnyEvent], pressing_team: Team, start_ms: int, end_ms: int) -> float | None:
    opponent_passes, defensive_actions = ppda_counts(events, pressing_team, start_ms, end_ms)
    if opponent_passes == 0 and defensive_actions == 0:
        return None
    return round(opponent_passes / max(1, defensive_actions), 2)


def _in_zone_event(e: AnyEvent, zone: tuple[float, float]) -> bool:
    loc = getattr(e, "location", None)
    return loc is not None and _in_zone(loc[0], zone)


# ---------------------------------------------------------------------------
# Chaos / control composite — category-entropy + turnover rate + possession
# volatility. Deliberately documented as a team-designed composite, not a
# single published metric like PPDA or xT.
# ---------------------------------------------------------------------------

_ENTROPY_CATEGORIES = ("pass_complete", "pass_incomplete", "carry", "dribble_success", "dribble_fail", "turnover", "shot")


def _entropy_category(e: AnyEvent) -> str | None:
    if e.type == "pass":
        return "pass_complete" if e.outcome == "complete" else "pass_incomplete"
    if e.type == "carry":
        return "carry"
    if e.type == "dribble":
        return "dribble_success" if e.outcome in ("complete", "nutmeg") else "dribble_fail"
    if e.type == "possession_change" and e.reason != "goal":
        return "turnover"
    if e.type == "shot":
        return "shot"
    return None


def shannon_entropy(events_in_window: list[AnyEvent]) -> float:
    counts = Counter(c for e in events_in_window if (c := _entropy_category(e)) is not None)
    total = sum(counts.values())
    if total == 0:
        return 0.0
    entropy = 0.0
    for count in counts.values():
        p = count / total
        entropy -= p * math.log2(p)
    return entropy


MAX_ENTROPY = math.log2(len(_ENTROPY_CATEGORIES))


@dataclass
class ChaosScore:
    entropy: float
    turnover_rate: float
    possession_volatility: float
    composite: float


def compute_chaos_score(events: list[AnyEvent], start_ms: int, end_ms: int) -> ChaosScore:
    window = [e for e in events if start_ms <= getattr(e, "match_clock_ms", -1) < end_ms]
    window_minutes = max(0.01, (end_ms - start_ms) / 60000)

    entropy = shannon_entropy(window)
    turnovers = sum(1 for e in window if e.type == "possession_change" and e.reason != "goal")
    turnover_rate = turnovers / window_minutes
    possession_ids = {e.possession_id for e in window if hasattr(e, "possession_id")}
    possession_volatility = len(possession_ids) / window_minutes

    norm_entropy = entropy / MAX_ENTROPY if MAX_ENTROPY > 0 else 0.0
    norm_turnover = min(1.0, turnover_rate / 8.0)
    norm_volatility = min(1.0, possession_volatility / 8.0)
    composite = (norm_entropy + norm_turnover + norm_volatility) / 3.0

    return ChaosScore(
        entropy=round(entropy, 3), turnover_rate=round(turnover_rate, 2),
        possession_volatility=round(possession_volatility, 2), composite=round(composite, 3),
    )


# ---------------------------------------------------------------------------
# Rhythm / tempo — actions-per-minute, rolling z-score against the match mean.
# ---------------------------------------------------------------------------

_TEMPO_EVENT_TYPES = {"pass", "carry", "dribble", "shot", "tackle", "interception", "duel"}


def tempo_series(events: list[AnyEvent], match_duration_ms: int, window_minutes: int = 2, step_minutes: int = 1) -> list[tuple[int, float]]:
    window_ms = window_minutes * 60000
    step_ms = step_minutes * 60000
    series = []
    t = 0
    while t + window_ms <= match_duration_ms:
        count = sum(1 for e in events if e.type in _TEMPO_EVENT_TYPES and t <= getattr(e, "match_clock_ms", -1) < t + window_ms)
        series.append((t, count / window_minutes))
        t += step_ms
    return series


def tempo_zscores(series: list[tuple[int, float]]) -> list[tuple[int, float, float]]:
    values = [v for _, v in series]
    if len(values) < 2:
        return [(t, v, 0.0) for t, v in series]
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    stddev = math.sqrt(variance) or 1.0
    return [(t, v, round((v - mean) / stddev, 2)) for t, v in series]


# ---------------------------------------------------------------------------
# Expected Threat (xT) — Karun Singh's Markov-chain formulation, solved by
# value iteration on a 16x12 zone grid. Shot/goal/loss probabilities are
# hand-calibrated curves (distance + centrality to goal), not fit from this
# match's own events — a single synthetic match has nowhere near enough
# volume to fit a transition model, so we say so rather than pretend otherwise.
# ---------------------------------------------------------------------------

XT_COLS = 16
XT_ROWS = 12
_XT_COL_W = PITCH_X_MAX / XT_COLS
_XT_ROW_H = PITCH_Y_MAX / XT_ROWS
_XT_ITERATIONS = 16
_XT_LOSS_PROB = 0.15


def _xt_zone_index(x: float, y: float) -> tuple[int, int]:
    col = min(int(x // _XT_COL_W), XT_COLS - 1)
    row = min(int(y // _XT_ROW_H), XT_ROWS - 1)
    return row, col


def _xt_zone_center(row: int, col: int) -> Location:
    return (col * _XT_COL_W + _XT_COL_W / 2, row * _XT_ROW_H + _XT_ROW_H / 2)


def _build_xt_grid() -> list[list[float]]:
    goal = (PITCH_X_MAX, 40.0)
    shot_prob = [[0.0] * XT_COLS for _ in range(XT_ROWS)]
    goal_prob = [[0.0] * XT_COLS for _ in range(XT_ROWS)]
    move_prob = [[0.0] * XT_COLS for _ in range(XT_ROWS)]

    for row in range(XT_ROWS):
        for col in range(XT_COLS):
            cx, cy = _xt_zone_center(row, col)
            dist = _distance(goal, (cx, cy))
            centrality = 1.0 - min(1.0, abs(cy - 40.0) / 40.0) * 0.5
            sp = _clip(math.exp(-dist / 15.0) * 0.35 * centrality, 0.0, 0.55)
            gp = _clip(math.exp(-dist / 18.0) * 0.65 * centrality, 0.01, 0.75)
            shot_prob[row][col] = sp
            goal_prob[row][col] = gp
            move_prob[row][col] = max(0.0, 1.0 - sp - _XT_LOSS_PROB)

    transitions: dict[tuple[int, int], dict[tuple[int, int], float]] = {}
    for row in range(XT_ROWS):
        for col in range(XT_COLS):
            cx, cy = _xt_zone_center(row, col)
            weights: dict[tuple[int, int], float] = {}
            total = 0.0
            for r2 in range(XT_ROWS):
                for c2 in range(XT_COLS):
                    if (r2, c2) == (row, col):
                        continue
                    tx, ty = _xt_zone_center(r2, c2)
                    forward_bias = max(0.0, tx - cx)
                    d = _distance((cx, cy), (tx, ty))
                    w = math.exp(-(d ** 2) / (2 * 22.0 ** 2)) * (1.0 + forward_bias / 40.0)
                    weights[(r2, c2)] = w
                    total += w
            transitions[(row, col)] = {k: v / total for k, v in weights.items()} if total > 0 else {}

    xt = [[0.0] * XT_COLS for _ in range(XT_ROWS)]
    for _ in range(_XT_ITERATIONS):
        new_xt = [[0.0] * XT_COLS for _ in range(XT_ROWS)]
        for row in range(XT_ROWS):
            for col in range(XT_COLS):
                shoot_component = shot_prob[row][col] * goal_prob[row][col]
                move_component = sum(w * xt[r2][c2] for (r2, c2), w in transitions[(row, col)].items())
                new_xt[row][col] = shoot_component + move_prob[row][col] * move_component
        xt = new_xt
    return xt


_XT_GRID = _build_xt_grid()


def xt_value(location: Location, direction: str) -> float:
    x, y = location
    x_eff = x if direction == HOME_DIRECTION else PITCH_X_MAX - x
    row, col = _xt_zone_index(x_eff, y)
    return _XT_GRID[row][col]


def action_xt_delta(start: Location, end: Location, direction: str) -> float:
    return round(xt_value(end, direction) - xt_value(start, direction), 4)


# ---------------------------------------------------------------------------
# Pass quality — distance/accuracy come straight off the event; difficulty is
# a composite of pressure, distance, xT gain, and whether it reached the final
# third. Honestly a pitch-control-inspired proxy, not a full pitch-control
# surface (no per-event opponent-density computation — out of scope for the
# compute budget here).
# ---------------------------------------------------------------------------

def _in_final_third(location: Location, direction: str) -> bool:
    x = location[0] if direction == HOME_DIRECTION else PITCH_X_MAX - location[0]
    return x >= PITCH_X_MAX * (2 / 3)


def pass_difficulty_rating(location: Location, end_location: Location, distance_m: float, under_pressure: bool, direction: str) -> float:
    xt_gain = action_xt_delta(location, end_location, direction)
    score = 0.0
    score += 0.35 if under_pressure else 0.0
    score += min(0.3, distance_m / 100.0)
    score += min(0.25, max(0.0, xt_gain) * 2.0)
    score += 0.1 if _in_final_third(end_location, direction) else 0.0
    return round(_clip(score, 0.0, 1.0), 3)


# ---------------------------------------------------------------------------
# Referee positioning quality — grounded in the Diagonal System of Control and
# the general sports-officiating finding that shorter distance + sharper
# viewing angle correlates with decision accuracy. Hand-calibrated (PGMOL's
# actual models aren't public), documented honestly as such.
# ---------------------------------------------------------------------------

def positioning_quality(distance_m: float, angle_deg: float) -> float:
    return round(_clip(1.0 - (distance_m / 35.0) * 0.6 - (angle_deg / 90.0) * 0.4, 0.0, 1.0), 3)


# These three add depth to the referee_decision insight beyond the raw
# positioning score: which Law actually governs this kind of call, how much
# the decision plausibly mattered, and -- just as important -- an honest
# admission of when positioning quality is too ambiguous to call either way,
# rather than defaulting to a confident verdict either direction.

# Real IFAB Law numbers (Law 5 = the referee, incl. the VAR protocol; Law 12
# = fouls and misconduct) applied to a synthetic incident -- illustrative of
# which law governs this kind of call, not an official ruling on it.
LAW_REFERENCE: dict[str, str] = {
    "foul_called": "Law 12 (Fouls and Misconduct)",
    "advantage_played": "Law 5 (The Referee) -- advantage",
    "card_issued": "Law 12 (Fouls and Misconduct) -- cautionable/sending-off offences",
    "var_review": "Law 5 (The Referee) -- VAR protocol",
}

_IMPACT_BY_SEVERITY = {"minor": 0.2, "reckless": 0.55, "serious": 0.85}


def estimated_impact(severity: str) -> float:
    """A deliberately simple severity-based heuristic, not a true expected-
    points or xG-swing model -- honestly documented as such, the same way
    the chaos composite and xT grid are."""
    return _IMPACT_BY_SEVERITY.get(severity, 0.4)


def confidence_band(quality: float) -> str:
    """Positioning quality alone rarely supports a confident verdict in
    either direction in the 0.3-0.55 band -- flagging that honestly, rather
    than always presenting a confident contestable/clear call, is the point
    of this function."""
    if quality < 0.3:
        return "poor_positioning"
    if quality < 0.55:
        return "too_close_to_call"
    return "adequate_positioning"
