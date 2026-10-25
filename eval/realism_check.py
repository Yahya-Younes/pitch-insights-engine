"""Statistical sanity-check against real match data -- our own generator's
basic countable aggregates (pressing intensity, pass completion, shot
volume, possession balance) compared against the same aggregates computed
directly from a real sample of StatsBomb Open Data Premier League matches
(see eval/real_data_validation.py and tools/fetch_real_data_validation.py),
not a hand-typed table of publicly reported numbers.

We don't have access to a proprietary real-match tracking dataset, so this
uses a real, free, citable source instead -- StatsBomb Open Data, sampled
from the two fully event-logged Premier League seasons they've released
(2003/04 and 2015/16) -- and says so plainly rather than overstating the
sample.

Deliberately excludes our own xT model from this comparison: it's
hand-calibrated (agents/analyst0/metrics.py says so plainly) and was never
fit to or claimed to match any particular real dataset's scale, so citing a
"real-world xT range" for it would be comparing two unrelated scales, not a
genuine validation.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

from agents.analyst0.metrics import compute_ppda
from datagen.match_simulator import MatchSimulator, build_squad
from datagen.schema import AnyEvent
from eval.real_data_validation import citation as real_data_citation
from eval.real_data_validation import reference_ranges as real_world_reference_ranges


@dataclass
class RealismResult:
    metric: str
    value: float
    reference_range: tuple[float, float]

    @property
    def in_range(self) -> bool:
        lo, hi = self.reference_range
        return lo <= self.value <= hi


def compute_match_aggregates(events: list[AnyEvent], duration_ms: int) -> dict[str, float]:
    passes = [e for e in events if e.type == "pass"]
    completed = [p for p in passes if p.outcome == "complete"]
    pass_completion_pct = round(100.0 * len(completed) / len(passes), 1) if passes else 0.0

    shots_home = sum(1 for e in events if e.type == "shot" and e.team == "home")
    shots_away = sum(1 for e in events if e.type == "shot" and e.team == "away")
    shots_per_team = round((shots_home + shots_away) / 2, 1)

    touches_home = sum(1 for e in events if getattr(e, "team", None) == "home")
    touches_away = sum(1 for e in events if getattr(e, "team", None) == "away")
    total_touches = touches_home + touches_away
    possession_pct = round(100.0 * touches_home / total_touches, 1) if total_touches else 50.0

    ppda_home = compute_ppda(events, "home", 0, duration_ms)
    ppda_away = compute_ppda(events, "away", 0, duration_ms)
    ppda_values = [v for v in (ppda_home, ppda_away) if v is not None]
    ppda = round(sum(ppda_values) / len(ppda_values), 2) if ppda_values else 0.0

    return {
        "ppda": ppda, "pass_completion_pct": pass_completion_pct,
        "shots_per_team": shots_per_team, "possession_pct": possession_pct,
    }


def compare_to_reference(aggregates: dict[str, float], reference_ranges: dict[str, tuple[float, float]]) -> list[RealismResult]:
    return [
        RealismResult(metric=k, value=v, reference_range=reference_ranges[k])
        for k, v in aggregates.items() if k in reference_ranges
    ]


def run(n_matches: int = 6, seed: int = 321) -> dict:
    """Simulates a small batch of full matches and averages their
    aggregates before comparing to the reference ranges -- a single
    match's counting stats are noisy; averaging several is a fairer test
    of whether the generator's typical output is realistic, not whether
    every individual match happens to be."""
    rng = random.Random(seed)
    home = build_squad("home", "Thornbury United", rng)
    away = build_squad("away", "Castlefield FC", rng)

    reference_ranges = real_world_reference_ranges()

    per_match_aggregates: list[dict[str, float]] = []
    for i in range(n_matches):
        sim = MatchSimulator(f"REALISM-{i}", seed=seed + i, home_squad=home, away_squad=away)
        result = sim.generate_match()
        duration_ms = 90 * 60000
        per_match_aggregates.append(compute_match_aggregates(result.events, duration_ms))

    averaged = {
        key: round(sum(a[key] for a in per_match_aggregates) / len(per_match_aggregates), 2)
        for key in reference_ranges
    }
    results = compare_to_reference(averaged, reference_ranges)
    citation = real_data_citation()
    return {
        "metrics": [
            {"metric": r.metric, "value": r.value, "reference_range": list(r.reference_range), "in_range": r.in_range}
            for r in results
        ],
        "in_range_count": sum(1 for r in results if r.in_range),
        "total_count": len(results),
        "n_matches_averaged": n_matches,
        "real_data_source": citation,
        "method": (
            f"{n_matches}-match synthetic average compared against the literal min-max range observed "
            f"across {citation['n_matches']} real {', '.join(citation['seasons_sampled_from'])} matches "
            f"(sampled from {citation['n_matches_available_total']} available) -- {citation['attribution']}. "
            "Excludes our own hand-calibrated xT model, which isn't fit to any real dataset's scale."
        ),
    }
