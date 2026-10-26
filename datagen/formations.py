"""Named formation templates: 11 explicit (role, x, y) slots each, defined
for a left-to-right attacking direction (mirrored for the away team). Real
left/right differentiation per slot -- unlike the old single-formula-per-
role approach, two center-backs or two full-backs no longer collapse onto
nearly the same expected location.

x is depth as a 0..1 fraction of the pitch (0 = own goal line, 1 =
opponent's goal line); y is absolute pitch width in StatsBomb coordinates
(0..80). Hand-placed to be plausible average positions for each shape, not
fit from real tracking data -- same honesty posture as the rest of
datagen/agents/analyst0.
"""
from __future__ import annotations

from datagen.schema import PITCH_X_MAX, Location

Position = str  # "GK" | "CB" | "FB" | "CM" | "WM" | "FW" -- kept as str to avoid a circular import on player_profiles.Position
FormationSlot = tuple[Position, float, float]

FORMATIONS: dict[str, list[FormationSlot]] = {
    "4-4-2": [
        ("GK", 0.04, 40),
        ("CB", 0.16, 30), ("CB", 0.16, 50),
        ("FB", 0.20, 8), ("FB", 0.20, 72),
        ("CM", 0.46, 28), ("CM", 0.46, 52),
        ("WM", 0.52, 10), ("WM", 0.52, 70),
        ("FW", 0.78, 32), ("FW", 0.78, 48),
    ],
    "4-3-3": [
        ("GK", 0.04, 40),
        ("CB", 0.16, 30), ("CB", 0.16, 50),
        ("FB", 0.20, 8), ("FB", 0.20, 72),
        ("CM", 0.44, 22), ("CM", 0.40, 40), ("CM", 0.44, 58),
        ("WM", 0.72, 10), ("WM", 0.72, 70),
        ("FW", 0.82, 40),
    ],
    "4-2-3-1": [
        ("GK", 0.04, 40),
        ("CB", 0.16, 30), ("CB", 0.16, 50),
        ("FB", 0.20, 8), ("FB", 0.20, 72),
        ("CM", 0.38, 30), ("CM", 0.38, 50), ("CM", 0.64, 40),
        ("WM", 0.62, 12), ("WM", 0.62, 68),
        ("FW", 0.84, 40),
    ],
    "4-5-1": [
        ("GK", 0.04, 40),
        ("CB", 0.16, 30), ("CB", 0.16, 50),
        ("FB", 0.20, 8), ("FB", 0.20, 72),
        ("CM", 0.42, 25), ("CM", 0.40, 40), ("CM", 0.42, 55),
        ("WM", 0.48, 12), ("WM", 0.48, 68),
        ("FW", 0.80, 40),
    ],
    "3-5-2": [
        ("GK", 0.04, 40),
        ("CB", 0.16, 22), ("CB", 0.14, 40), ("CB", 0.16, 58),
        ("FB", 0.46, 8), ("FB", 0.46, 72),
        ("CM", 0.42, 30), ("CM", 0.38, 40), ("CM", 0.42, 50),
        ("FW", 0.78, 32), ("FW", 0.78, 48),
    ],
    "3-4-3": [
        ("GK", 0.04, 40),
        ("CB", 0.16, 22), ("CB", 0.14, 40), ("CB", 0.16, 58),
        ("FB", 0.48, 8), ("FB", 0.48, 72),
        ("CM", 0.46, 30), ("CM", 0.46, 50),
        ("FW", 0.78, 15), ("FW", 0.82, 40), ("FW", 0.78, 65),
    ],
}

# Only transitions that are a plausible in-match reshuffle (going behind so
# pushing to a back three, switching a winger for an extra body in midfield,
# etc.) -- not every formation-to-formation jump is a sensible single
# in-game change, so this is deliberately a small, curated adjacency list
# rather than "pick any other formation at random."
_PLAUSIBLE_SHIFTS: dict[str, list[str]] = {
    "4-4-2": ["4-3-3", "4-5-1", "4-2-3-1"],
    "4-3-3": ["4-4-2", "4-2-3-1", "3-4-3", "4-5-1"],
    "4-2-3-1": ["4-3-3", "4-5-1", "4-4-2"],
    "4-5-1": ["4-4-2", "4-2-3-1", "4-3-3"],
    "3-5-2": ["4-3-3", "3-4-3"],
    "3-4-3": ["4-3-3", "3-5-2"],
}


def formation_names() -> list[str]:
    return list(FORMATIONS.keys())


def plausible_shift_target(formation: str) -> list[str]:
    return _PLAUSIBLE_SHIFTS.get(formation, [f for f in FORMATIONS if f != formation])


def slot_to_location(slot: FormationSlot, direction: str) -> Location:
    _role, x_frac, y = slot
    x = x_frac * PITCH_X_MAX if direction == "left_to_right" else PITCH_X_MAX - x_frac * PITCH_X_MAX
    return (round(x, 2), round(float(y), 2))


def positions_for(formation: str) -> list[Position]:
    """The ordered Position-label sequence a formation implies -- this is
    what generate_squad() builds its 11 players' (fixed) roles from, so a
    squad's position composition always matches whichever formation it's
    about to start the match in."""
    return [slot[0] for slot in FORMATIONS[formation]]
