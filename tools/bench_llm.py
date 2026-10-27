"""Benchmark the LLM stages (Narrator, Concierge) under different model settings.

Generates a fixed set of real InsightCandidates offline (Scout + Analyst-0
only, no LLM), then narrates / personalizes the *same* insights with each
configuration and reports, per configuration: wall time per call, input /
output / reasoning tokens, and how often the live grounding checker accepts
the text (the same check production uses before anything ships).

Needs AZURE_AI_FOUNDRY_ENDPOINT + AZURE_AI_FOUNDRY_CHAT_DEPLOYMENT and an
identity allowed to call the deployment (az login locally).

    python -m tools.bench_llm --matches 3 --configs default,low,minimal
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import time
from pathlib import Path

from agent_framework import Agent
from agent_framework_foundry import FoundryChatClient
from azure.identity import DefaultAzureCredential

from agents.concierge.persona_filter import filter_for_persona
from agents.narrator.fallback import fallback_narration
from agents.orchestrator.workflow import run_match
from agents.shared.glossary import glossary_terms_for
from agents.shared.llm import insight_for_prompt, to_wire
from agents.shared.models import InsightCandidate
from datagen.match_simulator import MatchSimulator
from eval.grounding_check import check_grounding, check_grounding_multi

ROOT = Path(__file__).resolve().parents[1]
NARRATOR_PROMPT = (ROOT / "agents" / "narrator" / "prompts" / "narrator_system.md").read_text(encoding="utf-8")
CONCIERGE_PROMPTS = ROOT / "agents" / "concierge" / "prompts"

# name -> chat options passed to the agent (None = the model's own default).
CONFIGS: dict[str, dict] = {
    "default": {},
    "low": {"reasoning": {"effort": "low"}},
    "minimal": {"reasoning": {"effort": "minimal"}},
    "minimal_lowverb": {"reasoning": {"effort": "minimal"}, "verbosity": "low"},
}


async def _offline_narrate(insight, player_names=None):
    return fallback_narration(insight)


async def _offline_personalize(*args, **kwargs):
    return ""


async def build_insights(n_matches: int, minutes: float, seed0: int) -> list[tuple[InsightCandidate, dict]]:
    out = []
    for seed in range(seed0, seed0 + n_matches):
        match_id = f"BENCH-{seed}"
        result = MatchSimulator(match_id, seed).generate_match()
        cutoff = int(minutes * 60000)
        raw = [e.model_dump(mode="json") for e in result.events if e.type == "match_metadata" or e.match_clock_ms <= cutoff]
        names = {p.player_id: p.player_name for p in [*result.home_profiles, *result.away_profiles]}
        _, log = await run_match(raw, match_id, cutoff, player_names=names,
                                 narrate_fn=_offline_narrate, personalize_fn=_offline_personalize)
        for e in log.entries():
            if e.stage == "insight":
                fields = {k: v for k, v in e.summary.items() if k not in ("narrative_text", "fact_checked")}
                out.append((InsightCandidate(**fields), names))
    return out


def _agent(instructions: str, name: str, options: dict) -> Agent:
    client = FoundryChatClient(
        project_endpoint=os.environ["AZURE_AI_FOUNDRY_ENDPOINT"],
        model=os.environ["AZURE_AI_FOUNDRY_CHAT_DEPLOYMENT"],
        credential=DefaultAzureCredential(),
    )
    return Agent(client=client, instructions=instructions, name=name, default_options=options or None)


def _narrator_payload(insight: InsightCandidate, names: dict, compact: bool) -> str:
    if compact:  # exactly what production sends (agents/shared/llm.py)
        return to_wire(insight_for_prompt(insight, names))
    payload = insight.model_dump()
    payload["related_player_names"] = {pid: names.get(pid, pid) for pid in insight.related_players}
    return json.dumps(payload, indent=2)


def _concierge_payload(insight: InsightCandidate, names: dict, locale: str, compact: bool) -> str | None:
    selected = filter_for_persona([insight], "casual_fan")
    if not selected:
        return None
    if compact:  # exactly what production sends (agents/shared/llm.py)
        items = [insight_for_prompt(c, names, glossary_terms=glossary_terms_for(locale, c.trigger_type))
                 for c in selected]
        return to_wire({"locale": locale, "lens": None, "player_id": None, "insights": items})
    payload = {
        "locale": locale, "lens": None, "player_id": None,
        "insights": [{**c.model_dump(),
                      "related_player_names": {pid: names.get(pid, pid) for pid in c.related_players},
                      "glossary_terms": glossary_terms_for(locale, c.trigger_type)} for c in selected],
    }
    return json.dumps(payload, indent=2)


class TokenPacer:
    """Keeps the benchmark under the deployment's tokens-per-minute limit, so
    measured latency is the model's own and not time spent throttled (429 +
    SDK retry back-off). tpm=0 disables pacing."""

    def __init__(self, tpm: int):
        self.tpm, self.window = tpm, []  # (timestamp, tokens)
        self.lock = asyncio.Lock()

    async def wait(self, estimate: int) -> None:
        if not self.tpm:
            return
        async with self.lock:
            while True:
                now = time.monotonic()
                self.window = [(t, n) for t, n in self.window if now - t < 60]
                if sum(n for _, n in self.window) + estimate <= self.tpm:
                    self.window.append((now, estimate))
                    return
                await asyncio.sleep(1.0)

    def settle(self, estimate: int, actual: int) -> None:
        for i in range(len(self.window) - 1, -1, -1):
            if self.window[i][1] == estimate:
                self.window[i] = (self.window[i][0], actual)
                return


PACER = TokenPacer(0)


async def _timed(agent: Agent, message: str, sem: asyncio.Semaphore) -> tuple[str, float, dict]:
    estimate = len(message) // 3 + 2500  # prompt + payload + worst-case output, rough
    async with sem:
        await PACER.wait(estimate)
        t0 = time.perf_counter()
        resp = await asyncio.wait_for(agent.run(message), timeout=120)
        dt = time.perf_counter() - t0
    usage = dict(resp.usage_details or {})
    PACER.settle(estimate, int(usage.get("total_token_count") or estimate))
    return resp.text.strip(), dt, usage


def _summarize(rows: list[dict]) -> dict:
    ok = [r for r in rows if "error" not in r]
    lat = [r["seconds"] for r in ok]

    def tok(key):
        vals = [r["usage"].get(key) or 0 for r in ok]
        return round(statistics.mean(vals), 1) if vals else 0

    return {
        "calls": len(rows), "errors": len(rows) - len(ok),
        "grounded_pct": round(100 * sum(r["grounded"] for r in ok) / max(len(ok), 1), 1),
        "p50_s": round(statistics.median(lat), 2) if lat else None,
        "p90_s": round(sorted(lat)[int(0.9 * (len(lat) - 1))], 2) if lat else None,
        "input_tok": tok("input_token_count"), "output_tok": tok("output_token_count"),
        "reasoning_tok": tok("openai.reasoning_tokens"),
        "avg_chars": round(statistics.mean(len(r["text"]) for r in ok), 0) if ok else 0,
    }


async def bench_stage(stage: str, insights, config: str, compact: bool, locale: str, concurrency: int) -> dict:
    options = CONFIGS[config]
    sem = asyncio.Semaphore(concurrency)
    if stage == "narrator":
        agent = _agent(NARRATOR_PROMPT, "Narrator", options)
    else:
        agent = _agent((CONCIERGE_PROMPTS / "casual_fan_system.md").read_text(encoding="utf-8"), "Concierge", options)

    async def one(insight, names):
        if stage == "narrator":
            msg = _narrator_payload(insight, names, compact)
        else:
            msg = _concierge_payload(insight, names, locale, compact)
            if msg is None:
                return None
        try:
            text, dt, usage = await _timed(agent, msg, sem)
        except Exception as exc:  # noqa: BLE001 -- recorded, not fatal
            return {"insight_id": insight.insight_id, "error": repr(exc)[:200]}
        if stage == "narrator":
            grounded = check_grounding(text, insight, names).passed
        else:
            grounded = check_grounding_multi(text, [insight], names, locale=locale).passed
        return {"insight_id": insight.insight_id, "trigger": insight.trigger_type, "seconds": round(dt, 2),
                "usage": usage, "grounded": grounded, "text": text}

    t0 = time.perf_counter()
    rows = [r for r in await asyncio.gather(*(one(i, n) for i, n in insights)) if r is not None]
    summary = _summarize(rows)
    summary["wall_s"] = round(time.perf_counter() - t0, 1)
    return {"stage": stage, "config": config, "compact": compact, "locale": locale, "summary": summary, "rows": rows}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", type=int, default=3)
    ap.add_argument("--minutes", type=float, default=12.0)
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--configs", default="default,low,minimal")
    ap.add_argument("--stages", default="narrator,concierge")
    ap.add_argument("--locales", default="en,fr")
    ap.add_argument("--compact", action="store_true", help="send the production payload (compact, no internal ids)")
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--out", default="bench_results.json")
    ap.add_argument("--tpm", type=int, default=0, help="pace calls under this tokens/min budget (0 = no pacing)")
    args = ap.parse_args()
    PACER.tpm = args.tpm

    insights = await build_insights(args.matches, args.minutes, args.seed)
    print(f"{len(insights)} insights from {args.matches} matches", flush=True)
    results = []
    for stage in args.stages.split(","):
        for config in args.configs.split(","):
            for locale in (args.locales.split(",") if stage == "concierge" else ["en"]):
                res = await bench_stage(stage, insights, config, args.compact, locale, args.concurrency)
                results.append(res)
                print(json.dumps({k: res[k] for k in ("stage", "config", "locale", "compact")} | res["summary"]), flush=True)
    Path(args.out).write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
