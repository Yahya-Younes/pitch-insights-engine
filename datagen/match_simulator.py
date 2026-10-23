"""Possession-chain FSM that generates a full synthetic 90-minute match as a
chronological list of events. Player behavior is weighted by each player's
hidden PlayerTendencyProfile (see player_profiles.py), so the same player
behaves consistently across a match — the raw material the tendency-inference
model (agents/analyst0/tendency_model.py) later has to re-derive from
observation alone.

Honest scope note: this is a deliberately simplified stochastic model (distance/
pressure-based pass success, a crude distance+centrality xG, a lerp-based referee
positioning proxy for the Diagonal System of Control) — it is not a physics or
tracking-data simulation. It's tuned for plausible variability and internal
consistency, not for matching real StatsBomb/Opta event-rate distributions
exactly.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

from datagen.formations import FORMATIONS, formation_names, plausible_shift_target, slot_to_location
from datagen.player_profiles import generate_squad
from datagen.schema import (
    AnyEvent,
    CardEvent,
    CarryEvent,
    DribbleEvent,
    DuelEvent,
    FoulEvent,
    InterceptionEvent,
    Location,
    MatchMetadataEvent,
    PITCH_X_MAX,
    PITCH_Y_MAX,
    PassEvent,
    PlayerTendencyProfile,
    PossessionChangeEvent,
    PressureEvent,
    RefereeDecisionEvent,
    RefereePositionEvent,
    ShotEvent,
    TackleEvent,
    Team,
)

PERIOD_MS = 45 * 60 * 1000
TICK_MS_RANGE = (2000, 6000)
REFEREE_POSITION_INTERVAL_MS = 4000
MAX_TICKS = 6000

TEAM_NAME_POOL = [
    "Thornbury United", "Castlefield FC", "Marshgate Albion", "Elmhurst City", "Saltbridge Rovers",
]
REFEREE_NAME_POOL = ["R. Dunmore", "A. Kessler", "P. Everhart", "L. Beaumont"]

_DEFENSIVE_TACKLE_FACTOR = {"GK": 0.1, "CB": 0.18, "FB": 0.15, "CM": 0.1, "WM": 0.05, "FW": 0.03}


def _goal_location(direction: str) -> Location:
    return (120.0, 40.0) if direction == "left_to_right" else (0.0, 40.0)


def _distance(a: Location, b: Location) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _jitter(loc: Location, rng: random.Random, sx: float = 8.0, sy: float = 6.0) -> Location:
    x = _clip(loc[0] + rng.gauss(0, sx), 0, PITCH_X_MAX)
    y = _clip(loc[1] + rng.gauss(0, sy), 0, PITCH_Y_MAX)
    return (x, y)


def _xg(shot_location: Location, goal: Location) -> float:
    dist = _distance(shot_location, goal)
    centrality = 1.0 - min(1.0, abs(shot_location[1] - 40.0) / 40.0) * 0.5
    raw = math.exp(-dist / 18.0) * centrality * 0.65
    return round(_clip(raw, 0.01, 0.75), 3)


def _baseline_bias(profile: PlayerTendencyProfile) -> dict[str, float]:
    bias = profile.action_bias_under_pressure
    raw = {
        "pass": bias.pass_ * 1.3,
        "dribble": bias.dribble * 0.8,
        "carry": bias.carry * 1.0,
        "lose_possession": bias.lose_possession * 0.3,
    }
    total = sum(raw.values())
    return {k: v / total for k, v in raw.items()}


def _weighted_choice(rng: random.Random, weights: dict[str, float]) -> str:
    return rng.choices(list(weights.keys()), weights=list(weights.values()), k=1)[0]


@dataclass
class SquadState:
    """A reusable squad definition -- its starting formation and
    expected_locations never change, so the same SquadState can safely back
    several different MatchSimulator runs (e.g. service/stats.py's
    tendency-history simulation reuses one home/away SquadState across 6
    matches). Per-match mutable state (a possible mid-match tactical shift)
    lives on MatchTeamState instead, never here."""

    team: Team
    team_name: str
    direction: str
    profiles: dict[str, PlayerTendencyProfile]
    expected_locations: dict[str, Location]
    starting_formation: str


@dataclass
class TacticalShiftTruth:
    """Hidden ground truth for one team's mid-match tactical reshuffle --
    analogous to PlayerTendencyProfile's hidden parameters: the live
    pipeline never sees this directly, it exists so Analyst-0's
    event-location-only shift *inference* (agents/analyst0/formation_tracker.py)
    can be scored against something real, the same honest evaluation
    pattern already used for player tendencies."""

    at_ms: int
    from_formation: str
    to_formation: str
    role_changes: dict[str, tuple[str, str]]  # player_id -> (old_position, new_position)


@dataclass
class MatchTeamState:
    """Per-match, mutable tactical state for one team -- wraps a reusable
    SquadState with this match's own current positions (which may swap
    mid-match if a tactical shift was rolled) without ever mutating the
    shared SquadState itself."""

    squad: SquadState
    locations: dict[str, Location]
    starting_formation: str
    shift: TacticalShiftTruth | None = None
    shift_locations: dict[str, Location] | None = None
    shifted: bool = False

    @property
    def team(self) -> Team:
        return self.squad.team

    @property
    def team_name(self) -> str:
        return self.squad.team_name

    @property
    def direction(self) -> str:
        return self.squad.direction

    @property
    def profiles(self) -> dict[str, PlayerTendencyProfile]:
        return self.squad.profiles

    def nearest_player(self, location: Location, rng: random.Random, exclude: set[str] | None = None) -> str:
        exclude = exclude or set()
        candidates = [pid for pid in self.profiles if pid not in exclude]
        jittered = {pid: _jitter(self.locations[pid], rng) for pid in candidates}
        return min(candidates, key=lambda pid: _distance(jittered[pid], location))

    def maybe_apply_shift(self, total_ms: int) -> bool:
        """Swaps in the post-shift locations once total_ms reaches the
        shift's timestamp -- called every tick for both teams; a no-op
        every time except the one tick it actually triggers on."""
        if self.shift is None or self.shifted or total_ms < self.shift.at_ms or self.shift_locations is None:
            return False
        self.locations = self.shift_locations
        self.shifted = True
        return True


@dataclass
class MatchResult:
    match_id: str
    home_name: str
    away_name: str
    events: list[AnyEvent]
    home_profiles: list[PlayerTendencyProfile]
    away_profiles: list[PlayerTendencyProfile]
    home_tactical_shift: TacticalShiftTruth | None = None
    away_tactical_shift: TacticalShiftTruth | None = None


def build_squad(
    team: Team, team_name: str, rng: random.Random, used_names: set[str] | None = None, formation: str | None = None,
) -> SquadState:
    if formation is None:
        formation = rng.choice(formation_names())
    profiles_list = generate_squad(team, rng, used_names, formation=formation)
    direction = "left_to_right" if team == "home" else "right_to_left"
    profiles = {p.player_id: p for p in profiles_list}
    slots = FORMATIONS[formation]
    expected = {p.player_id: slot_to_location(slot, direction) for p, slot in zip(profiles_list, slots)}
    return SquadState(team=team, team_name=team_name, direction=direction,
                       profiles=profiles, expected_locations=expected, starting_formation=formation)


# Probability either team has a mid-match reshuffle at all -- independent
# per team, so a match might see one team shift, both, or neither.
_SHIFT_PROBABILITY = 0.6


def _build_tactical_shift(
    squad: SquadState, duration_ms: int, rng: random.Random,
) -> tuple[TacticalShiftTruth | None, dict[str, Location] | None]:
    if rng.random() >= _SHIFT_PROBABILITY:
        return None, None
    targets = plausible_shift_target(squad.starting_formation)
    if not targets:
        return None, None
    to_formation = rng.choice(targets)
    at_ms = int(duration_ms * rng.uniform(0.28, 0.72))
    new_slots = FORMATIONS[to_formation]
    # dict preserves insertion order -- profiles was built via
    # {p.player_id: p for p in profiles_list}, so this iterates home_1..home_11
    # in the same order the original formation's slots were assigned in,
    # letting index position double as the old-slot-to-new-slot mapping
    # (e.g. a winger's index landing on a new formation's CM slot reads as
    # "that player tucked inside into central midfield" -- a plausible,
    # legible role change, not an arbitrary reassignment).
    player_ids = list(squad.profiles.keys())
    role_changes: dict[str, tuple[str, str]] = {}
    new_locations: dict[str, Location] = {}
    for idx, pid in enumerate(player_ids):
        old_position = squad.profiles[pid].position
        new_slot = new_slots[idx] if idx < len(new_slots) else new_slots[-1]
        new_position = new_slot[0]
        new_locations[pid] = slot_to_location(new_slot, squad.direction)
        if new_position != old_position:
            role_changes[pid] = (old_position, new_position)
    shift = TacticalShiftTruth(
        at_ms=at_ms, from_formation=squad.starting_formation, to_formation=to_formation, role_changes=role_changes,
    )
    return shift, new_locations


def _build_team_state(squad: SquadState, duration_ms: int, rng: random.Random) -> MatchTeamState:
    shift, shift_locations = _build_tactical_shift(squad, duration_ms, rng)
    return MatchTeamState(
        squad=squad, locations=dict(squad.expected_locations), starting_formation=squad.starting_formation,
        shift=shift, shift_locations=shift_locations,
    )


class MatchSimulator:
    """Pass in `home_squad`/`away_squad` (e.g. from build_squad, reused across
    several matches) to simulate the same persistent players facing different
    opponents/situations — this is what makes a real tendency "history" across
    matches possible, rather than every match inventing brand-new players."""

    def __init__(self, match_id: str, seed: int, home_squad: SquadState | None = None, away_squad: SquadState | None = None):
        self.match_id = match_id
        self.rng = random.Random(seed)
        if home_squad is None or away_squad is None:
            home_name, away_name = self.rng.sample(TEAM_NAME_POOL, 2)
            shared_used_names: set[str] = set()
            home_squad = build_squad("home", home_name, self.rng, shared_used_names)
            away_squad = build_squad("away", away_name, self.rng, shared_used_names)
        duration_ms = 2 * PERIOD_MS
        # Wrapped into a fresh per-match MatchTeamState even when the squad
        # is reused across several matches (service/stats.py's tendency-
        # history simulation does this) -- a tactical shift must never
        # mutate the shared, reusable SquadState itself.
        self.home = _build_team_state(home_squad, duration_ms, self.rng)
        self.away = _build_team_state(away_squad, duration_ms, self.rng)
        self.referee_location: Location = (60.0, 40.0)
        self.events: list[AnyEvent] = []
        self.possession_id = 0
        self._last_ref_position_ms: int | None = None

    def _squad_for(self, team: Team) -> MatchTeamState:
        return self.home if team == "home" else self.away

    def _opponent_of(self, team: Team) -> MatchTeamState:
        return self.away if team == "home" else self.home

    def _global_clock(self, period: int, within_period_ms: int) -> tuple[int, int, int]:
        total_ms = within_period_ms if period == 1 else PERIOD_MS + within_period_ms
        minute = total_ms // 60000
        second = (total_ms // 1000) % 60
        return total_ms, minute, second

    def _emit_metadata(self) -> MatchMetadataEvent:
        return MatchMetadataEvent(
            match_id=self.match_id,
            kickoff_utc="2026-10-24T15:00:00Z",
            venue="Marshgate Common Stadium (synthetic)",
            weather="Overcast, 14C, light wind",
            home_team=self.home.team_name,
            away_team=self.away.team_name,
            home_formation=self.home.starting_formation,
            away_formation=self.away.starting_formation,
            home_lineup=[p.player_name for p in self.home.profiles.values()],
            away_lineup=[p.player_name for p in self.away.profiles.values()],
            referee_name=self.rng.choice(REFEREE_NAME_POOL),
        )

    def _update_referee(self, ball_location: Location) -> None:
        rx, ry = self.referee_location
        bx, by = ball_location
        target = (bx, 40.0 + (by - 40.0) * 0.55)
        self.referee_location = (
            _clip(rx + (target[0] - rx) * 0.3 + self.rng.gauss(0, 1.2), 0, PITCH_X_MAX),
            _clip(ry + (target[1] - ry) * 0.3 + self.rng.gauss(0, 1.2), 0, PITCH_Y_MAX),
        )

    def _positioning_quality(self, incident_location: Location) -> tuple[float, float, float]:
        dist = _distance(self.referee_location, incident_location)
        dx = incident_location[0] - self.referee_location[0]
        dy = incident_location[1] - self.referee_location[1]
        angle = math.degrees(math.atan2(abs(dy), max(1.0, abs(dx))))
        quality = _clip(1.0 - (dist / 35.0) * 0.6 - (angle / 90.0) * 0.4, 0.0, 1.0)
        return dist, angle, quality

    def _maybe_emit_referee_decision(
        self, total_ms: int, period: int, minute: int, second: int,
        decision_type: str, incident_location: Location, severity: str,
        related_player_ids: list[str],
    ) -> None:
        dist, angle, quality = self._positioning_quality(incident_location)
        contestable_prob = _clip(0.75 - quality * 0.65, 0.03, 0.85)
        contestable = self.rng.random() < contestable_prob
        self.events.append(RefereeDecisionEvent(
            match_id=self.match_id, period=period, minute=minute, second=second,
            match_clock_ms=total_ms, decision_type=decision_type,
            referee_location=self.referee_location, incident_location=incident_location,
            referee_distance_to_incident_m=round(dist, 1), referee_viewing_angle_deg=round(angle, 1),
            incident_severity=severity, contestable=contestable, related_player_ids=related_player_ids,
        ))

    def generate_match(self) -> MatchResult:
        self.events.append(self._emit_metadata())

        period = 1
        within_ms = 0
        possessing = self.home
        ball_location: Location = (60.0, 40.0)
        self.possession_id = 1
        carrier_id = possessing.nearest_player(ball_location, self.rng)

        for _ in range(MAX_TICKS):
            if within_ms >= PERIOD_MS:
                if period == 1:
                    period = 2
                    within_ms = 0
                    possessing = self.away
                    ball_location = (60.0, 40.0)
                    self.possession_id += 1
                    carrier_id = possessing.nearest_player(ball_location, self.rng)
                else:
                    break

            within_ms += self.rng.randint(*TICK_MS_RANGE)
            total_ms, minute, second = self._global_clock(period, min(within_ms, PERIOD_MS))

            self.home.maybe_apply_shift(total_ms)
            self.away.maybe_apply_shift(total_ms)

            self._update_referee(ball_location)
            if self._last_ref_position_ms is None or total_ms - self._last_ref_position_ms >= REFEREE_POSITION_INTERVAL_MS:
                self.events.append(RefereePositionEvent(
                    match_id=self.match_id, period=period, minute=minute, second=second,
                    match_clock_ms=total_ms, location=self.referee_location,
                ))
                self._last_ref_position_ms = total_ms

            opponent = self._opponent_of(possessing.team)
            carrier = possessing.profiles[carrier_id]
            goal = _goal_location(possessing.direction)
            dist_to_goal = _distance(ball_location, goal)

            own_defensive = (possessing.direction == "left_to_right" and ball_location[0] < 30) or (
                possessing.direction == "right_to_left" and ball_location[0] > 90)
            pressure_prob = 0.3 + (0.12 if own_defensive else 0.0)
            under_pressure = self.rng.random() < pressure_prob

            # Proximity to goal now meaningfully gates the decision to shoot
            # at all (tapering to ~0 at the edge of the 28-unit radius),
            # not just the shot's quality via _xg() -- without this, a
            # player 27 units out had the same ~50% chance to pull the
            # trigger each tick as one standing in the six-yard box, which
            # (once real formation spacing let an attacker legitimately
            # camp near the edge of this radius for several consecutive
            # ticks) produced wildly unrealistic shot counts.
            shot_distance_factor = _clip(1.0 - dist_to_goal / 28.0, 0.0, 1.0) ** 1.25
            shot_prob = (carrier.shot_on_sight * 0.85 + 0.07) * shot_distance_factor * (0.75 if under_pressure else 1.0)
            if dist_to_goal < 28 and self.rng.random() < shot_prob:
                ball_location, carrier_id, possessing = self._handle_shot(
                    carrier, carrier_id, possessing, opponent, ball_location, goal,
                    total_ms, period, minute, second,
                )
                continue

            bias = carrier.action_bias_under_pressure.model_dump(by_alias=True) if under_pressure else _baseline_bias(carrier)
            action = _weighted_choice(self.rng, bias)

            if action == "lose_possession":
                self._emit_possession_change(total_ms, period, minute, second, possessing, "turnover", ball_location,
                                              player_id=carrier_id, player_name=carrier.player_name, under_pressure=under_pressure)
                possessing, carrier_id = opponent, opponent.nearest_player(ball_location, self.rng)
                continue

            if action == "carry":
                ball_location, carrier_id = self._handle_carry(
                    carrier, carrier_id, possessing, ball_location, under_pressure, total_ms, period, minute, second,
                )
                continue

            if action == "dribble":
                outcome = self._handle_dribble(
                    carrier, carrier_id, possessing, opponent, ball_location, under_pressure,
                    total_ms, period, minute, second,
                )
                ball_location, carrier_id, possessing = outcome
                continue

            # pass
            ball_location, carrier_id, possessing = self._handle_pass(
                carrier, carrier_id, possessing, opponent, ball_location, under_pressure,
                total_ms, period, minute, second,
            )

        return MatchResult(
            match_id=self.match_id, home_name=self.home.team_name, away_name=self.away.team_name,
            events=self.events, home_profiles=list(self.home.profiles.values()),
            away_profiles=list(self.away.profiles.values()),
            home_tactical_shift=self.home.shift, away_tactical_shift=self.away.shift,
        )

    def _emit_possession_change(self, total_ms, period, minute, second, team: MatchTeamState, reason: str, location: Location,
                                 player_id: str = "", player_name: str = "", under_pressure: bool = False) -> None:
        self.possession_id += 1
        self.events.append(PossessionChangeEvent(
            match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
            team=team.team, team_name=team.team_name, player_id=player_id, player_name=player_name, location=location,
            possession_id=self.possession_id, reason=reason, under_pressure=under_pressure,
        ))

    def _handle_shot(self, carrier, carrier_id, possessing, opponent, ball_location, goal, total_ms, period, minute, second):
        xg = _xg(ball_location, goal)
        roll = self.rng.random()
        outcome = "goal" if roll < xg else ("saved" if roll < xg + 0.35 else ("blocked" if roll < xg + 0.55 else "off_target"))
        shot_speed = round(self.rng.gauss(95, 15), 1)
        self.events.append(ShotEvent(
            match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
            team=possessing.team, team_name=possessing.team_name, player_id=carrier_id, player_name=carrier.player_name,
            location=ball_location, possession_id=self.possession_id, end_location=goal, outcome=outcome,
            xg=xg, shot_speed_kmh=max(30.0, shot_speed),
        ))
        if outcome == "goal":
            self._emit_possession_change(total_ms, period, minute, second, possessing, "goal", goal)
            new_team = self._opponent_of(possessing.team)
            return (60.0, 40.0), new_team.nearest_player((60.0, 40.0), self.rng), new_team
        self._emit_possession_change(total_ms, period, minute, second, possessing, "turnover", ball_location)
        new_team = self._opponent_of(possessing.team)
        new_location = _jitter(ball_location, self.rng, sx=4, sy=4)
        return new_location, new_team.nearest_player(new_location, self.rng), new_team

    def _handle_carry(self, carrier, carrier_id, possessing, ball_location, under_pressure, total_ms, period, minute, second):
        forward = 1 if possessing.direction == "left_to_right" else -1
        step = self.rng.uniform(3, 9)
        new_location = _jitter((ball_location[0] + forward * step, ball_location[1]), self.rng, sx=2, sy=3)
        duration = round(_distance(ball_location, new_location) / 6.5, 2)
        self.events.append(CarryEvent(
            match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
            team=possessing.team, team_name=possessing.team_name, player_id=carrier_id, player_name=carrier.player_name,
            location=ball_location, possession_id=self.possession_id, under_pressure=under_pressure,
            end_location=new_location, duration_s=duration,
        ))
        return new_location, carrier_id

    def _handle_dribble(self, carrier, carrier_id, possessing, opponent, ball_location, under_pressure, total_ms, period, minute, second):
        defender_id = opponent.nearest_player(ball_location, self.rng)
        defender = opponent.profiles[defender_id]
        tackle_factor = _DEFENSIVE_TACKLE_FACTOR[defender.position]
        success_prob = _clip(0.5 + carrier.dribble_tendency * 0.4 - tackle_factor, 0.1, 0.9)

        if self.rng.random() < 0.08:
            severity = self.rng.choices(["minor", "reckless", "serious"], weights=[0.6, 0.3, 0.1])[0]
            self.events.append(FoulEvent(
                match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
                team=opponent.team, team_name=opponent.team_name, player_id=defender_id,
                player_name=defender.player_name, location=ball_location, possession_id=self.possession_id,
                opponent_id=carrier_id, severity=severity,
            ))
            play_advantage = severity == "minor" and self.rng.random() < 0.3
            decision_type = "advantage_played" if play_advantage else "foul_called"
            self._maybe_emit_referee_decision(total_ms, period, minute, second, decision_type, ball_location,
                                               severity, [defender_id, carrier_id])
            if severity != "minor" and self.rng.random() < 0.5:
                card_type = "red" if severity == "serious" and self.rng.random() < 0.3 else "yellow"
                self.events.append(CardEvent(
                    match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
                    team=opponent.team, team_name=opponent.team_name, player_id=defender_id,
                    player_name=defender.player_name, location=ball_location, possession_id=self.possession_id,
                    card_type=card_type, reason=f"{severity} foul",
                ))
                self._maybe_emit_referee_decision(total_ms, period, minute, second, "card_issued", ball_location,
                                                   severity, [defender_id])
            if not play_advantage:
                self._emit_possession_change(total_ms, period, minute, second, possessing, "foul", ball_location)
                return ball_location, carrier_id, possessing

        success = self.rng.random() < success_prob
        outcome = "tackled" if not success else ("nutmeg" if self.rng.random() < 0.1 else "complete")
        self.events.append(DribbleEvent(
            match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
            team=possessing.team, team_name=possessing.team_name, player_id=carrier_id, player_name=carrier.player_name,
            location=ball_location, possession_id=self.possession_id, under_pressure=under_pressure,
            outcome=outcome, opponent_id=defender_id,
        ))
        if outcome == "tackled":
            self.events.append(TackleEvent(
                match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
                team=opponent.team, team_name=opponent.team_name, player_id=defender_id, player_name=defender.player_name,
                location=ball_location, possession_id=self.possession_id, outcome="won", opponent_id=carrier_id,
            ))
            self._emit_possession_change(total_ms, period, minute, second, possessing, "turnover", ball_location)
            return ball_location, defender_id, opponent

        forward = 1 if possessing.direction == "left_to_right" else -1
        new_location = _jitter((ball_location[0] + forward * 4, ball_location[1]), self.rng, sx=2, sy=3)
        return new_location, carrier_id, possessing

    def _handle_pass(self, carrier, carrier_id, possessing, opponent, ball_location, under_pressure, total_ms, period, minute, second):
        forward = 1 if possessing.direction == "left_to_right" else -1

        # Real passers don't meaningfully weigh all 10 outfield teammates as
        # live options -- only the handful who are actually in a realistic
        # passing lane at that moment. Restricting the candidate pool to the
        # nearest few (then weighting among just those) is what actually
        # keeps the average pass short-to-medium once player positions are
        # spread into a real formation shape; weighting the full 10-player
        # pool by distance alone still let the long diagonal option win too
        # often simply because most of the pool is far away by construction.
        teammates = [pid for pid in possessing.profiles if pid != carrier_id]
        by_distance = sorted(teammates, key=lambda pid: _distance(ball_location, possessing.locations[pid]))
        candidates = by_distance[:3]

        def score(pid: str) -> float:
            loc = _jitter(possessing.locations[pid], self.rng)
            dist = _distance(ball_location, loc)
            proximity = math.exp(-dist / 13.0)
            forward_gain = (loc[0] - ball_location[0]) * forward
            forward_bonus = 1.0 + carrier.directness * 0.25 * _clip(forward_gain / 40.0, -1.0, 1.0)
            return max(0.01, proximity * forward_bonus)

        weights = {pid: score(pid) for pid in candidates}
        recipient_id = _weighted_choice(self.rng, weights)
        recipient = possessing.profiles[recipient_id]
        end_location = _jitter(possessing.locations[recipient_id], self.rng)

        distance_m = _distance(ball_location, end_location)
        angle_deg = round(math.degrees(math.atan2(end_location[1] - ball_location[1], end_location[0] - ball_location[0])), 1)
        pass_type = "high" if distance_m > 35 else ("low" if distance_m > 15 else "ground")
        body_part = self.rng.choices(["right_foot", "left_foot", "head"], weights=[0.65, 0.25, 0.1])[0]
        flight_time = max(0.5, distance_m / 22.0)
        ball_speed = round((distance_m / flight_time) * 3.6, 1)

        accuracy_base = 0.88
        distance_penalty = min(0.45, distance_m / 100 * 0.45)
        pressure_penalty = 0.15 if under_pressure else 0.0
        prob_complete = _clip(accuracy_base - distance_penalty - pressure_penalty + self.rng.uniform(-0.05, 0.05), 0.05, 0.97)
        complete = self.rng.random() < prob_complete

        if pass_type == "high" and self.rng.random() < 0.25:
            duel_winner_is_recipient = self.rng.random() < 0.55
            duel_opponent_id = opponent.nearest_player(end_location, self.rng)
            self.events.append(DuelEvent(
                match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
                team=possessing.team if duel_winner_is_recipient else opponent.team,
                team_name=possessing.team_name if duel_winner_is_recipient else opponent.team_name,
                player_id=recipient_id if duel_winner_is_recipient else duel_opponent_id,
                player_name=recipient.player_name if duel_winner_is_recipient else opponent.profiles[duel_opponent_id].player_name,
                location=end_location, possession_id=self.possession_id, outcome="won",
                opponent_id=duel_opponent_id if duel_winner_is_recipient else recipient_id, duel_type="aerial",
            ))

        outcome = "complete" if complete else self.rng.choices(["incomplete", "out"], weights=[0.5, 0.5])[0]
        self.events.append(PassEvent(
            match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
            team=possessing.team, team_name=possessing.team_name, player_id=carrier_id, player_name=carrier.player_name,
            location=ball_location, possession_id=self.possession_id, under_pressure=under_pressure,
            end_location=end_location, recipient_id=recipient_id if complete else None,
            recipient_name=recipient.player_name if complete else None, outcome=outcome, pass_type=pass_type,
            body_part=body_part, distance_m=round(distance_m, 1), angle_deg=angle_deg, ball_speed_kmh=ball_speed,
        ))

        if complete:
            if self.rng.random() < 0.2:
                presser_id = opponent.nearest_player(end_location, self.rng)
                self.events.append(PressureEvent(
                    match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
                    team=opponent.team, team_name=opponent.team_name, player_id=presser_id,
                    player_name=opponent.profiles[presser_id].player_name, location=end_location,
                    possession_id=self.possession_id, duration_s=round(self.rng.uniform(0.5, 3.0), 1),
                    target_player_id=recipient_id,
                ))
            return end_location, recipient_id, possessing

        reason = "out_of_play"
        new_carrier = opponent.nearest_player(end_location, self.rng)
        if outcome == "incomplete" and self.rng.random() < 0.35:
            self.events.append(InterceptionEvent(
                match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
                team=opponent.team, team_name=opponent.team_name, player_id=new_carrier,
                player_name=opponent.profiles[new_carrier].player_name, location=end_location,
                possession_id=self.possession_id, opponent_id=recipient_id,
            ))
            reason = "turnover"
        self._emit_possession_change(total_ms, period, minute, second, possessing, reason, end_location)
        return end_location, new_carrier, opponent
