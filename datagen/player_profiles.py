"""Generates persistent, hidden per-player tendency profiles that drive
match_simulator.py's event generation. The inference side
(agents/analyst0/tendency_model.py) never sees these directly — it has to
re-derive an estimate purely from observed events, the way a real scout would.
"""
from __future__ import annotations

import math
import random
from typing import Literal

from datagen.formations import FORMATIONS, slot_to_location
from datagen.pitch_grid import ZONE_LABELS, zone_center
from datagen.schema import ActionBias, Location, PlayerTendencyProfile, Team

Position = Literal["GK", "CB", "FB", "CM", "WM", "FW"]
AttackingDirection = Literal["left_to_right", "right_to_left"]

# Kept for any external code still referencing the old always-4-3-3 default --
# generate_squad now takes an explicit formation name instead (see FORMATIONS
# in datagen/formations.py, which this is now derived from, not the reverse).
FORMATION_4_3_3: list[Position] = [slot[0] for slot in FORMATIONS["4-3-3"]]  # type: ignore[misc]

# How tightly a position's zone-bias cloud hugs its formation slot -- wider
# for roles that roam more (wingers, forwards), tighter for roles that hold
# a line (center-backs, the keeper).
_SPREAD_BY_POSITION: dict[str, float] = {
    "GK": 0.5, "CB": 0.75, "FB": 1.05, "CM": 1.0, "WM": 1.2, "FW": 1.1,
}

_FIRST_NAMES = [
    "Jamal", "Lucas", "Mateo", "Kian", "Theo", "Idris", "Noah", "Finn", "Tariq",
    "Oscar", "Rafael", "Aiden", "Samir", "Leon", "Mikel", "Dante", "Ezra", "Milo",
]
_LAST_NAMES = [
    "Okafor", "Bakker", "Ferreira", "Donnelly", "Marsh", "Okonkwo", "Vance",
    "Ribeiro", "Hayes", "Novak", "Ashworth", "Delacroix", "Pryce", "Solheim",
]

_POSITION_PRIORS: dict[Position, dict] = {
    "GK": dict(directness=0.2, dribble_tendency=0.02, shot_on_sight=0.0, sprint_mean=8,
               pass_bias=0.9, dribble_bias=0.01, carry_bias=0.04, lose_bias=0.05, row_wide=False),
    "CB": dict(directness=0.25, dribble_tendency=0.08, shot_on_sight=0.02, sprint_mean=18,
               pass_bias=0.78, dribble_bias=0.04, carry_bias=0.1, lose_bias=0.08, row_wide=False),
    "FB": dict(directness=0.45, dribble_tendency=0.25, shot_on_sight=0.03, sprint_mean=48,
               pass_bias=0.62, dribble_bias=0.14, carry_bias=0.16, lose_bias=0.08, row_wide=True),
    "CM": dict(directness=0.5, dribble_tendency=0.22, shot_on_sight=0.08, sprint_mean=30,
               pass_bias=0.68, dribble_bias=0.13, carry_bias=0.13, lose_bias=0.06, row_wide=False),
    "WM": dict(directness=0.55, dribble_tendency=0.55, shot_on_sight=0.18, sprint_mean=55,
               pass_bias=0.33, dribble_bias=0.42, carry_bias=0.18, lose_bias=0.07, row_wide=True),
    "FW": dict(directness=0.6, dribble_tendency=0.3, shot_on_sight=0.35, sprint_mean=42,
               pass_bias=0.48, dribble_bias=0.2, carry_bias=0.2, lose_bias=0.12, row_wide=False),
}


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


# A squad-level multiplier on the behavioral tendencies that already feed
# directly into match_simulator.py's event-resolution formulas
# (shot_on_sight -> shot_prob, directness -> pass forward_bonus) -- a
# "richer squad plays better" effect implemented entirely at attribute
# generation time, with zero changes to the already realism-validated
# event-resolution code in match_simulator.py itself. Deliberately a modest
# range (0.7-1.3): wide enough to show up as a real, visible edge over many
# matches (see Tactics Lab), narrow enough that eval.realism_check's
# aggregate ranges -- fit across randomized quality by default -- stay
# honest rather than getting skewed by an extreme multiplier.
QUALITY_MIN = 0.7
QUALITY_MAX = 1.3


def generate_squad_quality(rng: random.Random) -> float:
    return rng.uniform(QUALITY_MIN, QUALITY_MAX)


def generate_market_value_eur(quality: float, rng: random.Random) -> float:
    """A plausible total squad valuation correlated with `quality` -- real
    club valuations are heavily right-skewed (a handful of giants worth
    well over EUR 1B, most clubs worth a few tens of millions), so this
    interpolates on a log/exponential curve rather than linearly: quality
    0.7 lands around EUR 15-20M (a selling club's thin squad), quality 1.3
    around EUR 800M-1B+ (a superclub), with +/-25% jitter for texture.
    Flavor/context data for narration and the Tactics Lab UI -- it's
    *derived from* quality, not an independent random number, so a
    reported value mismatch genuinely reflects the quality gap that's
    actually driving the two squads' on-pitch attributes."""
    t = _clip01((quality - QUALITY_MIN) / (QUALITY_MAX - QUALITY_MIN))
    base = 15_000_000 * (60 ** t)
    return round(base * rng.uniform(0.8, 1.25), -5)


