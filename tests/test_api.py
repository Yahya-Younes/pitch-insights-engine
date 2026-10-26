"""Behaviour tests for the FastAPI surface in service/main.py.

Everything runs offline: the `client` fixture (tests/conftest.py) swaps the
real Foundry-backed narrate/personalize/ask and Azure TTS for fakes and
never runs the app lifespan, so no test here touches Azure or the network.
"""
from __future__ import annotations

import time

import pytest

import service.main as main_module
from agents.narrator.fallback import fallback_narration
from agents.shared.models import InsightCandidate

TERMINAL_STATUSES = {"done", "crashed", "failed"}
UNKNOWN_MATCH = "NO-SUCH-MATCH"


# -- helpers ----------------------------------------------------------------

def _is_client_error(status_code: int) -> bool:
    return 400 <= status_code < 500


def _seed_insight(STATE, match_id="M-API", trigger_type="milestone", **overrides) -> InsightCandidate:
    insight = InsightCandidate(
        match_id=match_id, window_start_min=10.0, window_end_min=12.0, trigger_type=trigger_type,
        metric_name="goal", metric_value=1.0, related_players=["home_9"], window_summary={"team": "home"},
        **overrides,
    )
    STATE["handoff_log"].record(
        "insight", match_id, {**insight.model_dump(), "narrative_text": "Goal!", "fact_checked": True},
    )
    return insight


def _start_match(client, **body) -> str:
    resp = client.post("/matches/run", json={"seed": 7, "minutes": 5, **body})
    assert resp.status_code == 200, resp.text
    return resp.json()["match_id"]


