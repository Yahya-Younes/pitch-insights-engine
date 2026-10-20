from datagen.match_simulator import MatchSimulator


def test_generates_a_full_match_with_expected_event_types():
    result = MatchSimulator("SYN-TEST-0001", seed=42).generate_match()
    types = {e.type for e in result.events}

    assert result.events[0].type == "match_metadata"
    assert types.issuperset({"pass", "carry", "possession_change", "referee_position"})
    assert len(result.home_profiles) == 11
    assert len(result.away_profiles) == 11
    assert result.home_name != result.away_name


def test_turnover_events_attribute_a_player():
    result = MatchSimulator("SYN-TEST-0002", seed=11).generate_match()
    turnovers = [e for e in result.events if e.type == "possession_change" and e.reason == "turnover"]
    attributed = [e for e in turnovers if e.player_id]
    # not every turnover (interceptions, out-of-play) carries a losing player id,
    # but at least some (self-induced "lose possession" actions) must.
    assert len(attributed) > 0


def test_referee_decisions_have_plausible_positioning_fields():
    result = MatchSimulator("SYN-TEST-0003", seed=3).generate_match()
    decisions = [e for e in result.events if e.type == "referee_decision"]
    for d in decisions:
        assert d.referee_distance_to_incident_m >= 0
        assert 0 <= d.referee_viewing_angle_deg <= 180
        assert isinstance(d.contestable, bool)


def test_deterministic_given_same_seed():
    a = MatchSimulator("SYN-DET", seed=99).generate_match()
    b = MatchSimulator("SYN-DET", seed=99).generate_match()
    assert len(a.events) == len(b.events)
    assert [e.type for e in a.events] == [e.type for e in b.events]
