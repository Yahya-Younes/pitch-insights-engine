"""Coarse 6x4 pitch-zone grid used for player tendency bias and zone-conditioned
expectations. Separate from the finer xT grid used in agents/analyst0/metrics.py —
tendency modelling doesn't need xT's resolution, and keeping them independent keeps
each honest about what it's actually calibrated for.
"""
from __future__ import annotations

from datagen.schema import PITCH_X_MAX, PITCH_Y_MAX, Location

ZONE_COLS = 6
ZONE_ROWS = 4
_COL_WIDTH = PITCH_X_MAX / ZONE_COLS
_ROW_HEIGHT = PITCH_Y_MAX / ZONE_ROWS

ZONE_LABELS = [f"z{col}_{row}" for col in range(ZONE_COLS) for row in range(ZONE_ROWS)]


def zone_of(location: Location) -> str:
    x, y = location
    col = min(int(x // _COL_WIDTH), ZONE_COLS - 1)
    row = min(int(y // _ROW_HEIGHT), ZONE_ROWS - 1)
    return f"z{col}_{row}"


def zone_center(zone_label: str) -> Location:
    col, row = (int(part) for part in zone_label[1:].split("_"))
    return (col * _COL_WIDTH + _COL_WIDTH / 2, row * _ROW_HEIGHT + _ROW_HEIGHT / 2)


def zones_in_column_range(col_min: int, col_max: int) -> list[str]:
    return [z for z in ZONE_LABELS if col_min <= int(z[1:].split("_")[0]) <= col_max]


def expected_location_from_bias(zone_bias: dict[str, float]) -> Location:
    x = sum(zone_center(z)[0] * w for z, w in zone_bias.items())
    y = sum(zone_center(z)[1] * w for z, w in zone_bias.items())
    return (x, y)
