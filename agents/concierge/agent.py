"""Concierge agent: stage (e) of PITCH ("personalize for the viewer").

Takes a persona (+ an optional Coach Lens, + an optional player_id for the
player-tracker persona, + an optional locale) and the full list of
InsightCandidates for a match. Deterministically filters what's in scope
via agents.concierge.persona_filter -- no LLM involved in that decision --
then asks the same grounded-prompt-and-Foundry-model pattern as the
Narrator (agents/narrator/agent.py) to phrase the result. The LLM only
ever phrases insights persona_filter has already selected; it never
decides what to include.

Azure clients are built lazily per persona, not at import time, so this
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

from agents.concierge.lens import CoachLens
from agents.concierge.persona_filter import Persona, filter_for_persona
from agents.shared.models import InsightCandidate

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"

load_dotenv(_ENV_PATH)

_agents: dict[Persona, Agent] = {}


def _build_agent(persona: Persona) -> Agent:
    endpoint = os.environ["AZURE_AI_FOUNDRY_ENDPOINT"]
    model = os.environ["AZURE_AI_FOUNDRY_CHAT_DEPLOYMENT"]
    system_prompt = (_PROMPTS_DIR / f"{persona}_system.md").read_text(encoding="utf-8")
    client = FoundryChatClient(project_endpoint=endpoint, model=model, credential=AzureCliCredential())
    return Agent(client=client, instructions=system_prompt, name=f"Concierge-{persona}")


def get_agent(persona: Persona) -> Agent:
    if persona not in _agents:
        _agents[persona] = _build_agent(persona)
    return _agents[persona]


async def personalize(
    insights: list[InsightCandidate],
    persona: Persona,
    lens: CoachLens | None = None,
    player_id: str | None = None,
    locale: str = "en",
    player_names: dict[str, str] | None = None,
) -> str:
    """Returns one personalized recap string for the given persona (and,
    optionally, a Coach Lens tactical framing and/or a single tracked
    player). Raises ValueError via persona_filter if player_id is missing
    for the player_tracker persona."""
    player_names = player_names or {}
    selected = filter_for_persona(insights, persona, lens=lens, player_id=player_id)
    if not selected:
        return "No notable moments to report for this view yet."

    payload = {
        "locale": locale,
        "lens": lens.model_dump() if lens else None,
        "player_id": player_id,
        "insights": [
            {
                **c.model_dump(),
                "related_player_names": {pid: player_names.get(pid, pid) for pid in c.related_players},
            }
            for c in selected
        ],
    }
    agent = get_agent(persona)
    response = await agent.run(json.dumps(payload, indent=2))
    return response.text.strip()


async def _smoke_test() -> None:
    from agents.concierge.lens import load_preset_lenses

    insights = [
        InsightCandidate(
            match_id="SMOKE-002", window_start_min=12.0, window_end_min=12.0,
            trigger_type="milestone", metric_name="goal", metric_value=1.0,
            related_players=["home_9"], window_summary={"team": "home", "xg": 0.42},
        ),
        InsightCandidate(
            match_id="SMOKE-002", window_start_min=34.0, window_end_min=37.0,
            trigger_type="xt_surge", metric_name="xt_gain", metric_value=0.09,
            baseline_value=0.02, delta_pct=350.0, related_players=["home_8", "home_9"],
            window_summary={"team": "home", "action_type": "pass"},
        ),
    ]
    names = {"home_9": "Dante Ribeiro", "home_8": "Oscar Hayes"}

    casual = await personalize(insights, "casual_fan", player_names=names)
    print("Casual fan:", casual)

    guardiola = load_preset_lenses()["guardiola_positional_play"]
    analyst_guardiola = await personalize(insights, "analyst", lens=guardiola, player_names=names)
    print("Analyst (Guardiola lens):", analyst_guardiola)

    tracker = await personalize(insights, "player_tracker", player_id="home_9", player_names=names)
    print("Player tracker (home_9):", tracker)


if __name__ == "__main__":
    asyncio.run(_smoke_test())