def _wait_for_terminal_status(client, match_id: str, timeout_s: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout_s
    while True:
        resp = client.get(f"/matches/{match_id}/status")
        assert resp.status_code == 200, resp.text
        status = resp.json()
        if status["status"] in TERMINAL_STATUSES:
            return status
        if time.monotonic() > deadline:
            pytest.fail(f"match {match_id} still {status['status']!r} after {timeout_s}s")
        time.sleep(0.05)


@pytest.fixture
def completed_match(client):
    match_id = _start_match(client)
    status = _wait_for_terminal_status(client, match_id)
    assert status["status"] == "done", status
    return match_id


# -- static / metadata endpoints ---------------------------------------------

def test_health_reports_ok(client):
    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_lenses_lists_every_preset_lens_with_its_attribution(client, STATE):
    resp = client.get("/lenses")

    assert resp.status_code == 200
    body = resp.json()
    assert {lens["lens_id"] for lens in body} == set(STATE["lenses"])
    for lens in body:
        assert set(lens) == {
            "lens_id", "attributed_style_of", "tone_descriptors", "tactical_principles", "sourcing_note",
        }


def test_tactics_lab_formations_lists_formations_and_quality_bounds(client):
    resp = client.get("/tactics-lab/formations")

    assert resp.status_code == 200
    body = resp.json()
    assert "4-3-3" in body["formations"]
    assert body["quality_min"] < body["quality_max"]


def test_negotiate_is_unavailable_without_web_pubsub(client):
    resp = client.get("/negotiate")

    assert resp.status_code == 503


def test_robustness_reports_a_catch_rate_from_the_live_checker(client):
    resp = client.get("/robustness")

    assert resp.status_code == 200
    body = resp.json()
    assert 0.0 <= body["catch_rate"] <= 1.0
    assert body["corruptions_caught"] <= body["corruptions_total"]
    assert body["corruptions_total"] > 0


def test_stats_aggregates_headline_numbers(client, monkeypatch):
    # The expensive / model-backed computations are stubbed; this checks the
    # endpoint's own wiring (caching into STATE, robustness, grounding window).
    monkeypatch.setattr(main_module, "compute_tendency_recovery_accuracy", lambda: {"accuracy": 1.0})
    monkeypatch.setattr(main_module, "run_realism_check", lambda: {"ok": True})
    monkeypatch.setattr(main_module, "compute_formation_detection_accuracy", lambda: {"accuracy": 0.9})
    monkeypatch.setattr(main_module, "compute_finetuned_narrator_comparison", lambda state: {"skipped": True})

    resp = client.get("/stats")

    assert resp.status_code == 200
    body = resp.json()
    assert body["tendency_recovery"] == {"accuracy": 1.0}
    assert body["realism"] == {"ok": True}
    assert body["formation_detection"] == {"accuracy": 0.9}
    assert body["fine_tuned_narrator"] == {"skipped": True}
    assert "catch_rate" in body["robustness"]
    assert "window" in body["grounding"]


# -- Tactics Lab ---------------------------------------------------------------

@pytest.mark.parametrize("payload", [
    {"home_formation": "9-9-9", "away_formation": "4-4-2", "n_matches": 1},
    {"home_formation": "4-3-3", "away_formation": "4-4-2", "n_matches": 0},
    {"home_formation": "4-3-3", "away_formation": "4-4-2", "n_matches": 201},
], ids=["unknown-formation", "zero-matches", "too-many-matches"])
def test_tactics_lab_simulate_rejects_invalid_input(client, payload):
    resp = client.post("/tactics-lab/simulate", json=payload)

    assert _is_client_error(resp.status_code), resp.text


def test_tactics_lab_simulate_record_sums_to_n_matches(client):
    resp = client.post(
        "/tactics-lab/simulate", json={"home_formation": "4-3-3", "away_formation": "4-4-2", "n_matches": 1},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    record = body["home_record"]
    assert body["n_matches"] == 1
    assert record["wins"] + record["draws"] + record["losses"] == 1


# -- full demo-match run (fakes for every LLM call) ----------------------------

def test_run_match_completes_and_exposes_every_pipeline_stage(client, completed_match):
    resp = client.get(f"/matches/{completed_match}/handoff")

    assert resp.status_code == 200
    stages = {entry["stage"] for entry in resp.json()}
    assert {"scout", "analyst0", "insight"} <= stages
    assert all(entry["match_id"] == completed_match for entry in resp.json())


def test_run_match_response_names_both_teams(client):
    resp = client.post("/matches/run", json={"seed": 7, "minutes": 1})

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "running"
    assert body["match_id"].startswith("DEMO-")
    assert body["home_team"] and body["away_team"]
    _wait_for_terminal_status(client, body["match_id"])


@pytest.mark.parametrize("path", ["positions", "analytics", "tactics"])
def test_per_match_views_are_available_for_a_run_match(client, completed_match, path):
    resp = client.get(f"/matches/{completed_match}/{path}")

    assert resp.status_code == 200, resp.text
    assert resp.json()


def test_positions_frames_carry_ball_and_player_coordinates(client, completed_match):
    body = client.get(f"/matches/{completed_match}/positions").json()

    assert body["match_id"] == completed_match
    frame = body["frames"][0]
    assert len(frame["ball"]) >= 2  # x, y (+ height for the ball)
    assert all(len(xy) == 2 for xy in frame["players"].values())


@pytest.mark.parametrize("bucket_min", [0.1, 31])
def test_analytics_rejects_out_of_range_bucket_size(client, completed_match, bucket_min):
    resp = client.get(f"/matches/{completed_match}/analytics", params={"bucket_min": bucket_min})

    assert _is_client_error(resp.status_code)


@pytest.mark.parametrize("body", [
    {"lens_id": "not-a-real-lens"},
    {"persona": "not_a_persona"},
    {"locale": "xx"},
], ids=["unknown-lens", "unknown-persona", "unknown-locale"])
def test_run_match_rejects_invalid_request(client, body):
    resp = client.post("/matches/run", json={"seed": 7, "minutes": 1, **body})

    assert _is_client_error(resp.status_code), resp.text


def test_run_match_with_injected_fault_still_completes(client):
    match_id = _start_match(client, inject_fault=True)

    status = _wait_for_terminal_status(client, match_id)

    assert status["status"] == "done"


def test_crashed_match_can_be_resumed_from_its_checkpoint(client):
    match_id = _start_match(client, inject_crash=True)
    crashed = _wait_for_terminal_status(client, match_id)
    assert crashed["status"] == "crashed"
    assert crashed["checkpoint_id"]

    resp = client.post(f"/matches/{match_id}/resume")

    assert resp.status_code == 200, resp.text
    assert resp.json()["match_id"] == match_id
    assert _wait_for_terminal_status(client, match_id)["status"] == "done"


def test_resume_rejects_a_match_that_did_not_crash(client, completed_match):
    resp = client.post(f"/matches/{completed_match}/resume")

    assert _is_client_error(resp.status_code)


def test_resume_rejects_a_crash_without_any_checkpoint(client, STATE):
    STATE.setdefault("match_status", {})["M-NOCKPT"] = {
        "status": "crashed", "checkpoint_id": None, "persona": "casual_fan", "lens_id": None, "locale": "en",
    }

    resp = client.post("/matches/M-NOCKPT/resume")

    assert resp.status_code == 409


# -- unknown match ids -------------------------------------------------------------

@pytest.mark.parametrize("method, path, body", [
    ("get", "status", None),
    ("get", "positions", None),
    ("get", "analytics", None),
    ("get", "tactics", None),
    ("post", "resume", None),
    ("post", "whatif", {"insight_id": "abc"}),
    ("post", "compare", {"persona_a": "casual_fan", "persona_b": "analyst"}),
])
def test_unknown_match_is_a_client_error(client, method, path, body):
    resp = client.request(method.upper(), f"/matches/{UNKNOWN_MATCH}/{path}", json=body)

    assert _is_client_error(resp.status_code), resp.text


def test_unknown_match_handoff_is_a_client_error(client):
    resp = client.get(f"/matches/{UNKNOWN_MATCH}/handoff")

    assert resp.status_code == 404


def test_unknown_match_ask_is_a_client_error(client, monkeypatch):
    from agents.qa.agent import ask as real_ask  # offline: returns the fallback when there are no insights
    monkeypatch.setattr(main_module, "ask_match_question", real_ask)

    resp = client.post(f"/matches/{UNKNOWN_MATCH}/ask", json={"question": "Who scored?"})

    assert resp.status_code == 404
    assert not [e for e in main_module._state["handoff_log"].entries() if e.match_id == UNKNOWN_MATCH]


# -- what-if ---------------------------------------------------------------------

def test_whatif_rejects_an_insight_with_no_counterfactual_mapping(client, STATE):
    insight = _seed_insight(STATE, trigger_type="milestone")

    resp = client.post("/matches/M-API/whatif", json={"insight_id": insight.insight_id, "knob": {}})

    assert resp.status_code == 400
    assert "milestone" in resp.json()["detail"]


def test_whatif_404s_for_an_unknown_insight_id(client, STATE):
    _seed_insight(STATE)

    resp = client.post("/matches/M-API/whatif", json={"insight_id": "not-an-insight"})

    assert resp.status_code == 404


# -- ask the match -----------------------------------------------------------------

def test_ask_returns_a_grounded_answer_and_logs_the_exchange(client, STATE, monkeypatch):
    seeded = _seed_insight(STATE)
    seen = {}

    async def fake_ask(question, insights, player_names=None, locale="en"):
        seen["question"], seen["insights"] = question, insights
        return fallback_narration(insights[0]), True

    monkeypatch.setattr(main_module, "ask_match_question", fake_ask)

    resp = client.post("/matches/M-API/ask", json={"question": "Who scored?"})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["fact_checked"] is True
    assert body["answer"] == fallback_narration(seeded)
    assert seen["question"] == "Who scored?"
    assert [i.insight_id for i in seen["insights"]] == [seeded.insight_id]
    qa_entries = [e for e in STATE["handoff_log"].entries() if e.stage == "qa"]
    assert len(qa_entries) == 1 and qa_entries[0].summary["question"] == "Who scored?"


@pytest.mark.parametrize("question", ["", "x" * 501], ids=["empty", "too-long"])
def test_ask_rejects_invalid_questions(client, STATE, question):
    _seed_insight(STATE)

    resp = client.post("/matches/M-API/ask", json={"question": question})

    assert _is_client_error(resp.status_code), resp.text
