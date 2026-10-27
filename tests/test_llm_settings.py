"""Shared LLM settings: per-stage reasoning effort, the compact payload the
model sees, and token usage flowing from the agents into the agent trace."""
from __future__ import annotations

import asyncio
import json

from agents.orchestrator.agent_trace import build_agent_trace
from agents.shared.handoff_log import HandoffEntry
from agents.shared.llm import (
    DEFAULT_EFFORT,
    chat_options,
    collect_usage,
    insight_for_prompt,
    report_usage,
    to_wire,
    total_usage,
)
from agents.shared.models import InsightCandidate


def _insight() -> InsightCandidate:
    return InsightCandidate(
        match_id="M-LLM", window_start_min=3.0, window_end_min=6.0, trigger_type="pressure_spike",
        metric_name="ppda_home", metric_value=4.0, baseline_value=6.0, delta_pct=-33.3,
        related_players=["home_9"], related_events=["a" * 32, "b" * 32], window_summary={"team": "home"},
    )


class _Response:
    def __init__(self, usage):
        self.usage_details = usage


# -- reasoning effort ------------------------------------------------------------

def test_each_stage_has_an_explicit_default_effort(monkeypatch):
    monkeypatch.delenv("LLM_REASONING_EFFORT", raising=False)
    for stage, effort in DEFAULT_EFFORT.items():
        monkeypatch.delenv(f"LLM_REASONING_EFFORT_{stage.upper()}", raising=False)
        assert chat_options(stage) == {"reasoning": {"effort": effort}}


def test_effort_can_be_overridden_per_stage_or_globally(monkeypatch):
    monkeypatch.setenv("LLM_REASONING_EFFORT", "medium")
    monkeypatch.setenv("LLM_REASONING_EFFORT_NARRATOR", "minimal")
    assert chat_options("narrator") == {"reasoning": {"effort": "minimal"}}
    assert chat_options("concierge") == {"reasoning": {"effort": "medium"}}


def test_default_restores_the_model_s_own_setting_and_junk_is_ignored(monkeypatch):
    monkeypatch.setenv("LLM_REASONING_EFFORT_QA", "default")
    monkeypatch.setenv("LLM_REASONING_EFFORT_NARRATOR", "turbo")
    assert chat_options("qa") == {}
    assert chat_options("narrator") == {"reasoning": {"effort": DEFAULT_EFFORT["narrator"]}}


# -- payload ---------------------------------------------------------------------

def test_prompt_payload_keeps_the_evidence_and_drops_internal_ids():
    data = insight_for_prompt(_insight(), {"home_9": "Dante Ribeiro"}, glossary_terms=["pressing"])

    assert {"insight_id", "match_id", "related_events"}.isdisjoint(data)
    for field in ("window_start_min", "window_end_min", "trigger_type", "metric_name", "metric_value",
                  "baseline_value", "delta_pct", "related_players", "window_summary"):
        assert field in data
    assert data["related_player_names"] == {"home_9": "Dante Ribeiro"}
    assert data["glossary_terms"] == ["pressing"]


def test_prompt_payload_hides_coordinates_and_zscore_but_the_insight_keeps_them():
    insight = _insight()
    insight.window_summary.update({"start_x": 93.7, "start_y": 39.7, "end_x": 107.2, "end_y": 35.5, "zscore": 4.6})
    data = insight_for_prompt(insight, {})

    assert data["window_summary"] == {"team": "home"}
    assert insight.window_summary["end_x"] == 107.2  # the what-if tool still reads them


def test_wire_format_is_compact_and_keeps_accents_readable():
    wire = to_wire({"name": "Kylian Mbappé", "n": [1, 2]})
    assert wire == '{"name":"Kylian Mbappé","n":[1,2]}'
    assert json.loads(wire)["name"] == "Kylian Mbappé"
    assert len(to_wire(insight_for_prompt(_insight(), {}))) < len(json.dumps(_insight().model_dump(), indent=2))


# -- usage -----------------------------------------------------------------------

def test_usage_is_collected_inside_the_sink_only():
    report_usage(_Response({"input_token_count": 1}))  # no sink open: ignored, no error
    with collect_usage() as calls:
        report_usage(_Response({"input_token_count": 1900, "output_token_count": 60, "openai.reasoning_tokens": 0}))
        report_usage(_Response({"input_token_count": 1950, "output_token_count": 300,
                                "openai.reasoning_tokens": 256}))
    assert total_usage(calls) == {"input_tokens": 3850, "output_tokens": 360, "reasoning_tokens": 256}


