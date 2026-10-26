"""Shared pytest fixtures.

`STATE` (autouse) snapshots service.state.STATE before every test and
restores it afterwards, so tests that seed the process-wide app state (the
handoff log, lenses, per-match caches...) can't leak into each other.

`client` is a FastAPI TestClient over service.main.app that:
  - never runs the real lifespan (no Cosmos / Web PubSub / Event Hubs / MCP
    session manager), seeding STATE with offline equivalents instead;
  - keeps one event loop alive for the whole test (`with TestClient(...)`),
    so background tasks spawned by POST /matches/run actually finish;
  - disables slowapi rate limiting if the app has a limiter, restoring it
    afterwards.
"""
from __future__ import annotations

import copy

import pytest


def _snapshot(state: dict) -> dict:
    # Deep-ish: copy each container value one level down (per-match dicts,
    # the background-task set) so in-place mutations during a test are
    # undone, but share heavyweight objects (handoff logs, storages, lenses).
    snap = {}
    for key, value in state.items():
        if isinstance(value, (dict, set, list)):
            snap[key] = copy.copy(value)
        else:
            snap[key] = value
    return snap


@pytest.fixture(autouse=True)
def STATE():  # noqa: N802 -- named after the object it guards
    from service.state import STATE as state

    saved = _snapshot(state)
    yield state
    state.clear()
    state.update(saved)


async def _fake_narrate(insight, player_names=None):
    # Built on fallback_narration so it passes the live grounding check.
    from agents.narrator.fallback import fallback_narration
    return f"FAKE NARRATION: {fallback_narration(insight)}"


async def _fake_personalize(insights, persona, lens=None, player_id=None, locale="en", player_names=None):
    from agents.narrator.fallback import fallback_narration
    return f"FAKE PERSONALIZED ({persona}): {fallback_narration(insights[0])}"


@pytest.fixture
def client(STATE, monkeypatch, tmp_path):
    """Offline TestClient: fakes every LLM / TTS / network call main.py makes."""
    from fastapi.testclient import TestClient

    import service.main as main_module
    from agents.concierge.lens import load_preset_lenses
    from agents.shared.handoff_log import InMemoryHandoffLog
    from service.state import build_checkpoint_storage

    for var in ("COSMOS_ENDPOINT", "WEBPUBSUB_ENDPOINT", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("CHECKPOINT_DIR", str(tmp_path / "checkpoints"))

    STATE["handoff_log"] = InMemoryHandoffLog()
    STATE["publisher"] = None
    STATE["lenses"] = load_preset_lenses()
    STATE["checkpoint_storage"] = build_checkpoint_storage()

    real_run_match = main_module.run_match

    async def run_match_with_fakes(*args, **kwargs):
        kwargs.setdefault("narrate_fn", _fake_narrate)
        kwargs.setdefault("personalize_fn", _fake_personalize)
        return await real_run_match(*args, **kwargs)

    monkeypatch.setattr(main_module, "run_match", run_match_with_fakes)
    monkeypatch.setattr(main_module, "personalize", _fake_personalize)
    monkeypatch.setattr(main_module, "synthesize_base64", lambda text, locale="en": None)

    async def _no_network_ask(question, insights, player_names=None, locale="en"):
        raise AssertionError("ask_match_question must be faked by the test that needs it")

    monkeypatch.setattr(main_module, "ask_match_question", _no_network_ask)

    limiter = getattr(main_module.app.state, "limiter", None)
    was_enabled = getattr(limiter, "enabled", None)
    if limiter is not None:
        limiter.enabled = False

    async def app_without_lifespan(scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        await main_module.app(scope, receive, send)

    try:
        with TestClient(app_without_lifespan) as test_client:
            yield test_client
    finally:
        if limiter is not None:
            limiter.enabled = was_enabled
