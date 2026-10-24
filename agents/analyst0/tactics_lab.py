"""Tactics Lab: run many full synthetic matches between two chosen
formations and aggregate the outcome distribution -- the same Monte-Carlo
style analysis (win/draw/loss, xG, possession, PPDA across hundreds of
matches) a coach would use to compare two tactical setups. Matches the
strongest feature in a competing hackathon entry's "Tactics Lab," built
entirely from datagen.match_simulator and the same event-counting
primitives eval/realism_check.py already uses -- no new simulation logic,
no new data source.

Deliberately scoped down from that competitor's version in two disclosed
ways: formation selection is from our existing named templates (not "75
formations, or described in plain words and AI-translated"), and there's
no mid-match scenario branching ("red card at 30'", formation switch at
70') yet -- both are natural follow-ups, not core to proving the
Monte-Carlo comparison itself works.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

from agents.analyst0.metrics import compute_ppda
from datagen.formations import formation_names
from datagen.match_simulator import MatchSimulator, build_squad
from datagen.schema import AnyEvent


@dataclass
class MatchOutcome:
    home_goals: int
    away_goals: int
    home_xg: float
    away_xg: float
    home_possession_pct: float
    home_ppda: float | None
    away_ppda: float | None


def _match_outcome(events: list[AnyEvent], duration_ms: int) -> MatchOutcome:
    home_goals = sum(1 for e in events if e.type == "shot" and e.team == "home" and e.outcome == "goal")
    away_goals = sum(1 for e in events if e.type == "shot" and e.team == "away" and e.outcome == "goal")
    home_xg = round(sum(e.xg for e in events if e.type == "shot" and e.team == "home"), 2)
    away_xg = round(sum(e.xg for e in events if e.type == "shot" and e.team == "away"), 2)
    touches_home = sum(1 for e in events if getattr(e, "team", None) == "home")
    touches_away = sum(1 for e in events if getattr(e, "team", None) == "away")
    total_touches = touches_home + touches_away
    possession = round(100.0 * touches_home / total_touches, 1) if total_touches else 50.0
    home_ppda = compute_ppda(events, "home", 0, duration_ms)
    away_ppda = compute_ppda(events, "away", 0, duration_ms)
    return MatchOutcome(home_goals, away_goals, home_xg, away_xg, possession, home_ppda, away_ppda)


def simulate_formation_matchup(
    home_formation: str, away_formation: str, n_matches: int = 50, seed: int = 10000,
) -> dict:
    """The core Tactics Lab call: n_matches independent full matches between
    a fixed home-formation squad and a fixed away-formation squad (same two
    generated squads reused across every run -- only the match seed varies),
    aggregated into a win/draw/loss record plus mean goals, xG, possession,
    and pressing intensity for each side."""
    valid = set(formation_names())
    if home_formation not in valid or away_formation not in valid:
        raise ValueError(f"formation must be one of {sorted(valid)}, got {home_formation!r}/{away_formation!r}")

    rng = random.Random(seed)
    home_squad = build_squad("home", "Home XI", rng, formation=home_formation)
    away_squad = build_squad("away", "Away XI", rng, formation=away_formation)
    duration_ms = 90 * 60000

    outcomes: list[MatchOutcome] = []
    for i in range(n_matches):
        sim = MatchSimulator(f"TACTICS-{i}", seed=seed + i, home_squad=home_squad, away_squad=away_squad)
        result = sim.generate_match()
        outcomes.append(_match_outcome(result.events, duration_ms))

    wins = sum(1 for o in outcomes if o.home_goals > o.away_goals)
    draws = sum(1 for o in outcomes if o.home_goals == o.away_goals)
    losses = sum(1 for o in outcomes if o.home_goals < o.away_goals)
    home_ppdas = [o.home_ppda for o in outcomes if o.home_ppda is not None]
    away_ppdas = [o.away_ppda for o in outcomes if o.away_ppda is not None]

    def _mean(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 2) if xs else None

    return {
        "home_formation": home_formation,
        "away_formation": away_formation,
        "n_matches": n_matches,
        "home_record": {
            "wins": wins, "draws": draws, "losses": losses,
            "win_pct": round(100 * wins / n_matches, 1),
            "draw_pct": round(100 * draws / n_matches, 1),
            "loss_pct": round(100 * losses / n_matches, 1),
        },
        "mean_home_goals": _mean([o.home_goals for o in outcomes]),
        "mean_away_goals": _mean([o.away_goals for o in outcomes]),
        "mean_home_xg": _mean([o.home_xg for o in outcomes]),
        "mean_away_xg": _mean([o.away_xg for o in outcomes]),
        "mean_home_possession_pct": _mean([o.home_possession_pct for o in outcomes]),
        "mean_home_ppda": _mean(home_ppdas),
        "mean_away_ppda": _mean(away_ppdas),
        "method": f"{n_matches} independently seeded full 90-minute synthetic matches between a "
                  f"{home_formation} home side and a {away_formation} away side (same two generated squads "
                  f"reused across every run, only the match seed varies) -- a Monte-Carlo comparison of the "
                  "two formations' outcome distribution, not a single match's result.",
    }
