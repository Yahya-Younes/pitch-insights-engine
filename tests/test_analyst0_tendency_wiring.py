"""Regression tests: the live pipeline must actually emit tendency insights,
not just the insight generator in isolation. Analyst-0 used to call
generate_insight_candidates() without any tendency_profiles, so tendency
trigger types were reachable only from unit tests and never from a real
match run.

Once wired in, uncapped tendency output was ~150 insights per match (4x
everything else combined), mostly low-value "player did what they usually
do" tendency_match noise. Live output is therefore limited to the most
striking tendency_break moments.
"""
import asyncio

import pytest

from agents.analyst0.insight_generator import TENDENCY_MAX_PER_MATCH, generate_insight_candidates
from agents.analyst0.tendency_model import infer_all_profiles
from agents.narrator.fallback import fallback_narration
from agents.orchestrator.workflow import run_match
from datagen.match_simulator import MatchSimulator


async def _fake_narrate(insight, player_names=None):
    return fallback_narration(insight)


async def _fake_personalize(insights, persona, lens=None, player_id=None, locale="en", player_names=None):
    return fallback_narration(insights[0])


def _simulated_events(match_id: str, seed: int):
    return MatchSimulator(match_id, seed=seed).generate_match().events


def _tendency_candidates_for(seed: int, **kwargs):
    events = _simulated_events("M", seed)
    player_ids = sorted({pid for e in events if (pid := getattr(e, "player_id", None))})
    profiles = infer_all_profiles(events, player_ids)
    candidates = generate_insight_candidates(events, "M", 90 * 60000, tendency_profiles=profiles, **kwargs)
    return [c for c in candidates if c.trigger_type.startswith("tendency_")]


def test_live_pipeline_emits_capped_tendency_breaks_only():
    match_id = "M-TENDENCY"
    events = [e.model_dump(mode="json") for e in _simulated_events(match_id, seed=42)]

    _, log = asyncio.run(run_match(
        raw_events=events, match_id=match_id, duration_ms=90 * 60000,
        narrate_fn=_fake_narrate, personalize_fn=_fake_personalize,
    ))

    tendency = [e.summary["trigger_type"] for e in log.entries()
                if e.stage == "insight" and e.summary.get("trigger_type", "").startswith("tendency_")]
    assert tendency, "no tendency insight reached the live pipeline"
    assert set(tendency) == {"tendency_break"}
    assert len(tendency) <= TENDENCY_MAX_PER_MATCH


@pytest.mark.parametrize("seed", [1, 7, 123])
def test_kept_tendency_breaks_are_the_most_extreme(seed):
    kept = _tendency_candidates_for(seed)
    all_breaks = _tendency_candidates_for(seed, tendency_cap=None)

    assert 0 < len(kept) <= TENDENCY_MAX_PER_MATCH
    assert all(c.trigger_type == "tendency_break" for c in kept)
    assert sorted(c.metric_value for c in kept) == sorted(c.metric_value for c in all_breaks)[:len(kept)]
    assert [c.window_start_min for c in kept] == sorted(c.window_start_min for c in kept)
