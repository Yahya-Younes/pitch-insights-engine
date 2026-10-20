"""Narrator agent: stage (c) of PITCH ("explain why a moment matters").

Wraps the grounded system prompt (prompts/narrator_system.md) around
Microsoft Agent Framework's Agent class, backed by the Azure AI Foundry
chat deployment. narrate_insight() is the only entrypoint -- it takes one
InsightCandidate and returns 1-2 sentences of narrative text. Nothing else
in the pipeline is allowed to call the model directly, and the returned
text is expected to be run through eval/grounding_check.check_grounding()
before it's trusted anywhere downstream.

Azure clients are built lazily (get_agent()), not at import time, so this
module can be imported in tests/offline contexts without Azure credentials.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from agent_framework import Agent
from agent_framework_foundry import FoundryChatClient
from azure.identity import AzureCliCredential
from dotenv import load_dotenv

from agents.shared.models import InsightCandidate

_PROMPT_PATH = Path(__file__).parent / "prompts" / "narrator_system.md"
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"

load_dotenv(_ENV_PATH)


def _build_agent() -> Agent:
    endpoint = os.environ["AZURE_AI_FOUNDRY_ENDPOINT"]
    model = os.environ["AZURE_AI_FOUNDRY_CHAT_DEPLOYMENT"]
    system_prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    client = FoundryChatClient(project_endpoint=endpoint, model=model, credential=AzureCliCredential())
    return Agent(client=client, instructions=system_prompt, name="Narrator")


_agent: Agent | None = None


def get_agent() -> Agent:
    global _agent
    if _agent is None:
        _agent = _build_agent()
    return _agent


async def narrate_insight(insight: InsightCandidate, player_names: dict[str, str] | None = None) -> str:
    """Runs the Narrator agent on a single InsightCandidate, returning 1-2
    sentences of grounded narrative text.

    player_names (player_id -> display name) is optional context so the
    Narrator can refer to related players by name instead of id -- it is
    still only ever allowed to name players in insight.related_players; that
    rule is enforced downstream by eval/grounding_check.check_grounding, not
    by this function.
    """
    player_names = player_names or {}
    payload = insight.model_dump()
    payload["related_player_names"] = {pid: player_names.get(pid, pid) for pid in insight.related_players}

    agent = get_agent()
    response = await agent.run(json.dumps(payload, indent=2))
    return response.text.strip()


async def _smoke_test() -> None:
    sample = InsightCandidate(
        match_id="SMOKE-001", window_start_min=23.0, window_end_min=26.0,
        trigger_type="pressure_spike", metric_name="ppda_home", metric_value=4.2,
        baseline_value=7.1, delta_pct=-40.8, related_events=["evt-1"],
        window_summary={"team": "home"},
    )
    text = await narrate_insight(sample)
    print("Narrator output:", text)


if __name__ == "__main__":
    asyncio.run(_smoke_test())
