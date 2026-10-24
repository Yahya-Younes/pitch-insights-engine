import random

from agents.analyst0.live_analytics import compute_match_analytics
from datagen.match_simulator import MatchSimulator, build_squad


def _sample_events(seed: int = 1):
    rng = random.Random(seed)
    home = build_squad("home", "Home XI", rng)
    away = build_squad("away", "Away XI", rng)
    sim = MatchSimulator("ANALYTICS-TEST", seed=seed, home_squad=home, away_squad=away)
    return sim.generate_match().events


def test_bucket_count_matches_duration_and_bucket_size():
    events = _sample_events()
    result = compute_match_analytics(events, 90 * 60000, bucket_minutes=5)
    assert result["n_buckets"] == 18
    assert len(result["buckets"]) == 18


def test_bucket_minutes_are_contiguous_and_cover_the_match():
    events = _sample_events()
    result = compute_match_analytics(events, 90 * 60000, bucket_minutes=10)
    buckets = result["buckets"]
    assert buckets[0]["start_min"] == 0.0
    assert buckets[-1]["end_min"] == 90.0
    for a, b in zip(buckets, buckets[1:]):
        assert a["end_min"] == b["start_min"]


def test_tempo_is_actually_populated_not_silently_none():
    """Regression test for the ms-vs-minutes key mismatch bug caught during
    development: tempo_series keys its series by milliseconds, and a naive
    minutes-keyed lookup would silently return None for every bucket."""
    events = _sample_events()
    result = compute_match_analytics(events, 90 * 60000, bucket_minutes=5)
    assert any(b["tempo_actions_per_min"] is not None for b in result["buckets"])


def test_possession_splits_are_valid_percentages():
    events = _sample_events()
    result = compute_match_analytics(events, 90 * 60000, bucket_minutes=5)
    for b in result["buckets"]:
        if b["possession_home_pct"] is not None:
            assert 0 <= b["possession_home_pct"] <= 100


def test_short_bucket_size_is_floored_to_one_minute():
    events = _sample_events()
    result = compute_match_analytics(events, 30 * 60000, bucket_minutes=0.1)
    assert result["n_buckets"] == 30
