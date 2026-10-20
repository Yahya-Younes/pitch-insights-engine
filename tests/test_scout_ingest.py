from agents.scout.ingest import parse_event, parse_events


def _valid_shot_dict():
    return {
        "type": "shot", "match_id": "M1", "period": 1, "minute": 10, "second": 0,
        "match_clock_ms": 600000, "team": "home", "team_name": "Home",
        "player_id": "home_9", "player_name": "Striker", "location": [110, 40],
        "possession_id": 1, "end_location": [120, 40], "outcome": "goal",
        "xg": 0.4, "shot_speed_kmh": 90.0,
    }


def test_valid_event_parses_to_the_right_type():
    event = parse_event(_valid_shot_dict())
    assert event is not None
    assert event.type == "shot"
    assert event.outcome == "goal"


def test_unknown_type_is_rejected():
    assert parse_event({"type": "nonsense"}) is None


def test_missing_required_field_is_rejected():
    bad = _valid_shot_dict()
    del bad["xg"]
    assert parse_event(bad) is None


def test_missing_type_field_is_rejected():
    assert parse_event({"match_id": "M1"}) is None


def test_parse_events_separates_valid_from_rejected():
    raw = [_valid_shot_dict(), {"type": "nonsense"}, _valid_shot_dict()]
    events, rejected = parse_events(raw)
    assert len(events) == 2
    assert rejected == 1
