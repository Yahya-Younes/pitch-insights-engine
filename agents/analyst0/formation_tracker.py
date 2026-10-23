"""Infers each team's tactical shape over the course of a match, and
detects when and how it changes, purely from observed event locations --
never from datagen's hidden TacticalShiftTruth (datagen/match_simulator.py),
the same "infer like a real scout would" rule agents/analyst0/tendency_model.py
already follows for player tendencies. accuracy_report() at the bottom is
the honest evaluation: how well this inference recovers the generator's own
hidden shift, scored offline the same way tendency recovery is.

The formation-label inference is inspired by the standard "average
formation" technique real analytics broadcasts use (bucket average player
positions into lines) -- hand-built and documented as an approximation
(e.g. collapsing a back three into "3", not distinguishing a double pivot
from a #10), not a trained classifier calibrated against real tracking data.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from datagen.pitch_grid import zone_of
from datagen.schema import AnyEvent, Location, PITCH_X_MAX

WINDOW_MINUTES = 20.0
STEP_MINUTES = 5.0
MIN_EVENTS_PER_WINDOW = 3
SHIFT_DEBOUNCE_STEPS = 2
ROLE_CHANGE_MIN_DISTANCE_M = 12.0


def _depth(location: Location, direction: str) -> float:
    x, _y = location
    return x if direction == "left_to_right" else (PITCH_X_MAX - x)


@dataclass
class FormationWindow:
    start_min: float
    end_min: float
    label: str | None
    positions: dict[str, Location] = field(default_factory=dict)


@dataclass
class ShiftDetection:
    at_min: float
    from_label: str
    to_label: str


@dataclass
class RoleChangeDetection:
    player_id: str
    at_min: float
    from_zone: str
    to_zone: str


@dataclass
class TacticalTimeline:
    team: str
    starting_formation: str
    windows: list[FormationWindow] = field(default_factory=list)
    shifts: list[ShiftDetection] = field(default_factory=list)
    role_changes: list[RoleChangeDetection] = field(default_factory=list)


def _player_window_positions(events: list[AnyEvent], team: str, start_ms: int, end_ms: int) -> dict[str, Location]:
    sums: dict[str, list[float]] = {}
    counts: dict[str, int] = {}
    for e in events:
        if getattr(e, "team", None) != team:
            continue
        ms = getattr(e, "match_clock_ms", None)
        loc = getattr(e, "location", None)
        pid = getattr(e, "player_id", None)
        if ms is None or loc is None or not pid or not (start_ms <= ms < end_ms):
            continue
        s = sums.setdefault(pid, [0.0, 0.0])
        s[0] += loc[0]
        s[1] += loc[1]
        counts[pid] = counts.get(pid, 0) + 1
    return {
        pid: (s[0] / counts[pid], s[1] / counts[pid])
        for pid, s in sums.items() if counts[pid] >= MIN_EVENTS_PER_WINDOW
    }


def identify_goalkeeper(events: list[AnyEvent], team: str, direction: str) -> str | None:
    """The single deepest-average-position player across the WHOLE match --
    computed once and reused for every window, rather than re-derived per
    window (which flip-flopped whenever the real keeper had too few events
    in some window to even be included, letting a different deep defender
    get excluded as "the keeper" instead and throwing off that window's
    outfield band count for no real tactical reason)."""
    positions = _player_window_positions(events, team, 0, 10 ** 12)
    if not positions:
        return None
    depths = {pid: _depth(loc, direction) for pid, loc in positions.items()}
    return min(depths, key=depths.get)


def _band_counts(sorted_depths: list[float]) -> list[int]:
    """Splits sorted depths into up to 3 bands (back/mid/front line) by
    cutting at the two largest gaps -- the data's own natural breaks decide
    the grouping, rather than assuming a fixed proportion."""
    n = len(sorted_depths)
    if n <= 2:
        return [n] if n else []
    gaps = sorted(((sorted_depths[i + 1] - sorted_depths[i], i) for i in range(n - 1)), reverse=True)
    cut_indices = sorted(i for _, i in gaps[:2])
    bands: list[int] = []
    start = 0
    for ci in cut_indices:
        bands.append(ci - start + 1)
        start = ci + 1
    bands.append(n - start)
    return bands


def infer_formation_label(positions: dict[str, Location], direction: str, gk_id: str | None) -> str | None:
    """A shorthand like "4-3-3" inferred from average positions in one
    window -- the match's identified keeper (identify_goalkeeper(), fixed
    for the whole match) is excluded, the remaining outfield players are
    split into lines by their own largest depth gaps."""
    outfield_depths_src = {pid: loc for pid, loc in positions.items() if pid != gk_id}
    if len(outfield_depths_src) < 5:
        return None
    outfield_depths = sorted(_depth(loc, direction) for loc in outfield_depths_src.values())
    bands = _band_counts(outfield_depths)
    if not bands:
        return None
    return "-".join(str(b) for b in bands)


def _detect_role_changes(windows: list[FormationWindow]) -> list[RoleChangeDetection]:
    valid = [w for w in windows if w.positions]
    if len(valid) < 2:
        return []
    first, last = valid[0], valid[-1]
    changes: list[RoleChangeDetection] = []
    for pid, loc in last.positions.items():
        if pid not in first.positions:
            continue
        start_loc = first.positions[pid]
        dist = ((start_loc[0] - loc[0]) ** 2 + (start_loc[1] - loc[1]) ** 2) ** 0.5
        if dist < ROLE_CHANGE_MIN_DISTANCE_M:
            continue
        z_first, z_last = zone_of(start_loc), zone_of(loc)
        if z_first != z_last:
            changes.append(RoleChangeDetection(player_id=pid, at_min=last.start_min, from_zone=z_first, to_zone=z_last))
    return changes


def build_tactical_timeline(
    events: list[AnyEvent], team: str, direction: str, starting_formation: str, duration_ms: int,
    window_minutes: float = WINDOW_MINUTES, step_minutes: float = STEP_MINUTES,
) -> TacticalTimeline:
    timeline = TacticalTimeline(team=team, starting_formation=starting_formation)
    gk_id = identify_goalkeeper(events, team, direction)
    window_ms = int(window_minutes * 60000)
    step_ms = int(step_minutes * 60000)
    prev_label: str | None = None
    pending_label: str | None = None
    pending_count = 0

    t = 0
    while t < duration_ms:
        # A rolling window (step < window, so consecutive windows overlap)
        # settles faster and flip-flops less than disjoint blocks would,
        # which matters both for label stability and for how quickly a
        # real shift can actually be confirmed after it happens.
        t_end = min(t + window_ms, duration_ms)
        positions = _player_window_positions(events, team, t, t_end)
        label = infer_formation_label(positions, direction, gk_id)
        timeline.windows.append(FormationWindow(start_min=t / 60000, end_min=t_end / 60000, label=label, positions=positions))

        if label is not None:
            if prev_label is None:
                prev_label = label
            elif label != prev_label:
                if label == pending_label:
                    pending_count += 1
                else:
                    pending_label, pending_count = label, 1
                if pending_count >= SHIFT_DEBOUNCE_STEPS:
                    timeline.shifts.append(ShiftDetection(at_min=t_end / 60000, from_label=prev_label, to_label=label))
                    prev_label = label
                    pending_label, pending_count = None, 0
            else:
                pending_label, pending_count = None, 0
        t += step_ms

    timeline.role_changes = _detect_role_changes(timeline.windows)
    return timeline


@dataclass
class ShiftDetectionAccuracy:
    had_shift: bool
    detected: bool
    timing_error_min: float | None
    false_positive_count: int


def score_shift_detection(timeline: TacticalTimeline, truth_at_ms: int | None, duration_ms: int) -> ShiftDetectionAccuracy:
    """Scores this timeline's detected shifts against the generator's own
    hidden ground-truth shift timestamp (None if that team never actually
    shifted this match) -- the same honest "inference vs. hidden truth"
    evaluation design as agents.analyst0.tendency_model.accuracy_report."""
    if truth_at_ms is None:
        return ShiftDetectionAccuracy(
            had_shift=False, detected=bool(timeline.shifts), timing_error_min=None,
            false_positive_count=len(timeline.shifts),
        )
    truth_min = truth_at_ms / 60000
    if not timeline.shifts:
        return ShiftDetectionAccuracy(had_shift=True, detected=False, timing_error_min=None, false_positive_count=0)
    nearest = min(timeline.shifts, key=lambda s: abs(s.at_min - truth_min))
    return ShiftDetectionAccuracy(
        had_shift=True, detected=True, timing_error_min=round(abs(nearest.at_min - truth_min), 1),
        false_positive_count=max(0, len(timeline.shifts) - 1),
    )
