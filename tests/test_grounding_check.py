from eval.grounding_check import check_grounding, check_grounding_multi, grounding_pass_rate
from agents.shared.models import InsightCandidate

PLAYER_NAMES = {"home_7": "J. Okafor", "away_4": "M. Ferreira", "home_9": "D. Ribeiro"}


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


def _milestone_insight():
    return InsightCandidate(
        match_id="M1", window_start_min=12.0, window_end_min=12.0, trigger_type="milestone",
        metric_name="goal", metric_value=1.0, related_players=["home_9"],
        window_summary={"team": "home", "xg": 0.42},
    )


def test_multi_insight_grounding_passes_for_a_concierge_style_recap():
    text = (
        "D. Ribeiro scored in the 12th minute (xG 0.42). Minutes later, press intensified -- "
        "PPDA dropped to 4.1, a 47% fall from the 7.8 average, with 3 turnovers won."
    )
    result = check_grounding_multi(text, [_milestone_insight(), _pressure_insight()], PLAYER_NAMES)
    assert result.passed


def test_multi_insight_grounding_catches_unrelated_player_across_insights():
    text = "D. Ribeiro scored, and M. Ferreira also had a great chance around the same time."
    result = check_grounding_multi(text, [_milestone_insight()], PLAYER_NAMES)
    assert not result.entity_ok
    assert "M. Ferreira" in result.unmatched_entities


def test_multi_insight_grounding_empty_list_passes_trivially():
    result = check_grounding_multi("", [], PLAYER_NAMES)
    assert result.passed


def test_non_english_vocabulary_check_now_actually_runs():
    """Before agents.shared.glossary.TRIGGER_GLOSSARY existed, every
    non-English locale unconditionally set vocabulary_ok=True -- an
    off-topic translation would have incorrectly passed. It must now
    correctly fail, the same way the English wrong-topic case does."""
    text_fr = "À la minute 61, l'arbitre se trouvait à 23 mètres de l'incident, un appel discutable."
    result = check_grounding_multi(text_fr, [_pressure_insight()], PLAYER_NAMES, locale="fr")
    assert not result.vocabulary_ok


def test_italian_and_portuguese_glossary_anchored_text_passes():
    text_it = "Al 61 minuto, il pressing di Thornbury si e intensificato, il PPDA e sceso a 4.1."
    result_it = check_grounding_multi(text_it, [_pressure_insight()], PLAYER_NAMES, locale="it")
    assert result_it.vocabulary_ok

    text_pt = "Aos 61 minutos, a pressão de Thornbury intensificou-se, o PPDA caiu para 4.1."
    result_pt = check_grounding_multi(text_pt, [_pressure_insight()], PLAYER_NAMES, locale="pt")
    assert result_pt.vocabulary_ok


def test_italian_and_portuguese_off_topic_text_fails():
    text_it = "Al minuto 61, l'arbitro si trovava a 23 metri dall'episodio, una decisione discutibile."
    result_it = check_grounding_multi(text_it, [_pressure_insight()], PLAYER_NAMES, locale="it")
    assert not result_it.vocabulary_ok

    text_pt = "No minuto 61, o arbitro estava a 23 metros do lance, uma decisao discutivel."
    result_pt = check_grounding_multi(text_pt, [_pressure_insight()], PLAYER_NAMES, locale="pt")
    assert not result_pt.vocabulary_ok


def test_glossary_anchored_non_english_text_passes():
    """A translation that actually uses TRIGGER_GLOSSARY's fr/es/de terms
    for the insight's trigger_type must pass -- proving the restored check
    isn't just failing everything non-English by accident."""
    text_fr = "À la 61e minute, le pressing de Thornbury s'est intensifié, le PPDA est tombé à 4.1."
    result = check_grounding_multi(text_fr, [_pressure_insight()], PLAYER_NAMES, locale="fr")
    assert result.vocabulary_ok

    text_es = "En el minuto 61, la presión de Thornbury se intensificó, el PPDA cayó a 4.1."
    result_es = check_grounding_multi(text_es, [_pressure_insight()], PLAYER_NAMES, locale="es")
    assert result_es.vocabulary_ok

    text_de = "In der 61. Minute verstärkte sich das Pressing von Thornbury, der PPDA fiel auf 4.1."
    result_de = check_grounding_multi(text_de, [_pressure_insight()], PLAYER_NAMES, locale="de")
    assert result_de.vocabulary_ok


def test_unsupported_locale_still_skips_the_vocabulary_check():
    text = "Totally off-topic text about nothing in particular."
    result = check_grounding_multi(text, [_pressure_insight()], PLAYER_NAMES, locale="xx")
    assert result.vocabulary_ok


def _xt_surge_insight():
    return InsightCandidate(
        match_id="M1", window_start_min=40.0, window_end_min=43.0, trigger_type="xt_surge",
        metric_name="xt_gain", metric_value=1417.6, baseline_value=320.0, delta_pct=343.0,
        related_players=["home_9"], window_summary={"zone": "final_third"},
    )


def test_comma_thousands_separator_is_not_mistaken_for_a_fabricated_number():
    """Regression test: English narration legitimately writes a large number
    with a comma thousands-separator (e.g. "1,417.6"). The old single regex
    assumed comma-as-decimal everywhere, parsing "1,417.6" as two garbage
    tokens ("1,417" -> 1.417, "6" -> 6) instead of the real value 1417.6,
    and failing grounding on a correct number."""
    text = "Between minutes 40 and 43 the home side's threat spiked to 1,417.6, up from a baseline of 320."
    result = check_grounding(text, _xt_surge_insight(), PLAYER_NAMES)
    assert result.numeric_ok, result.unmatched_numbers


def test_plain_comma_grouped_integer_also_parses_correctly():
    text = "Their threat jumped to 1,417 in that window, miles above the 320 baseline."
    result = check_grounding(text, _xt_surge_insight(), PLAYER_NAMES)
    assert "1,417" not in result.unmatched_numbers


def test_real_world_club_name_leak_fails_grounding():
    """Narrator's own system prompt says never to mention a real Premier
    League club or player, but until now nothing actually enforced it --
    this is the realistic failure mode: the model name-drops something it
    knows from training, not just a fabricated stat."""
    text = "At minute 61, Thornbury's press intensified, echoing how Manchester City's PPDA dropped to 4.1."
    result = check_grounding(text, _pressure_insight(), PLAYER_NAMES)
    assert not result.real_world_ok
    assert "Manchester City" in result.real_world_leaks
    assert not result.passed


def test_legitimate_synthetic_team_names_never_trip_the_real_world_check():
    text = "In the 61st minute, Thornbury's press intensified — PPDA dropped to 4.1, down 47% from their average of 7.8, with 3 turnovers won in the window."
    result = check_grounding(text, _pressure_insight(), PLAYER_NAMES)
    assert result.real_world_ok
    assert result.real_world_leaks == []


def test_european_decimal_comma_still_parses_correctly_for_non_english_locale():
    """The fr/es/de locales use a bare comma as the decimal point -- make
    sure the English-vs-European parsing split didn't break that path."""
    text_fr = "En le minute 61, le pressing de Thornbury s'est intensifié, le PPDA est tombé à 4,1."
    result = check_grounding_multi(text_fr, [_pressure_insight()], PLAYER_NAMES, locale="fr")
    assert result.numeric_ok, result.unmatched_numbers