def test_usage_reaches_the_sink_from_a_separate_task():
    async def call_in_task():
        await asyncio.create_task(asyncio.sleep(0, result=None))
        report_usage(_Response({"input_token_count": 10, "output_token_count": 2}))

    async def scenario():
        with collect_usage() as calls:
            await asyncio.wait_for(asyncio.ensure_future(call_in_task()), timeout=5)
        return calls

    assert total_usage(asyncio.run(scenario()))["input_tokens"] == 10


def test_agent_trace_rolls_up_tokens_per_llm_agent():
    entries = [
        HandoffEntry("scout", "M", {"accepted": 3, "rejected": 0}, timestamp=1.0),
        HandoffEntry("narrator", "M", {"insight_id": "i1", "llm_attempts": 1, "path": "llm", "duration_ms": 900,
                                       "input_tokens": 1800, "output_tokens": 70, "reasoning_tokens": 0},
                     timestamp=2.0),
        HandoffEntry("concierge", "M", {"insight_id": "i1", "llm_attempts": 1, "path": "llm", "duration_ms": 800,
                                        "input_tokens": 700, "output_tokens": 90, "reasoning_tokens": 64},
                     timestamp=3.0),
        # Legacy entry (before token instrumentation) still counts as a call, adds no tokens.
        HandoffEntry("narrator", "M", {"insight_id": "i2", "llm_attempts": 1, "path": "llm"}, timestamp=4.0),
    ]
    trace = build_agent_trace(entries)
    agents = {a["stage"]: a for a in trace["agents"]}

    assert agents["narrator"]["tokens"] == {"input_tokens": 1800, "output_tokens": 70, "reasoning_tokens": 0}
    assert agents["concierge"]["tokens"]["reasoning_tokens"] == 64
    assert agents["scout"]["tokens"] == {"input_tokens": 0, "output_tokens": 0, "reasoning_tokens": 0}
    assert trace["totals"]["llm_tokens"] == {"input_tokens": 2500, "output_tokens": 160, "reasoning_tokens": 64}


def test_agent_trace_tokens_unknown_without_instrumentation():
    trace = build_agent_trace([HandoffEntry("narrator", "M", {"insight_id": "i", "llm_attempts": 1}, timestamp=1.0)])
    agents = {a["stage"]: a for a in trace["agents"]}
    assert agents["narrator"]["tokens"] is None
    assert trace["totals"]["llm_tokens"] is None


# -- vocabulary handed to the model ------------------------------------------------

def test_english_prompts_get_the_words_the_checker_wants():
    from agents.shared.glossary import glossary_terms_for

    assert glossary_terms_for("en", "milestone") == ["goal", "milestone", "scored", "scores"]
    xt = glossary_terms_for("en", "xt_surge")
    assert "threat" in xt and not any("xt" in t for t in xt), "no internal labels in a prompt"
    assert "knew" not in glossary_terms_for("en", "tendency_match")
    assert glossary_terms_for("xx", "milestone") == []


def test_every_word_given_to_the_model_passes_the_vocabulary_check():
    from agents.shared.glossary import TRIGGER_GLOSSARY, glossary_terms_for
    from eval.grounding_check import TRIGGER_VOCAB, _vocabulary_check_localized

    for locale in ["en", *TRIGGER_GLOSSARY]:
        for trigger in TRIGGER_VOCAB:
            terms = glossary_terms_for(locale, trigger)
            assert terms, (locale, trigger)
            insight = _insight().model_copy(update={"trigger_type": trigger})
            for term in terms:
                assert _vocabulary_check_localized(f"... {term} ...", insight, locale), (locale, trigger, term)


def test_narrator_payload_carries_the_glossary_terms(monkeypatch):
    import agents.narrator.agent as narrator

    seen = {}

    class _Reply(_Response):
        text = "ok"

    class _FakeAgent:
        async def run(self, message):
            seen["payload"] = json.loads(message)
            return _Reply({"input_token_count": 1})

    monkeypatch.setattr(narrator, "get_agent", lambda: _FakeAgent())
    asyncio.run(narrator.narrate_insight(_insight(), {}))
    assert "press" in seen["payload"]["glossary_terms"]
