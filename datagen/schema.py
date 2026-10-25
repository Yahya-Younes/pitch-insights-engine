"""Frozen event-schema contract for PITCH.

Pitch coordinates follow the StatsBomb convention: x in [0, 120], y in [0, 80],
attacking left-to-right for the "home" team. Every module in this repo
(data generation, metrics, agents, frontend) is built against these shapes.
"""
from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

Team = Literal["home", "away"]
Location = tuple[float, float]

PITCH_X_MAX = 120.0
PITCH_Y_MAX = 80.0


def new_id() -> str:
    return uuid4().hex


class EventEnvelope(BaseModel):
    """Fields shared by every on-pitch event."""

    event_id: str = Field(default_factory=new_id)
    match_id: str
    period: Literal[1, 2]
    minute: int
    second: int
    match_clock_ms: int
    team: Team
    team_name: str
    player_id: str
    player_name: str
    location: Location
    possession_id: int
    under_pressure: bool = False


class PassEvent(EventEnvelope):
    type: Literal["pass"] = "pass"
    end_location: Location
    recipient_id: str | None = None
    recipient_name: str | None = None
    outcome: Literal["complete", "incomplete", "out"]
    pass_type: Literal["ground", "low", "high"]
    body_part: Literal["right_foot", "left_foot", "head", "other"]
    distance_m: float
    angle_deg: float
    ball_speed_kmh: float


class ShotEvent(EventEnvelope):
    type: Literal["shot"] = "shot"
    end_location: Location
    outcome: Literal["goal", "saved", "blocked", "off_target"]
    xg: float
    shot_speed_kmh: float


class CarryEvent(EventEnvelope):
    type: Literal["carry"] = "carry"
    end_location: Location
    duration_s: float


class DribbleEvent(EventEnvelope):
    type: Literal["dribble"] = "dribble"
    outcome: Literal["complete", "nutmeg", "tackled"]
    opponent_id: str


class TackleEvent(EventEnvelope):
    type: Literal["tackle"] = "tackle"
    outcome: Literal["won", "lost"]
    opponent_id: str


class InterceptionEvent(EventEnvelope):
    type: Literal["interception"] = "interception"
    opponent_id: str


class DuelEvent(EventEnvelope):
    type: Literal["duel"] = "duel"
    outcome: Literal["won", "lost"]
    opponent_id: str
    duel_type: Literal["aerial", "ground"]


class PressureEvent(EventEnvelope):
    type: Literal["pressure"] = "pressure"
    duration_s: float
    target_player_id: str


class PossessionChangeEvent(EventEnvelope):
    type: Literal["possession_change"] = "possession_change"
    reason: Literal["turnover", "goal", "out_of_play", "foul"]


class FoulEvent(EventEnvelope):
    type: Literal["foul"] = "foul"
    opponent_id: str
    severity: Literal["minor", "reckless", "serious"]


class CardEvent(EventEnvelope):
    type: Literal["card"] = "card"
    card_type: Literal["yellow", "red"]
    reason: str


OnPitchEvent = (
    PassEvent
    | ShotEvent
    | CarryEvent
    | DribbleEvent
    | TackleEvent
    | InterceptionEvent
    | DuelEvent
    | PressureEvent
    | PossessionChangeEvent
    | FoulEvent
    | CardEvent
)


class MatchMetadataEvent(BaseModel):
    type: Literal["match_metadata"] = "match_metadata"
    event_id: str = Field(default_factory=new_id)
    match_id: str
    kickoff_utc: str
    venue: str
    weather: str
    home_team: str
    away_team: str
    home_formation: str
    away_formation: str
    home_lineup: list[str]
    away_lineup: list[str]
    referee_name: str
    home_market_value_eur: float = 0.0
    away_market_value_eur: float = 0.0


class RefereePositionEvent(BaseModel):
    """Emitted on a fixed cadence (e.g. every 2s of match time), not per play event."""

    type: Literal["referee_position"] = "referee_position"
    event_id: str = Field(default_factory=new_id)
    match_id: str
    period: Literal[1, 2]
    minute: int
    second: int
    match_clock_ms: int
    location: Location


class RefereeDecisionEvent(BaseModel):
    type: Literal["referee_decision"] = "referee_decision"
    event_id: str = Field(default_factory=new_id)
    match_id: str
    period: Literal[1, 2]
    minute: int
    second: int
    match_clock_ms: int
    decision_type: Literal["foul_called", "advantage_played", "card_issued", "var_review"]
    referee_location: Location
    incident_location: Location
    referee_distance_to_incident_m: float
    referee_viewing_angle_deg: float
    incident_severity: Literal["minor", "reckless", "serious"]
    contestable: bool
    related_player_ids: list[str]


AnyEvent = OnPitchEvent | MatchMetadataEvent | RefereePositionEvent | RefereeDecisionEvent


class ActionBias(BaseModel):
    """Probabilities must sum to ~1.0; validated in player_profiles.py."""

    pass_: float = Field(alias="pass")
    dribble: float
    carry: float
    lose_possession: float

    model_config = {"populate_by_name": True}


class PlayerTendencyProfile(BaseModel):
    """Hidden ground-truth parameters that drive a synthetic player's behavior.

    The inference side (agents/analyst0/tendency_model.py) never sees this directly —
    it re-derives an estimate from observed events, and accuracy against this
    ground truth is the tendency-model evaluation metric.
    """

    player_id: str
    player_name: str
    position: Literal["GK", "CB", "FB", "CM", "WM", "FW"]
    preferred_foot: Literal["left", "right", "both"]
    zone_bias: dict[str, float]
    action_bias_under_pressure: ActionBias
    directness: float = Field(ge=0.0, le=1.0)
    dribble_tendency: float = Field(ge=0.0, le=1.0)
    sprint_frequency_per_match: float
    preferred_sprint_zones: list[str]
    shot_on_sight: float = Field(ge=0.0, le=1.0)
