# Pitch Insights Engine

A live football-match-intelligence system built on **Microsoft Agent Framework** and **Azure AI Foundry** for Microsoft + Premier League's "Inside the Game" Developer Hackathon.

A synthetic match plays out event-by-event through a 5-stage multi-agent pipeline — **Scout → Analyst-0 → Narrator → {Broadcaster, Concierge}** — that turns raw events into fact-checked, persona-aware commentary, live on screen, with every claim verified against the data that produced it before it ever reaches a viewer.

**Live demo:** https://ashy-river-023c7cf0f.3.azurestaticapps.net

## Why this exists

Most AI sports-commentary demos either hallucinate stats or read like a press release. This project's whole premise is **explainability you can check**: every number the system states traces back to a specific `InsightCandidate` it computed; every claim is run through a live grounding checker before publication; and the headline accuracy numbers below are computed by the running system on every page load, not asserted in this file.

## The pipeline

| Stage | Agent | What it does |
|---|---|---|
| (a) | **Scout** | Ingests and validates raw match events (from a live demo run or the Event Hubs stream) |
| (b) | **Analyst-0** | Deterministic, no-LLM football analytics: PPDA (pressing intensity), a chaos/control composite, tempo z-scores, Expected Threat (Karun Singh-style Markov value iteration), pass difficulty, referee positioning quality, and player-tendency inference — each a named, real analytics concept, honestly documented where it's hand-calibrated rather than fit from data |
| (c) | **Narrator** | Explains *why* a flagged moment matters, in 1-2 sentences, grounded only in that insight's own fields |
| (d) | **Broadcaster** | Deterministic, zero-LLM: builds the broadcast-graphics overlay payload from the Narrator's verified output |
| (e) | **Concierge** | Personalizes the same insights for a chosen viewer persona and Coach Lens, in the viewer's chosen language |

Every stage's input/output is recorded to a shared handoff log (Cosmos DB in production), giving a concrete, inspectable orchestration trace per match — see `GET /matches/{id}/handoff`.

## Live, checkable numbers

`GET /stats` (and the badges at the top of the live demo) report four numbers computed fresh by the running system, not hardcoded:

