"""Walks a completed match's event stream and emits InsightCandidates only
when a threshold actually crosses — never on every tick. This threshold gate
is what the Narrator's grounding depends on: it only ever sees a short list
of "something notable happened here, and here's the computed evidence,"
never a flood of raw numbers it would have to editorialize over itself.
"""
from __future__ import annotations

from dataclasses import dataclass

from agents.analyst0 import metrics as m
from agents.analyst0.tendency_model import InferredTendencyProfile, tendency_alignment_score
from agents.shared.models import InsightCandidate
from datagen.schema import AnyEvent, Team

PRESSURE_DROP_THRESHOLD_PCT = -25.0
CHAOS_SPIKE_DELTA_PCT = 15.0
TEMPO_ZSCORE_THRESHOLD = 1.5
TENDENCY_MATCH_THRESHOLD = 0.6
TENDENCY_BREAK_THRESHOLD = 0.15
TENDENCY_MIN_SAMPLE_SIZE = 8
TENDENCY_COOLDOWN_MIN = 5.0

_ACTION_EVENT_TYPES = ("pass", "dribble", "carry")


def _ms_to_min(ms: int) -> float:
    return round(ms / 60000, 2)


@dataclass
class _TeamBaseline:
    mean_ppda: float


def _compute_match_mean_ppda(events: list[AnyEvent], team: Team, duration_ms: int, window_ms: int) -> float:
    values = []
    t = 0
    while t + window_ms <= duration_ms:
        v = m.compute_ppda(events, team, t, t + window_ms)
        if v is not None:
            values.append(v)
        t += window_ms
    return sum(values) / len(values) if values else 10.0


def _pressure_candidates(events, match_id, duration_ms, window_ms) -> list[InsightCandidate]:
    out = []
    for team in ("home", "away"):
        baseline = _compute_match_mean_ppda(events, team, duration_ms, window_ms)
        t = 0
        while t + window_ms <= duration_ms:
            value = m.compute_ppda(events, team, t, t + window_ms)
            t_next = t + window_ms
            if value is not None and baseline > 0:
                delta_pct = round((value - baseline) / baseline * 100, 1)
                if delta_pct <= PRESSURE_DROP_THRESHOLD_PCT:
                    window_events = [e for e in events if t <= getattr(e, "match_clock_ms", -1) < t_next]
                    related_events = [e.event_id for e in window_events if e.type in ("tackle", "interception", "foul")]
                    out.append(InsightCandidate(
                        match_id=match_id, window_start_min=_ms_to_min(t), window_end_min=_ms_to_min(t_next),
                        trigger_type="pressure_spike", metric_name=f"ppda_{team}", metric_value=value,
                        baseline_value=round(baseline, 2), delta_pct=delta_pct,
                        related_events=related_events[:5],
                        window_summary={"team": team},
                    ))
            t = t_next
    return out


def _chaos_candidates(events, match_id, duration_ms, window_ms) -> list[InsightCandidate]:
    windows = []
    t = 0
    while t + window_ms <= duration_ms:
        t_next = t + window_ms
        windows.append((t, t_next, m.compute_chaos_score(events, t, t_next)))
        t = t_next
    if not windows:
        return []

    baseline = sum(score.composite for _, _, score in windows) / len(windows)
    out = []
    for t, t_next, score in windows:
        delta_pct = (score.composite - baseline) / baseline * 100 if baseline > 0 else 0.0
        if delta_pct >= CHAOS_SPIKE_DELTA_PCT:
            out.append(InsightCandidate(
                match_id=match_id, window_start_min=_ms_to_min(t), window_end_min=_ms_to_min(t_next),
                trigger_type="chaos_shift", metric_name="chaos_composite", metric_value=score.composite,
                baseline_value=round(baseline, 3), delta_pct=round(delta_pct, 1),
                window_summary={"entropy": score.entropy, "turnover_rate": score.turnover_rate,
                                "possession_volatility": score.possession_volatility},
            ))
    return out


def _rhythm_candidates(events, match_id, duration_ms) -> list[InsightCandidate]:
    series = m.tempo_series(events, duration_ms)
    zscores = m.tempo_zscores(series)
    out = []
    prev_over = False
    for t, value, z in zscores:
        over = abs(z) >= TEMPO_ZSCORE_THRESHOLD
        if over and not prev_over:
            out.append(InsightCandidate(
                match_id=match_id, window_start_min=_ms_to_min(t), window_end_min=_ms_to_min(t + 120000),
                trigger_type="rhythm_change", metric_name="tempo_zscore", metric_value=z,
                baseline_value=0.0, delta_pct=None,
                window_summary={"tempo_actions_per_min": value},
            ))
        prev_over = over
    return out


