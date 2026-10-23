"""Continuous player/ball position tracking, interpolated from the
discrete event stream datagen already produces.

This is NOT computer vision and NOT a claim of real player/ball tracking --
every sampled position here is derived from an actual recorded event's
location/end_location/timestamp, or (for the players not touching the ball
at a given instant) from that player's own simulated zone-bias "home
position" (datagen/pitch_grid.py's expected_location_from_bias, the same
weighted-centroid already used elsewhere), smoothed toward it between their
own touches rather than frozen in place. Several other hackathon teams ship
a similar continuous view on top of a synthetic event generator and
disclose it exactly this plainly (one competitor's own README says
"synthetic... no CV") -- this module is our equivalent, not an attempt to
pass synthetic motion off as real tracking.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from datagen.pitch_grid import expected_location_from_bias
from datagen.schema import AnyEvent, Location, PITCH_X_MAX, PITCH_Y_MAX, PlayerTendencyProfile

SAMPLE_HZ = 10.0
_SAMPLE_INTERVAL_MS = 1000.0 / SAMPLE_HZ
# A deliberately simple parabolic flight arc for a struck ball on a
# pass/shot/carry (peaks at this height, zero at both ends) -- the "ball
# trajectory physics" touch other teams show, without needing a full
# gravity+drag+Magnus model to get a plausible-looking arc.
_ARC_APEX_M = 3.0
# How fast an off-ball player drifts back toward their own home position
# each sample, as a fraction of the remaining distance -- a simple
# critically-damped-style smoothing, not a physics simulation of running.
_DRIFT_FRACTION = 0.08


@dataclass
class PositionFrame:
    match_id: str
    t_ms: int
    ball: tuple[float, float, float]
    players: dict[str, tuple[float, float]] = field(default_factory=dict)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _ball_height_m(progress: float) -> float:
    return 4.0 * _ARC_APEX_M * progress * (1.0 - progress)


def _is_on_pitch_event(e: object) -> bool:
    return hasattr(e, "player_id") and hasattr(e, "location") and hasattr(e, "match_clock_ms")


def _home_positions(profiles: list[PlayerTendencyProfile]) -> dict[str, Location]:
    return {p.player_id: expected_location_from_bias(p.zone_bias) for p in profiles}


def generate_positions(
    match_id: str,
    events: list[AnyEvent],
    home_profiles: list[PlayerTendencyProfile],
    away_profiles: list[PlayerTendencyProfile],
    duration_ms: int,
    sample_hz: float = SAMPLE_HZ,
) -> list[PositionFrame]:
    """Builds a full match's worth of PositionFrames at sample_hz.

    Off-ball players drift toward their own zone-bias home position rather
    than freezing between their own touches. The ball (and whichever player
    is acting on it) interpolates between the actual recorded event
    locations, with a short parabolic arc applied whenever the event has a
    distinct end_location (pass/shot/carry) -- a stationary action (tackle,
    duel, foul, ...) just holds position for its slice of the timeline.
    """
    interval_ms = 1000.0 / sample_hz
    home_positions = {**_home_positions(home_profiles), **_home_positions(away_profiles)}
    on_pitch_events = sorted(
        (e for e in events if _is_on_pitch_event(e)), key=lambda e: e.match_clock_ms,
    )

    current_positions: dict[str, Location] = dict(home_positions)
    frames: list[PositionFrame] = []
    n_samples = max(1, int(duration_ms / interval_ms) + 1)

    event_idx = 0
    active_segment: tuple[float, float, str, Location, Location] | None = None

    for i in range(n_samples):
        t_ms = i * interval_ms

        while event_idx < len(on_pitch_events) and on_pitch_events[event_idx].match_clock_ms <= t_ms:
            e = on_pitch_events[event_idx]
            start_loc: Location = tuple(e.location)
            end_loc: Location = tuple(getattr(e, "end_location", None) or start_loc)
            duration_s = getattr(e, "duration_s", None) or 1.2
            segment_span_ms = max(400.0, duration_s * 1000.0)
            active_segment = (
                float(e.match_clock_ms), float(e.match_clock_ms) + segment_span_ms,
                e.player_id, start_loc, end_loc,
            )
            current_positions[e.player_id] = start_loc
            event_idx += 1

        ball_xy = home_positions.get("ball", (PITCH_X_MAX / 2, PITCH_Y_MAX / 2))
        ball_z = 0.0
        if active_segment is not None:
            seg_start, seg_end, actor_id, start_loc, end_loc = active_segment
            progress = _clamp((t_ms - seg_start) / max(seg_end - seg_start, 1.0), 0.0, 1.0)
            ball_xy = (_lerp(start_loc[0], end_loc[0], progress), _lerp(start_loc[1], end_loc[1], progress))
            if end_loc != start_loc:
                ball_z = _ball_height_m(progress)
            current_positions[actor_id] = ball_xy

        players_this_frame: dict[str, Location] = {}
        active_actor = active_segment[2] if active_segment is not None else None
        for pid, home in home_positions.items():
            if pid == active_actor:
                players_this_frame[pid] = current_positions[pid]
                continue
            cur = current_positions.get(pid, home)
            nxt = (_lerp(cur[0], home[0], _DRIFT_FRACTION), _lerp(cur[1], home[1], _DRIFT_FRACTION))
            current_positions[pid] = nxt
            players_this_frame[pid] = nxt

        frames.append(PositionFrame(
            match_id=match_id,
            t_ms=int(t_ms),
            ball=(_clamp(ball_xy[0], 0.0, PITCH_X_MAX), _clamp(ball_xy[1], 0.0, PITCH_Y_MAX), ball_z),
            players=players_this_frame,
        ))

    return frames
