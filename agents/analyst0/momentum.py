"""Match momentum: Expected Threat added per team per time bucket.

Pure, deterministic, no LLM calls. Each completed pass and each carry is
valued with the existing Markov xT grid (metrics.successful_action_xt), and
only *positive* deltas count -- momentum is "who is moving the ball into
dangerous areas", so recycling it backwards doesn't drain the bar. Per
bucket, momentum = (home_xt - away_xt) / max |home_xt - away_xt| over the
match, so it lies in [-1, 1] (+ = home on top) and the strongest swing of
the match reads as +/-1. A match with no progression at all is flat 0.
"""
from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from typing import Any

from agents.analyst0.metrics import successful_action_xt

METHOD = (
    "Somme, par tranche, de l'xT positif ajouté par les passes réussies et conduites de balle de chaque équipe "
    "(grille xT de Markov) ; le momentum est l'écart domicile moins extérieur, rapporté au plus grand écart "
    "par tranche du match."
)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def compute_momentum(
    events: Iterable[Any],
    duration_ms: int,
    bucket_min: int = 1,
    player_names: Mapping[str, str] | None = None,
) -> dict:
    """Buckets start at minute 0 and step by `bucket_min` until they cover
    `duration_ms` (the last one may be partial)."""
    if bucket_min < 1:
        raise ValueError("bucket_min must be >= 1")
    names = player_names or {}
    bucket_ms = bucket_min * 60000
    n = max(1, math.ceil(max(0, duration_ms) / bucket_ms))
    home = [0.0] * n
    away = [0.0] * n
    goals: list[dict] = []

    for e in events:
        team = _get(e, "team")
        ms = _get(e, "match_clock_ms")
        if team not in ("home", "away") or ms is None:
            continue
        if _get(e, "type") == "shot" and _get(e, "outcome") == "goal":
            pid = str(_get(e, "player_id", ""))
            goals.append({
                "minute": int(_get(e, "minute", ms // 60000)),
                "team": team,
                "player_name": names.get(pid) or str(_get(e, "player_name") or pid),
            })
            continue
        xt = successful_action_xt(e)
        if xt is None or xt <= 0:
            continue
        idx = min(n - 1, max(0, int(ms) // bucket_ms))
        (home if team == "home" else away)[idx] += xt

    diffs = [h - a for h, a in zip(home, away, strict=True)]
    scale = max((abs(d) for d in diffs), default=0.0)
    buckets = [
        {
            "minute": i * bucket_min,
            "home_xt": round(home[i], 4),
            "away_xt": round(away[i], 4),
            "momentum": round(diffs[i] / scale, 4) if scale > 0 else 0.0,
        }
        for i in range(n)
    ]
    goals.sort(key=lambda g: (g["minute"], g["team"], g["player_name"]))
    return {"bucket_min": bucket_min, "duration_ms": int(duration_ms), "buckets": buckets, "goals": goals, "method": METHOD}
