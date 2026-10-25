import random

from datagen.match_simulator import build_squad
from datagen.player_profiles import QUALITY_MAX, QUALITY_MIN, generate_market_value_eur, generate_squad_quality


def test_quality_is_within_bounds():
    rng = random.Random(1)
    for _ in range(50):
        q = generate_squad_quality(rng)
        assert QUALITY_MIN <= q <= QUALITY_MAX


def test_market_value_increases_with_quality():
    rng = random.Random(1)
    low = generate_market_value_eur(QUALITY_MIN, rng)
    high = generate_market_value_eur(QUALITY_MAX, rng)
    assert high > low * 10  # the curve is deliberately steep, not linear


def test_build_squad_stores_quality_and_market_value():
    rng = random.Random(1)
    squad = build_squad("home", "Test XI", rng, quality=1.2)
    assert squad.quality == 1.2
    assert squad.market_value_eur > 0


def test_build_squad_with_explicit_quality_is_reproducible():
    squad_a = build_squad("home", "Test XI", random.Random(5), quality=0.8)
    squad_b = build_squad("home", "Test XI", random.Random(5), quality=0.8)
    assert squad_a.market_value_eur == squad_b.market_value_eur


def test_higher_quality_squad_has_higher_shot_on_sight_on_average():
    """The causal link this feature depends on: quality scales directly
    into the attributes that already drive shot/pass outcomes in
    match_simulator.py, not just a cosmetic label."""
    rng_low = random.Random(1)
    rng_high = random.Random(1)
    low_squad = build_squad("home", "Cheap XI", rng_low, quality=QUALITY_MIN)
    high_squad = build_squad("home", "Expensive XI", rng_high, quality=QUALITY_MAX)
    low_mean = sum(p.shot_on_sight for p in low_squad.profiles.values()) / len(low_squad.profiles)
    high_mean = sum(p.shot_on_sight for p in high_squad.profiles.values()) / len(high_squad.profiles)
    assert high_mean > low_mean