def _zone_bias_for_location(target: Location, position: Position, rng: random.Random) -> dict[str, float]:
    """A zone-bias cloud centered on target (an explicit formation-slot
    pitch location, already left/right-differentiated -- see
    datagen/formations.py), not a generic per-position-label formula. Two
    center-backs or two wide players now get genuinely different zone
    biases because they have genuinely different slot coordinates, not
    just independent random jitter around the same shared target."""
    spread = _SPREAD_BY_POSITION.get(position, 1.0)
    tx, ty = target
    weights: dict[str, float] = {}
    for label in ZONE_LABELS:
        zx, zy = zone_center(label)
        d2 = ((zx - tx) / (18.0 * spread)) ** 2 + ((zy - ty) / (14.0 * spread)) ** 2
        w = math.exp(-d2) + rng.uniform(0.0, 0.06)
        weights[label] = w
    total = sum(weights.values())
    return {label: w / total for label, w in weights.items()}


def _action_bias_for(position: Position, rng: random.Random) -> ActionBias:
    prior = _POSITION_PRIORS[position]
    raw = {
        "pass": max(0.05, prior["pass_bias"] + rng.uniform(-0.08, 0.08)),
        "dribble": max(0.01, prior["dribble_bias"] + rng.uniform(-0.05, 0.05)),
        "carry": max(0.01, prior["carry_bias"] + rng.uniform(-0.05, 0.05)),
        "lose_possession": max(0.01, prior["lose_bias"] + rng.uniform(-0.03, 0.03)),
    }
    total = sum(raw.values())
    normalized = {k: v / total for k, v in raw.items()}
    return ActionBias.model_validate(normalized)


def _unique_name(rng: random.Random, used_names: set[str] | None) -> str:
    """Draws a first+last name combo, resampling on collision when a
    used_names set is tracked. With only 18x14=252 combos and ~22 players
    on the pitch per match, an unguarded draw collides often enough (birthday
    paradox) to visibly put two same-named players in one synthetic match."""
    name = f"{rng.choice(_FIRST_NAMES)} {rng.choice(_LAST_NAMES)}"
    if used_names is None:
        return name
    attempts = 0
    while name in used_names and attempts < 50:
        name = f"{rng.choice(_FIRST_NAMES)} {rng.choice(_LAST_NAMES)}"
        attempts += 1
    used_names.add(name)
    return name


def generate_player_profile(
    player_id: str,
    position: Position,
    slot_location: Location,
    rng: random.Random,
    used_names: set[str] | None = None,
    quality: float = 1.0,
) -> PlayerTendencyProfile:
    prior = _POSITION_PRIORS[position]
    name = _unique_name(rng, used_names)
    zone_bias = _zone_bias_for_location(slot_location, position, rng)
    sorted_zones = sorted(zone_bias.items(), key=lambda kv: kv[1], reverse=True)
    preferred_sprint_zones = [z for z, _ in sorted_zones[:3]]
    return PlayerTendencyProfile(
        player_id=player_id,
        player_name=name,
        position=position,
        preferred_foot=rng.choices(["right", "left", "both"], weights=[0.72, 0.2, 0.08])[0],
        zone_bias=zone_bias,
        action_bias_under_pressure=_action_bias_for(position, rng),
        directness=_clip01((prior["directness"] + rng.uniform(-0.1, 0.1)) * quality),
        dribble_tendency=_clip01((prior["dribble_tendency"] + rng.uniform(-0.08, 0.08)) * quality),
        sprint_frequency_per_match=max(2.0, rng.gauss(prior["sprint_mean"], prior["sprint_mean"] * 0.2)),
        preferred_sprint_zones=preferred_sprint_zones,
        shot_on_sight=_clip01((prior["shot_on_sight"] + rng.uniform(-0.06, 0.06)) * quality),
    )


def generate_squad(
    team: Team, rng: random.Random, used_names: set[str] | None = None, formation: str = "4-3-3",
    quality: float = 1.0,
) -> list[PlayerTendencyProfile]:
    direction: AttackingDirection = "left_to_right" if team == "home" else "right_to_left"
    if used_names is None:
        used_names = set()
    slots = FORMATIONS[formation]
    return [
        generate_player_profile(
            f"{team}_{idx + 1}", slot[0], slot_to_location(slot, direction), rng, used_names, quality,  # type: ignore[arg-type]
        )
        for idx, slot in enumerate(slots)
    ]
