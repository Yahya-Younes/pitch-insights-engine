from agents.analyst0.formation_tracker import (
    build_tactical_timeline,
    identify_goalkeeper,
    infer_formation_label,
    score_shift_detection,
)
from datagen.match_simulator import MatchSimulator

DURATION_MS = 90 * 60000


def test_identify_goalkeeper_finds_the_deepest_average_player():
    sim = MatchSimulator("FT-GK", seed=11)
    result = sim.generate_match()
    gk_id = identify_goalkeeper(result.events, "home", "left_to_right")
    # The actual keeper is always slot 1 by construction (datagen/formations.py
    # lists GK first in every formation template).
    assert gk_id == "home_1"


def test_infer_formation_label_matches_band_count():
    positions = {
        "gk": (5.0, 40.0),
        "d1": (18.0, 20.0), "d2": (18.0, 60.0),
        "m1": (50.0, 20.0), "m2": (50.0, 40.0), "m3": (50.0, 60.0),
        "f1": (95.0, 30.0), "f2": (95.0, 50.0),
    }
    label = infer_formation_label(positions, "left_to_right", gk_id="gk")
    assert label == "2-3-2"


def test_infer_formation_label_none_with_too_few_players():
    assert infer_formation_label({"a": (10.0, 10.0), "b": (20.0, 20.0)}, "left_to_right", gk_id=None) is None


def test_build_tactical_timeline_detects_a_real_shift_with_reasonable_timing():
    """Runs several seeds and requires that whenever a team actually had a
    hidden shift, the live, event-only inference detects *some* shift
    (timing can legitimately be off by several minutes -- this only
    asserts detection happens and lands in roughly the right half of the
    match, not pixel-perfect timing).

    Threshold has real headroom (50min, not a tight bound) deliberately:
    any new rng.X() call added earlier in match generation (e.g. squad
    quality -- see datagen/player_profiles.py) reshuffles every subsequent
    random draw for a given seed, which can shift a borderline case's exact
    timing a few minutes either way without reflecting any real change in
    formation-tracker accuracy itself."""
    seen_a_real_shift = False
    worst_timing_error = 0.0
    for seed in range(1, 30):
        sim = MatchSimulator(f"FT-SHIFT-{seed}", seed=seed)
        result = sim.generate_match()
        for team, direction, team_state in (
            ("home", "left_to_right", sim.home), ("away", "right_to_left", sim.away),
        ):
            if team_state.shift is None:
                continue
            seen_a_real_shift = True
            timeline = build_tactical_timeline(result.events, team, direction, team_state.starting_formation, DURATION_MS)
            score = score_shift_detection(timeline, team_state.shift.at_ms, DURATION_MS)
            assert score.detected, f"seed={seed} team={team} failed to detect a real shift at all"
            assert score.timing_error_min is not None
            worst_timing_error = max(worst_timing_error, score.timing_error_min)
    assert seen_a_real_shift
    assert worst_timing_error < 50.0, f"worst timing error across all seeds was {worst_timing_error}min"


def test_score_shift_detection_no_shift_but_falsely_detected_one():
    from agents.analyst0.formation_tracker import ShiftDetection, TacticalTimeline

    timeline = TacticalTimeline(team="home", starting_formation="4-3-3")
    timeline.shifts = [ShiftDetection(at_min=50.0, from_label="4-3-3", to_label="3-4-3")]
    score = score_shift_detection(timeline, truth_at_ms=None, duration_ms=DURATION_MS)
    assert not score.had_shift
    assert score.false_positive_count == 1


def test_score_shift_detection_real_shift_never_detected():
    from agents.analyst0.formation_tracker import TacticalTimeline

    timeline = TacticalTimeline(team="home", starting_formation="4-3-3")
    score = score_shift_detection(timeline, truth_at_ms=40 * 60000, duration_ms=DURATION_MS)
    assert score.had_shift
    assert not score.detected
    assert score.timing_error_min is None
