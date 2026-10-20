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

from datagen.pitch_grid import expected_location_from_bias
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
    team: Team
    team_name: str
    direction: str
    profiles: dict[str, PlayerTendencyProfile]
    expected_locations: dict[str, Location]

    def nearest_player(self, location: Location, rng: random.Random, exclude: set[str] | None = None) -> str:
        exclude = exclude or set()
        candidates = [pid for pid in self.profiles if pid not in exclude]
        jittered = {pid: _jitter(self.expected_locations[pid], rng) for pid in candidates}
        return min(candidates, key=lambda pid: _distance(jittered[pid], location))


@dataclass
class MatchResult:
    match_id: str
    home_name: str
    away_name: str
    events: list[AnyEvent]
    home_profiles: list[PlayerTendencyProfile]
    away_profiles: list[PlayerTendencyProfile]


def build_squad(team: Team, team_name: str, rng: random.Random) -> SquadState:
    profiles_list = generate_squad(team, rng)
    direction = "left_to_right" if team == "home" else "right_to_left"
    profiles = {p.player_id: p for p in profiles_list}
    expected = {pid: expected_location_from_bias(p.zone_bias) for pid, p in profiles.items()}
    return SquadState(team=team, team_name=team_name, direction=direction,
                       profiles=profiles, expected_locations=expected)


class MatchSimulator:
    """Pass in `home_squad`/`away_squad` (e.g. from build_squad, reused across
    several matches) to simulate the same persistent players facing different
    opponents/situations — this is what makes a real tendency "history" across
    matches possible, rather than every match inventing brand-new players."""

    def __init__(self, match_id: str, seed: int, home_squad: SquadState | None = None, away_squad: SquadState | None = None):
        self.match_id = match_id
        self.rng = random.Random(seed)
        if home_squad is not None and away_squad is not None:
            self.home, self.away = home_squad, away_squad
        else:
            home_name, away_name = self.rng.sample(TEAM_NAME_POOL, 2)
            self.home = build_squad("home", home_name, self.rng)
            self.away = build_squad("away", away_name, self.rng)
        self.referee_location: Location = (60.0, 40.0)
        self.events: list[AnyEvent] = []
        self.possession_id = 0
        self._last_ref_position_ms: int | None = None

    def _squad_for(self, team: Team) -> SquadState:
        return self.home if team == "home" else self.away

    def _opponent_of(self, team: Team) -> SquadState:
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
            home_formation="4-3-3",
            away_formation="4-3-3",
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

            shot_prob = (carrier.shot_on_sight + 0.14) * (0.75 if under_pressure else 1.05)
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
        )

    def _emit_possession_change(self, total_ms, period, minute, second, team: SquadState, reason: str, location: Location,
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
        teammates = [pid for pid in possessing.profiles if pid != carrier_id]
        forward = 1 if possessing.direction == "left_to_right" else -1

        def score(pid: str) -> float:
            loc = _jitter(possessing.expected_locations[pid], self.rng)
            forward_gain = (loc[0] - ball_location[0]) * forward
            return max(0.1, 1.0 / (1.0 + _distance(ball_location, loc))) + carrier.directness * max(0.0, forward_gain) * 0.02

        weights = {pid: score(pid) for pid in teammates}
        recipient_id = _weighted_choice(self.rng, weights)
        recipient = possessing.profiles[recipient_id]
        end_location = _jitter(possessing.expected_locations[recipient_id], self.rng)

        distance_m = _distance(ball_location, end_location)
        angle_deg = round(math.degrees(math.atan2(end_location[1] - ball_location[1], end_location[0] - ball_location[0])), 1)
        pass_type = "high" if distance_m > 35 else ("low" if distance_m > 15 else "ground")
        body_part = self.rng.choices(["right_foot", "left_foot", "head"], weights=[0.65, 0.25, 0.1])[0]
        flight_time = max(0.5, distance_m / 22.0)
        ball_speed = round((distance_m / flight_time) * 3.6, 1)

        accuracy_base = 0.88
        distance_penalty = min(0.5, distance_m / 100 * 0.6)
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
        if outcome == "incomplete" and self.rng.random() < 0.7:
            self.events.append(InterceptionEvent(
                match_id=self.match_id, period=period, minute=minute, second=second, match_clock_ms=total_ms,
                team=opponent.team, team_name=opponent.team_name, player_id=new_carrier,
                player_name=opponent.profiles[new_carrier].player_name, location=end_location,
                possession_id=self.possession_id, opponent_id=recipient_id,
            ))
            reason = "turnover"
        self._emit_possession_change(total_ms, period, minute, second, possessing, reason, end_location)
        return end_location, new_carrier, opponent