- **Tendency-recovery accuracy** — how well a purely frequency-based inference model (never shown the generator's hidden ground truth) recovers each player's actual dominant behavioral tendency, scored against that hidden ground truth.
- **Grounding pass rate** — the real pass/fail rate of the live grounding checker (`eval/grounding_check.py`) across actual Narrator/Concierge output from live-run matches, not an offline-only test.
- **Fact-checking scorecard** — deliberately corrupted narrations (fabricated numbers, wrong-but-real player names, off-topic phrasing) run through the same live grounding checker on every request, reporting a real catch rate and false-positive rate.
- **Real-match realism scorecard** — our synthetic generator's basic match statistics (pressing intensity, pass completion, shot volume, possession split) compared against the literal min-max range observed across a real sample of StatsBomb Open Data Premier League matches (2003/04 + 2015/16 seasons — `eval/real_data_validation.py`, `tools/fetch_real_data_validation.py`), not a hand-typed table of publicly reported numbers. Reported **honestly either way**, and the sample size/provenance ships in the response itself rather than being asserted in prose.

## Features

- **5-stage live orchestration** via Microsoft Agent Framework's `WorkflowBuilder`, deployed on Azure Container Apps, with every insight individually fact-checked before it ships.
- **Real workflow checkpoint/resume** using Agent Framework's native `CheckpointStorage` — a demo toggle ("crash + recover mid-match") deliberately crashes the pipeline mid-run and resumes it from its last checkpoint, without re-running already-completed stages. Also fixed two real bugs discovered while wiring this in: Narrator/Concierge used to silently drop an insight on any LLM failure (now retries once, then falls back instead of disappearing), and the Event Hubs consumer could lose an in-flight match's events on a crash (now checkpoints only after a match is confirmed fully processed).
- **Continuous player/ball position tracking + an animated pitch view** — synthetic, interpolated from the match's own recorded event locations (a physics-style arc for the ball on passes/shots), *not* computer vision or real tracking, exactly as disclosed.
- **"What If?" counterfactual scoring** — re-runs the same deterministic Analyst-0 function that produced an insight's real metric (Expected Threat, referee positioning quality, tendency alignment) against a hypothetical alternate input a viewer picks, returning a genuinely recomputed number, not an LLM guess.
- **An MCP server** (`/mcp`, mounted on the same Container App) exposing match insights, the live fact-checking scorecard, and a grounded Q&A tool as callable tools for any MCP-compatible client — not just this project's own frontend.
- **5 real-manager Coach Lenses** (Ferguson, Guardiola, Klopp, Mourinho, Wenger) that reframe which insights lead and how they're told, sourced from each manager's documented tactical philosophy.
- **Referee Decision Analytics** — positioning-quality scoring grounded in the Diagonal System of Control, with an IFAB Law citation, an estimated-impact heuristic, and an honest "too close to call" band instead of always presenting a confident verdict.
- **Player Tendency Profiles**, inferred purely from observed events (never from hidden ground truth) and scored against that ground truth only for the offline accuracy report above.
- **Multi-language narration and Q&A** (EN/FR/ES/DE) via Azure AI Speech voice synthesis, with a per-locale football glossary (`agents/shared/glossary.py`) that both steers translation and restores real vocabulary fact-checking for non-English output — previously, non-English narration had that check silently skipped entirely.
- **A grounded "Ask the Match" Q&A agent** that answers only from insights this system has actually verified for that match, and says so honestly when something hasn't come up yet rather than guessing.
- **Live Application Insights tracing** (OpenTelemetry), with trace IDs correlated into the handoff log so a judge can follow one request end-to-end.
- **A fine-tuned Narrator model** (`gpt-4.1-mini`, Azure AI Foundry Developer-tier — `tools/export_finetune_dataset.py`, `tools/launch_finetune.py`, `tools/deploy_finetuned_model.py`) trained via self-distillation: 752 real training examples collected by running 15 full synthetic matches through the actual live pipeline, keeping only the insight narrations that passed the live grounding check, never a hand-written template. Job `ftjob-90ab75cf1fb2459fa91ffbcd10a1fb2f` succeeded; the deployed model passes our own grounding check on fresh unseen input and writes in the Narrator's voice, e.g.: *"Between the 23rd and 26th minute the home side suddenly cranked up the press — their PPDA fell to 4.2, 40.8% below their match baseline of 7.1."* (Developer-tier deployments are evaluation-only and expire after 24h — redeploy with `tools/deploy_finetuned_model.py create <fine_tuned_model_id>` before a live demo if it's been a while.) This is a stronger sourcing story than it sounds like a competitor's claim of the same capability turned out to be — see the note below.

## What this deliberately does not claim

- **No computer vision on real match video.** This is an event-based synthetic simulator; there is no video input pipeline and no match footage. A few other hackathon entries do real CV on real footage — that's a different product, not an add-on to this one.
- **Our fine-tuning data is honestly synthetic, not real match data** — and we checked, rather than assumed, that this is a fair comparison: one competitor's public repo advertises "a fine-tuned model" without disclosing its training data, but its `tools/build_finetune_data.py` script shows the training examples are hand-written string templates with variable substitution, not real model output, let alone real match data. Our training examples are real: genuine outputs from our own production Narrator model, kept only when they passed a live, automated grounding check — a stronger sourcing story, even though it's still synthetic match data underneath both.

## Architecture

Azure Container Apps (orchestrator + FastAPI + MCP server) · Cosmos DB (handoff log) · Event Hubs (the genuine stage-(a) ingestion transport) · Web PubSub (live frontend overlay) · Azure Static Web Apps (frontend) · Azure AI Foundry (gpt-5-mini) · Azure AI Speech · Application Insights. See `infra/main.bicep` for the deployable definition, and `infra/snapshot/` for a point-in-time export of what's actually live.

## Running locally

```bash
pip install -r requirements.txt
# create .env.local with at least:
#   AZURE_AI_FOUNDRY_ENDPOINT=...
#   AZURE_AI_FOUNDRY_CHAT_DEPLOYMENT=...
# (az login first -- DefaultAzureCredential picks up your Azure CLI session)
python -m uvicorn service.main:app --reload
```

```bash
cd frontend
npm install
npm run dev
```

Cosmos DB, Web PubSub, Event Hubs, and Application Insights are all optional locally — each falls back to an in-memory/no-op implementation when its endpoint env var is unset, so the full agent pipeline runs against a real Azure AI Foundry model with no other Azure dependency required.

## Tests

```bash
python -m pytest            # fast, offline, Azure-independent core suite
PITCH_E2E_BASE_URL=<url> python -m pytest tests/e2e -v -s   # live-deployment smoke test
```
