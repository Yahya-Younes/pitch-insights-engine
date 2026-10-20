from eval.grounding_check import check_grounding, grounding_pass_rate
from agents.shared.models import InsightCandidate

PLAYER_NAMES = {"home_7": "J. Okafor", "away_4": "M. Ferreira"}


def _pressure_insight():
    return InsightCandidate(
        match_id="M1", window_start_min=61.0, window_end_min=63.0, trigger_type="pressure_spike",
        metric_name="ppda_home", metric_value=4.1, baseline_value=7.8, delta_pct=-47.4,
        related_players=["home_7"], window_summary={"turnovers": 3},
    )


def test_well_grounded_narrative_passes():
    text = "In the 61st minute, Thornbury's press intensified — PPDA dropped to 4.1, down 47% from their average of 7.8, with 3 turnovers won in the window."
    result = check_grounding(text, _pressure_insight(), PLAYER_NAMES)
    assert result.passed


def test_fabricated_number_fails_numeric_check():
    text = "The press ramped up around minute 61, with the team completing 19 consecutive passes under pressure."
    result = check_grounding(text, _pressure_insight(), PLAYER_NAMES)
    assert not result.numeric_ok
    assert "19" in result.unmatched_numbers


def test_unrelated_player_mention_fails_entity_check():
    text = "Around the 61st minute, M. Ferreira surged forward as the press intensified, dropping PPDA to 4.1."
    result = check_grounding(text, _pressure_insight(), PLAYER_NAMES)
    assert not result.entity_ok
    assert "M. Ferreira" in result.unmatched_entities


def test_wrong_topic_fails_vocabulary_check():
    text = "At minute 61, the referee was 23 meters away from the incident, a contestable call."
    result = check_grounding(text, _pressure_insight(), PLAYER_NAMES)
    assert not result.vocabulary_ok


def test_grounding_pass_rate_aggregates_correctly():
    insight = _pressure_insight()
    good = check_grounding("Press spiked at minute 61, PPDA fell to 4.1.", insight, PLAYER_NAMES)
    bad = check_grounding("At minute 61 they completed 19 passes.", insight, PLAYER_NAMES)
    assert grounding_pass_rate([good, bad]) == 0.5
    assert grounding_pass_rate([]) == 1.0