def _milestone_candidates(events, match_id) -> list[InsightCandidate]:
    out = []
    for e in events:
        if e.type == "shot" and e.outcome == "goal":
            out.append(InsightCandidate(
                match_id=match_id, window_start_min=_ms_to_min(e.match_clock_ms), window_end_min=_ms_to_min(e.match_clock_ms),
                trigger_type="milestone", metric_name="goal", metric_value=1.0,
                related_players=[e.player_id], related_events=[e.event_id],
                window_summary={"team": e.team, "xg": e.xg},
            ))
    return out


def _referee_candidates(events, match_id) -> list[InsightCandidate]:
    out = []
    for e in events:
        if e.type != "referee_decision" or not e.contestable:
            continue
        quality = m.positioning_quality(e.referee_distance_to_incident_m, e.referee_viewing_angle_deg)
        out.append(InsightCandidate(
            match_id=match_id, window_start_min=_ms_to_min(e.match_clock_ms), window_end_min=_ms_to_min(e.match_clock_ms),
            trigger_type="referee_decision", metric_name="positioning_quality", metric_value=quality,
            baseline_value=0.5, delta_pct=round((quality - 0.5) / 0.5 * 100, 1),
            related_players=e.related_player_ids, related_events=[e.event_id],
            window_summary={
                "decision_type": e.decision_type, "distance_m": e.referee_distance_to_incident_m,
                "angle_deg": e.referee_viewing_angle_deg, "severity": e.incident_severity,
            },
        ))
    return out


def _action_label(e: AnyEvent) -> str | None:
    if e.type in ("pass", "dribble", "carry"):
        return e.type
    return None


def _tendency_candidates(events, match_id, tendency_profiles: dict[str, InferredTendencyProfile]) -> list[InsightCandidate]:
    out = []
    last_emitted_min: dict[tuple[str, str], float] = {}
    for e in events:
        label = _action_label(e)
        if label is None or not getattr(e, "under_pressure", False):
            continue
        profile = tendency_profiles.get(e.player_id)
        if profile is None or profile.sample_size < TENDENCY_MIN_SAMPLE_SIZE:
            continue
        score = tendency_alignment_score(profile, label, under_pressure=True)
        minute = _ms_to_min(e.match_clock_ms)

        trigger_type = None
        if score >= TENDENCY_MATCH_THRESHOLD:
            trigger_type = "tendency_match"
        elif score <= TENDENCY_BREAK_THRESHOLD:
            trigger_type = "tendency_break"
        if trigger_type is None:
            continue

        key = (e.player_id, trigger_type)
        if minute - last_emitted_min.get(key, -999) < TENDENCY_COOLDOWN_MIN:
            continue
        last_emitted_min[key] = minute

        out.append(InsightCandidate(
            match_id=match_id, window_start_min=minute, window_end_min=minute,
            trigger_type=trigger_type, metric_name="tendency_alignment_score", metric_value=round(score, 3),
            baseline_value=TENDENCY_MATCH_THRESHOLD if trigger_type == "tendency_match" else TENDENCY_BREAK_THRESHOLD,
            related_players=[e.player_id], related_events=[e.event_id],
            window_summary={"actual_action": label, "dominant_expected_action": max(
                profile.action_bias_under_pressure, key=lambda k: profile.action_bias_under_pressure[k])},
        ))
    return out


def generate_insight_candidates(
    events: list[AnyEvent], match_id: str, match_duration_ms: int,
    tendency_profiles: dict[str, InferredTendencyProfile] | None = None,
    window_minutes: int = 3,
) -> list[InsightCandidate]:
    window_ms = window_minutes * 60000
    candidates = []
    candidates += _pressure_candidates(events, match_id, match_duration_ms, window_ms)
    candidates += _chaos_candidates(events, match_id, match_duration_ms, window_ms)
    candidates += _rhythm_candidates(events, match_id, match_duration_ms)
    candidates += _milestone_candidates(events, match_id)
    candidates += _referee_candidates(events, match_id)
    if tendency_profiles:
        candidates += _tendency_candidates(events, match_id, tendency_profiles)
    candidates.sort(key=lambda c: c.window_start_min)
    return candidates
