"""'Ask the match' Q&A agent: a free-text question, answered only from the
InsightCandidates generated so far for one match.

Same grounded-prompt-and-Foundry-model pattern as Narrator/Concierge, with
the same non-negotiable rule: the model's answer is verified live against
eval.grounding_check before it's trusted. A failed check never reaches the
viewer as if it were a real answer -- it's replaced by a fixed, honest
"I don't have enough verified information" response, since (unlike the
Narrator, which always has one already-grounded fallback template per
insight) there's no single pre-verified sentence to fall back to for an
arbitrary question.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from agent_framework import Agent
from agent_framework_foundry import FoundryChatClient
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

from agents.shared.glossary import glossary_terms_for
from agents.shared.llm import chat_options, insight_for_prompt, report_usage, to_wire
from agents.shared.models import InsightCandidate
from eval.grounding_check import check_grounding_multi

_PROMPT_PATH = Path(__file__).parent / "prompts" / "qa_system.md"
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"
_CALL_TIMEOUT_S = 45.0

load_dotenv(_ENV_PATH)

NO_ANSWER_FALLBACK = "That hasn't come up in what's been verified for this match so far -- I don't want to guess at something I can't back up."

_agent: Agent | None = None
_semaphore = asyncio.Semaphore(3)


def _build_agent() -> Agent:
    endpoint = os.environ["AZURE_AI_FOUNDRY_ENDPOINT"]
    model = os.environ["AZURE_AI_FOUNDRY_CHAT_DEPLOYMENT"]
    system_prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    client = FoundryChatClient(project_endpoint=endpoint, model=model, credential=DefaultAzureCredential())
    return Agent(client=client, instructions=system_prompt, name="QA", default_options=chat_options("qa") or None)


def get_agent() -> Agent:
    global _agent
    if _agent is None:
        _agent = _build_agent()
    return _agent


async def ask(
    question: str, insights: list[InsightCandidate], player_names: dict[str, str] | None = None,
    locale: str = "en",
) -> tuple[str, bool]:
    """Returns (answer_text, fact_checked). fact_checked is False only when
    the model's answer failed grounding and NO_ANSWER_FALLBACK was used
    instead -- never when a real, verified answer shipped."""
    player_names = player_names or {}
    if not insights:
        return NO_ANSWER_FALLBACK, False

    payload = {
        "question": question,
        "locale": locale,
        "insights": [
            insight_for_prompt(c, player_names, glossary_terms=glossary_terms_for(locale, c.trigger_type))
            for c in insights
        ],
    }
    agent = get_agent()
    try:
        async with _semaphore:
            response = await asyncio.wait_for(agent.run(to_wire(payload)), timeout=_CALL_TIMEOUT_S)
    except Exception:
        return NO_ANSWER_FALLBACK, False

    report_usage(response)
    text = response.text.strip()
    result = check_grounding_multi(text, insights, player_names, locale=locale)
    if not result.passed:
        return NO_ANSWER_FALLBACK, False
    return text, True
