import random

from agents.analyst0.tendency_model import accuracy_report, infer_all_profiles
from datagen.match_simulator import MatchSimulator, build_squad


def _simulate_history(n_matches: int, squad_seed: int, match_seed_start: int):
    rng = random.Random(squad_seed)
    home = build_squad("home", "Thornbury United", rng)
    away = build_squad("away", "Castlefield FC", rng)
    all_events = []
    for i in range(n_matches):
        sim = MatchSimulator(f"SYN-HIST-{i}", seed=match_seed_start + i, home_squad=home, away_squad=away)
        all_events.extend(sim.generate_match().events)
    return home, away, all_events


def test_tendency_model_recovers_dominant_action_well():
    home, away, events = _simulate_history(n_matches=6, squad_seed=123, match_seed_start=200)
    ground_truth = {**home.profiles, **away.profiles}
    inferred = infer_all_profiles(events, list(ground_truth.keys()))

    assert len(inferred) == len(ground_truth)
    report = accuracy_report(ground_truth, inferred)

    assert report.n_players == 22
    assert 0.0 <= report.dominant_action_accuracy <= 1.0
    assert 0.0 <= report.mean_zone_overlap <= 1.0
    # the headline claim: the inference model should recover most players'
    # dominant pressured-action tendency correctly from observation alone.
    assert report.dominant_action_accuracy >= 0.8


def test_profiles_without_observations_are_skipped():
    home, away, events = _simulate_history(n_matches=1, squad_seed=5, match_seed_start=900)
    inferred = infer_all_profiles(events, ["nonexistent_player"])
    assert inferred == {}
