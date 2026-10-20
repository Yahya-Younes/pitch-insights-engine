"""Infers each player's behavioral tendencies purely from observed match
events — the way a real scout or analytics system would have to, since it
never sees datagen's hidden PlayerTendencyProfile parameters. Those hidden
parameters exist only to provide a ground truth this module's output can be
scored against (see `accuracy_report`); the live pipeline only ever uses the
*inferred* profile.

Deliberately a frequency/statistical model, not a trained ML model: for a
7-day synthetic-data hackathon this is both the pragmatic choice and the more
explainable one — every inferred number traces directly to an observed count,
which matters a lot for a project whose whole premise is explainability.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from datagen.pitch_grid import ZONE_LABELS, zone_of
from datagen.schema import AnyEvent, PlayerTendencyProfile

_ACTION_EVENT_TYPES = {"pass", "dribble", "carry"}


@dataclass
class InferredTendencyProfile:
    player_id: str
    sample_size: int
    zone_bias: dict[str, float]
    action_bias_under_pressure: dict[str, float]
    dribble_tendency: float
    directness: float
    shot_on_sight: float


def _action_label(e: AnyEvent) -> str | None:
    if e.type == "pass":
        return "pass"
    if e.type == "dribble":
        return "dribble"
    if e.type == "carry":
        return "carry"
    if e.type == "possession_change" and e.reason == "turnover" and e.player_id:
        return "lose_possession"
    return None


def infer_player_profile(events: list[AnyEvent], player_id: str) -> InferredTendencyProfile | None:
    player_events = [e for e in events if getattr(e, "player_id", None) == player_id]
    if not player_events:
        return None

    zone_counts: Counter[str] = Counter(zone_of(e.location) for e in player_events if getattr(e, "location", None))
    zone_total = sum(zone_counts.values()) or 1
    zone_bias = {z: zone_counts.get(z, 0) / zone_total for z in ZONE_LABELS}

    pressured_actions: Counter[str] = Counter()
    for e in player_events:
        if not getattr(e, "under_pressure", False):
            continue
        label = _action_label(e)
        if label:
            pressured_actions[label] += 1
    pressured_total = sum(pressured_actions.values())
    if pressured_total > 0:
        action_bias = {k: pressured_actions.get(k, 0) / pressured_total for k in ("pass", "dribble", "carry", "lose_possession")}
    else:
        action_bias = {"pass": 0.0, "dribble": 0.0, "carry": 0.0, "lose_possession": 0.0}

    dribble_attempts = [e for e in player_events if e.type == "dribble"]
    pass_and_dribble_decisions = [e for e in player_events if e.type in ("pass", "dribble")]
    dribble_tendency = len(dribble_attempts) / max(1, len(pass_and_dribble_decisions))

    passes = [e for e in player_events if e.type == "pass"]
    directness = (sum(1 for p in passes if p.distance_m > 15 and abs(p.angle_deg) < 50) / max(1, len(passes)))

    shots = [e for e in player_events if e.type == "shot"]
    shot_on_sight = len(shots) / max(1, len(shots) + len(pass_and_dribble_decisions) // 8)

    return InferredTendencyProfile(
        player_id=player_id, sample_size=len(player_events), zone_bias=zone_bias,
        action_bias_under_pressure=action_bias, dribble_tendency=round(dribble_tendency, 3),
        directness=round(min(1.0, directness), 3), shot_on_sight=round(min(1.0, shot_on_sight), 3),
    )


def infer_all_profiles(events: list[AnyEvent], player_ids: list[str]) -> dict[str, InferredTendencyProfile]:
    out = {}
    for pid in player_ids:
        profile = infer_player_profile(events, pid)
        if profile is not None:
            out[pid] = profile
    return out


def expected_action(action_bias: dict[str, float]) -> str:
    return max(action_bias, key=lambda k: action_bias[k])


def tendency_alignment_score(inferred: InferredTendencyProfile, actual_action: str, under_pressure: bool) -> float:
    """Probability mass the inferred profile assigns to the action that was actually taken.
    High score -> "in character"; low score -> "out of character" (tendency_break)."""
    if not under_pressure:
        return 0.5
    return inferred.action_bias_under_pressure.get(actual_action, 0.0)


# ---------------------------------------------------------------------------
# Ground-truth evaluation: how well does the inferred model recover the
# generator's hidden tendency parameters? Dominant-tendency recovery accuracy
# is the headline number reported in the README/pitch.
# ---------------------------------------------------------------------------

@dataclass
class AccuracyReport:
    n_players: int
    dominant_action_matches: int
    dominant_action_accuracy: float
    mean_zone_overlap: float
    mean_dribble_tendency_error: float


def _dominant_action(bias: dict[str, float]) -> str:
    return max(bias, key=lambda k: bias[k])


def _zone_overlap(a: dict[str, float], b: dict[str, float]) -> float:
    """Histogram intersection (0-1): how much probability mass the two zone
    distributions agree on."""
    return sum(min(a.get(z, 0.0), b.get(z, 0.0)) for z in ZONE_LABELS)


def accuracy_report(
    ground_truth: dict[str, PlayerTendencyProfile],
    inferred: dict[str, InferredTendencyProfile],
) -> AccuracyReport:
    matched_players = [pid for pid in ground_truth if pid in inferred]
    matches = 0
    zone_overlaps = []
    dribble_errors = []

    for pid in matched_players:
        truth = ground_truth[pid]
        est = inferred[pid]
        truth_bias = truth.action_bias_under_pressure.model_dump(by_alias=True)
        if est.sample_size >= 5 and _dominant_action(truth_bias) == _dominant_action(est.action_bias_under_pressure):
            matches += 1
        zone_overlaps.append(_zone_overlap(truth.zone_bias, est.zone_bias))
        dribble_errors.append(abs(truth.dribble_tendency - est.dribble_tendency))

    n = len(matched_players) or 1
    return AccuracyReport(
        n_players=len(matched_players),
        dominant_action_matches=matches,
        dominant_action_accuracy=round(matches / n, 3),
        mean_zone_overlap=round(sum(zone_overlaps) / n, 3),
        mean_dribble_tendency_error=round(sum(dribble_errors) / n, 3),
    )
