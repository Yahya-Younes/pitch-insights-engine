"""Scout agent: stage (a) of PITCH ("ingest"). Validates and normalizes raw
JSON-shaped event payloads -- as they'd arrive off Event Hubs -- into the
frozen Pydantic event schema. This is the actual ingest boundary: anything
malformed or unrecognized is rejected here, not silently passed downstream
to agents that assume well-typed input.
"""
from __future__ import annotations

from datagen.schema import (
    AnyEvent, CardEvent, CarryEvent, DribbleEvent, DuelEvent, FoulEvent,
    InterceptionEvent, MatchMetadataEvent, PassEvent, PossessionChangeEvent,
    PressureEvent, RefereeDecisionEvent, RefereePositionEvent, ShotEvent, TackleEvent,
)

_EVENT_TYPES: dict[str, type] = {
    "pass": PassEvent,
    "shot": ShotEvent,
    "carry": CarryEvent,
    "dribble": DribbleEvent,
    "tackle": TackleEvent,
    "interception": InterceptionEvent,
    "duel": DuelEvent,
    "pressure": PressureEvent,
    "possession_change": PossessionChangeEvent,
    "foul": FoulEvent,
    "card": CardEvent,
    "match_metadata": MatchMetadataEvent,
    "referee_position": RefereePositionEvent,
    "referee_decision": RefereeDecisionEvent,
}


def parse_event(raw: dict) -> AnyEvent | None:
    """Returns the validated typed event, or None if raw is malformed or an
    unrecognized type -- never raises, since a single bad event in a live
    feed shouldn't take down ingest for the rest of the match."""
    model_cls = _EVENT_TYPES.get(raw.get("type"))
    if model_cls is None:
        return None
    try:
        return model_cls.model_validate(raw)
    except Exception:
        return None


def parse_events(raw_events: list[dict]) -> tuple[list[AnyEvent], int]:
    """Returns (validated_events, rejected_count)."""
    validated: list[AnyEvent] = []
    rejected = 0
    for raw in raw_events:
        event = parse_event(raw)
        if event is None:
            rejected += 1
        else:
            validated.append(event)
    return validated, rejected
