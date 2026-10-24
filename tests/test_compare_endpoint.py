"""Validation-path tests for POST /matches/{id}/compare -- the split-screen
dual-persona comparison endpoint. Mocks out the real (Azure-backed)
personalize() so these run offline; the actual LLM-backed happy path is
verified live after deploy, the same way the rest of this service's
LLM-backed endpoints are (see tests/e2e/test_smoke.py)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import service.main as main_module
from service.main import app
from service.state import STATE
from agents.shared.handoff_log import InMemoryHandoffLog
from agents.shared.models import InsightCandidate


@pytest.fixture
def client(monkeypatch):
    log = InMemoryHandoffLog()
    STATE["handoff_log"] = log
    STATE["lenses"] = {}
    STATE["player_names_by_match"] = {}

    async def fake_personalize(insights, persona, lens=None, player_id=None, locale="en", player_names=None):
        return f"[{persona}] recap of {len(insights)} insight(s)"

    monkeypatch.setattr(main_module, "personalize", fake_personalize)
    return TestClient(app), log


def _seed_insight(log, match_id="M1"):
    insight = InsightCandidate(
        match_id=match_id, window_start_min=10.0, window_end_min=12.0, trigger_type="milestone",
        metric_name="goal", metric_value=1.0, related_players=["home_9"], window_summary={"team": "home"},
    )
    log.record("insight", match_id, {**insight.model_dump(), "narrative_text": "Goal!", "fact_checked": True})


def test_compare_returns_both_personas_side_by_side(client):
    test_client, log = client
    _seed_insight(log)
    resp = test_client.post("/matches/M1/compare", json={"persona_a": "casual_fan", "persona_b": "analyst"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["left"]["persona"] == "casual_fan"
    assert body["right"]["persona"] == "analyst"
    assert "casual_fan" in body["left"]["text"]
    assert "analyst" in body["right"]["text"]


def test_compare_rejects_unknown_persona(client):
    test_client, log = client
    _seed_insight(log)
    resp = test_client.post("/matches/M1/compare", json={"persona_a": "casual_fan", "persona_b": "not_a_persona"})
    assert resp.status_code == 400


def test_compare_404s_with_no_insights_yet(client):
    test_client, _log = client
    resp = test_client.post("/matches/NO-SUCH-MATCH/compare", json={"persona_a": "casual_fan", "persona_b": "analyst"})
    assert resp.status_code == 404


def test_compare_rejects_unknown_lens_id(client):
    test_client, log = client
    _seed_insight(log)
    resp = test_client.post(
        "/matches/M1/compare",
        json={"persona_a": "casual_fan", "persona_b": "analyst", "lens_id_a": "not-a-real-lens"},
    )
    assert resp.status_code == 400
