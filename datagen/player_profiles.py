"""Generates persistent, hidden per-player tendency profiles that drive
match_simulator.py's event generation. The inference side
(agents/analyst0/tendency_model.py) never sees these directly — it has to
re-derive an estimate purely from observed events, the way a real scout would.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Literal

from datagen.pitch_grid import ZONE_COLS, ZONE_LABELS, ZONE_ROWS
from datagen.schema import ActionBias, PlayerTendencyProfile, Team

Position = Literal["GK", "CB", "FB", "CM", "WM", "FW"]
AttackingDirection = Literal["left_to_right", "right_to_left"]

# 4-3-3: GK, 2x CB, 2x FB, 3x CM, 2x WM, 1x FW
FORMATION_4_3_3: list[Position] = ["GK", "CB", "CB", "FB", "FB", "CM", "CM", "CM", "WM", "WM", "FW"]

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


@dataclass
class ZoneWeight:
    col: int
    row: int
    weight: float


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _attacking_third_cols(direction: AttackingDirection) -> tuple[int, int]:
    """Returns (defensive_edge_col, attacking_edge_col) for bias weighting."""
    return (0, ZONE_COLS - 1) if direction == "left_to_right" else (ZONE_COLS - 1, 0)


def _zone_bias_for(position: Position, direction: AttackingDirection, rng: random.Random) -> dict[str, float]:
    prior = _POSITION_PRIORS[position]
    def_col, atk_col = _attacking_third_cols(direction)
    col_center = {
        "GK": def_col,
        "CB": def_col + (1 if direction == "left_to_right" else -1),
        "FB": 2 if direction == "left_to_right" else 3,
        "CM": (ZONE_COLS - 1) / 2,
        "WM": 3 if direction == "left_to_right" else 2,
        "FW": atk_col,
    }[position]
    weights: dict[str, float] = {}
    for label in ZONE_LABELS:
        col = int(label[1:].split("_")[0])
        row = int(label.split("_")[1])
        col_dist = abs(col - col_center)
        row_component = 1.0
        if prior["row_wide"]:
            row_component = 1.6 if row in (0, ZONE_ROWS - 1) else 0.6
        else:
            row_component = 1.4 if row in (1, 2) else 0.6
        w = row_component / (1.0 + col_dist) + rng.uniform(0.0, 0.15)
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
    direction: AttackingDirection,
    rng: random.Random,
    used_names: set[str] | None = None,
) -> PlayerTendencyProfile:
    prior = _POSITION_PRIORS[position]
    name = _unique_name(rng, used_names)
    zone_bias = _zone_bias_for(position, direction, rng)
    sorted_zones = sorted(zone_bias.items(), key=lambda kv: kv[1], reverse=True)
    preferred_sprint_zones = [z for z, _ in sorted_zones[:3]]
    return PlayerTendencyProfile(
        player_id=player_id,
        player_name=name,
        position=position,
        preferred_foot=rng.choices(["right", "left", "both"], weights=[0.72, 0.2, 0.08])[0],
        zone_bias=zone_bias,
        action_bias_under_pressure=_action_bias_for(position, rng),
        directness=_clip01(prior["directness"] + rng.uniform(-0.1, 0.1)),
        dribble_tendency=_clip01(prior["dribble_tendency"] + rng.uniform(-0.08, 0.08)),
        sprint_frequency_per_match=max(2.0, rng.gauss(prior["sprint_mean"], prior["sprint_mean"] * 0.2)),
        preferred_sprint_zones=preferred_sprint_zones,
        shot_on_sight=_clip01(prior["shot_on_sight"] + rng.uniform(-0.06, 0.06)),
    )


def generate_squad(team: Team, rng: random.Random, used_names: set[str] | None = None) -> list[PlayerTendencyProfile]:
    direction: AttackingDirection = "left_to_right" if team == "home" else "right_to_left"
    if used_names is None:
        used_names = set()
    return [
        generate_player_profile(f"{team}_{idx + 1}", position, direction, rng, used_names)
        for idx, position in enumerate(FORMATION_4_3_3)
    ]
