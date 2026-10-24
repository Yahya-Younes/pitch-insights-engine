import pytest

from agents.analyst0.tactics_lab import simulate_formation_matchup


def test_matchup_record_sums_to_n_matches():
    result = simulate_formation_matchup("4-3-3", "4-5-1", n_matches=10, seed=1)
    record = result["home_record"]
    assert record["wins"] + record["draws"] + record["losses"] == 10


def test_matchup_is_deterministic_for_a_fixed_seed():
    a = simulate_formation_matchup("4-4-2", "3-5-2", n_matches=8, seed=42)
    b = simulate_formation_matchup("4-4-2", "3-5-2", n_matches=8, seed=42)
    assert a == b


def test_invalid_formation_raises():
    with pytest.raises(ValueError):
        simulate_formation_matchup("4-4-2", "not-a-formation", n_matches=5)


def test_reports_goals_xg_possession_and_ppda():
    result = simulate_formation_matchup("4-2-3-1", "3-4-3", n_matches=6, seed=7)
    assert result["mean_home_goals"] is not None
    assert result["mean_home_xg"] is not None
    assert 0 <= result["mean_home_possession_pct"] <= 100
    assert result["mean_home_ppda"] is None or result["mean_home_ppda"] > 0
