"""Loads the real-match reference computed by tools/fetch_real_data_validation.py
-- the thing eval/realism_check.py compares our synthetic generator's
aggregates against. Replaces a hand-typed, publicly-reported range with
numbers computed directly from a real sample of StatsBomb Open Data
Premier League matches (see that script's docstring for the exact
methodology and why "Pressure" events are excluded from the PPDA
calculation).

Kept as its own module (rather than inlined in realism_check.py) so the
provenance -- real match ids, season labels, when it was generated -- stays
inspectable and the cached JSON can be regenerated independently without
touching the comparison logic itself.
"""
from __future__ import annotations

import json
from pathlib import Path

_CACHE_PATH = Path(__file__).parent / "real_data_cache" / "pl_reference.json"


def load_reference() -> dict:
    """Returns the cached real-match reference, or raises FileNotFoundError
    with a clear instruction if tools/fetch_real_data_validation.py hasn't
    been run yet -- this is intentionally not auto-generated at runtime
    (it needs network access to StatsBomb's GitHub-hosted open data, which
    the deployed Container App has no reason to depend on at request time)."""
    if not _CACHE_PATH.exists():
        raise FileNotFoundError(
            f"{_CACHE_PATH} not found -- run `python -m tools.fetch_real_data_validation` first "
            "to compute it from StatsBomb Open Data."
        )
    return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))


def reference_ranges() -> dict[str, tuple[float, float]]:
    """metric -> (min, max) observed across the real-match sample -- the
    literal range real Premier League matches fell in, not a hand-picked
    band."""
    ref = load_reference()
    return {metric: (stats["min"], stats["max"]) for metric, stats in ref["metrics"].items()}


def citation() -> dict:
    ref = load_reference()
    return {
        "source": ref["source"],
        "attribution": ref["attribution"],
        "seasons_sampled_from": ref["seasons_sampled_from"],
        "n_matches": ref["n_matches"],
        "n_matches_available_total": ref["n_matches_available_total"],
        "generated_at": ref["generated_at"],
    }
