"""Model settings and wire format shared by every LLM stage (Narrator,
Concierge, Q&A).

gpt-5-mini is a reasoning model: left at its default effort ("medium") it
spends hidden reasoning tokens on every call -- billed, counted against the
deployment's tokens-per-minute limit, and slow -- just to write one or two
sentences that the grounding checker then verifies anyway. Each stage's
effort below was picked from measurements (tools/bench_llm.py) and can be
overridden per stage without a rebuild, e.g. LLM_REASONING_EFFORT_NARRATOR=low
(or LLM_REASONING_EFFORT for every stage; "default" means the model's own).
"""
from __future__ import annotations

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from agents.shared.models import InsightCandidate

DEFAULT_EFFORT = {"narrator": "low", "concierge": "minimal", "qa": "low"}
_EFFORTS = {"minimal", "low", "medium", "high"}

# Opaque ids the prompts never use -- they only cost tokens on every call.
_INTERNAL_FIELDS = {"insight_id", "match_id", "related_events"}
# Raw pitch coordinates (kept on the insight for the what-if tool). Shown
# to the model they ended up verbatim in commentary -- "(93.7,39.7)" means
# nothing to a viewer.
_HIDDEN_SUMMARY_KEYS = {"start_x", "start_y", "end_x", "end_y"}


def reasoning_effort(stage: str) -> str:
    effort = (
        os.environ.get(f"LLM_REASONING_EFFORT_{stage.upper()}")
        or os.environ.get("LLM_REASONING_EFFORT")
        or DEFAULT_EFFORT[stage]
    ).strip().lower()
    return effort if effort in _EFFORTS or effort == "default" else DEFAULT_EFFORT[stage]


def chat_options(stage: str) -> dict[str, Any]:
    """Default chat options for one stage's Agent."""
    effort = reasoning_effort(stage)
    return {} if effort == "default" else {"reasoning": {"effort": effort}}


def insight_for_prompt(
    insight: InsightCandidate, player_names: dict[str, str], **extra: Any,
) -> dict[str, Any]:
    """The InsightCandidate as the model sees it: every evidence field, the
    display names of its related players, minus internal ids and raw
    pitch coordinates."""
    data = insight.model_dump(exclude=_INTERNAL_FIELDS)
    data["window_summary"] = {
        k: v for k, v in data["window_summary"].items() if k not in _HIDDEN_SUMMARY_KEYS
    }
    data["related_player_names"] = {pid: player_names.get(pid, pid) for pid in insight.related_players}
    data.update(extra)
    return data


def to_wire(payload: dict[str, Any]) -> str:
    """Compact JSON: indentation and escaped accents are pure token overhead."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def usage_summary(response: Any) -> dict[str, int]:
    """Token counts of one agent response, for the handoff trace."""
    usage = getattr(response, "usage_details", None) or {}
    return {
        "input_tokens": int(usage.get("input_token_count") or 0),
        "output_tokens": int(usage.get("output_token_count") or 0),
        "reasoning_tokens": int(usage.get("openai.reasoning_tokens") or usage.get("reasoning_output_token_count") or 0),
    }


# Executors open a sink around their (injectable) LLM call; the real agent
# functions append each response's usage to it. A mutable list rather than
# a returned value keeps the narrate/personalize contract (-> str) intact,
# and survives the call running in a copied context (asyncio tasks).
_usage_sink: ContextVar[list[dict[str, int]] | None] = ContextVar("llm_usage_sink", default=None)


@contextmanager
def collect_usage() -> Iterator[list[dict[str, int]]]:
    sink: list[dict[str, int]] = []
    token = _usage_sink.set(sink)
    try:
        yield sink
    finally:
        _usage_sink.reset(token)


def report_usage(response: Any) -> None:
    sink = _usage_sink.get()
    if sink is not None:
        sink.append(usage_summary(response))


def total_usage(calls: list[dict[str, int]]) -> dict[str, int]:
    keys = ("input_tokens", "output_tokens", "reasoning_tokens")
    return {k: sum(c.get(k, 0) for c in calls) for k in keys}
