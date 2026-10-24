"""Self-distillation training-set exporter for fine-tuning a cheaper Narrator model.

Runs N full synthetic matches through the REAL orchestrator pipeline (real
Azure AI Foundry Narrator calls against the current production deployment,
real live grounding checks) and keeps only the insight narrations that
passed grounding -- the model's own verified-good output, never a
hand-written or fallback sentence. This is the training set for fine-tuning
a smaller model (gpt-4.1-mini) to reproduce the current production model's
grounded narration style and voice, honestly sourced from our own pipeline
rather than any external dataset.

Concierge's LLM call is bypassed (a cheap no-op personalize_fn) since this
export only needs Narrator's insight-level narrations -- halves the live LLM
cost of generating this dataset.

Writes incrementally (one line appended per kept example, as each match
finishes) rather than buffering everything in memory until the end -- an
interrupted run still leaves a valid, partially-complete JSONL file instead
of losing all progress.

Usage: python -m tools.export_finetune_dataset [n_matches] [out_path] [seed_start] [duration_min]
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path

from agents.concierge.lens import CoachLens
from agents.orchestrator.workflow import run_match
from agents.shared.handoff_log import InMemoryHandoffLog
from datagen.match_simulator import MatchSimulator

REPO_ROOT = Path(__file__).resolve().parents[1]
_NARRATOR_SYSTEM_PROMPT = (REPO_ROOT / "agents" / "narrator" / "prompts" / "narrator_system.md").read_text(encoding="utf-8")


async def _cheap_personalize_fn(
    insights: list, persona: str, lens: CoachLens | None = None,
    player_names: dict[str, str] | None = None, locale: str = "en",
) -> str:
    return ""


class _VerboseLog(InMemoryHandoffLog):
    """Prints a running line per insight as the live Narrator pipeline
    produces it, so progress is visible in real time instead of only after
    an entire match (dozens of serialized LLM calls) finishes."""

    def record(self, stage: str, match_id: str, summary: dict) -> None:
        super().record(stage, match_id, summary)
        # Per-insight printing is opt-in (EXPORT_VERBOSE=1) -- useful for a
        # short timing test, far too noisy (one line per LLM call) for a
        # real multi-match batch that can run for an hour or more.
        if stage == "insight" and os.environ.get("EXPORT_VERBOSE") == "1":
            fc = "ok" if summary.get("fact_checked") else "FALLBACK"
            print(f"    insight {summary.get('trigger_type')} [{fc}]", flush=True)


def _build_example(summary: dict, player_names: dict[str, str]) -> dict:
    narrative_text = summary["narrative_text"]
    related_players = summary.get("related_players", [])
    payload = {k: v for k, v in summary.items() if k not in ("narrative_text", "fact_checked")}
    payload["related_player_names"] = {pid: player_names.get(pid, pid) for pid in related_players}
    return {
        "messages": [
            {"role": "system", "content": _NARRATOR_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, indent=2)},
            {"role": "assistant", "content": narrative_text},
        ],
    }


async def _export(n_matches: int, out_path: Path, seed_start: int, duration_min: float) -> None:
    total_kept = 0
    t0 = time.monotonic()
    with out_path.open("a", encoding="utf-8") as fh:
        for i in range(n_matches):
            seed = seed_start + i
            match_id = f"FT-EXPORT-{seed}"
            result = MatchSimulator(match_id, seed).generate_match()
            duration_ms = int(duration_min * 60000)
            raw_events = [
                e.model_dump(mode="json") for e in result.events
                if e.type == "match_metadata" or e.match_clock_ms <= duration_ms
            ]
            player_names = {p.player_id: p.player_name for p in [*result.home_profiles, *result.away_profiles]}

            match_t0 = time.monotonic()
            print(f"[{i+1}/{n_matches}] match {match_id} (seed={seed}) starting...", flush=True)
            try:
                _, log = await run_match(
                    raw_events, match_id, duration_ms,
                    player_names=player_names, personalize_fn=_cheap_personalize_fn,
                    handoff_log=_VerboseLog(),
                )
            except Exception as exc:
                print(f"match {match_id} (seed={seed}) failed: {exc!r} -- skipping", file=sys.stderr, flush=True)
                continue

            insight_entries = [e for e in log.entries() if e.stage == "insight"]
            kept = 0
            for entry in insight_entries:
                summary = entry.summary
                if not summary.get("fact_checked"):
                    continue
                example = _build_example(summary, player_names)
                fh.write(json.dumps(example) + "\n")
                kept += 1
            fh.flush()
            total_kept += kept
            elapsed = time.monotonic() - match_t0
            print(
                f"[{i+1}/{n_matches}] match {match_id}: {len(insight_entries)} insights, "
                f"{kept} verified/kept ({elapsed:.0f}s) -- running total: {total_kept}",
                flush=True,
            )

    print(f"\nwrote {total_kept} training examples to {out_path} in {time.monotonic() - t0:.0f}s total")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else REPO_ROOT / "tools" / "finetune_data" / "narrator_distillation.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    seed_start = int(sys.argv[3]) if len(sys.argv) > 3 else random.randint(1, 1_000_000)
    duration_min = float(sys.argv[4]) if len(sys.argv) > 4 else 90.0
    asyncio.run(_export(n, out, seed_start, duration_min))
