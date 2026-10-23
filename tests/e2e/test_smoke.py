"""End-to-end smoke test against a REAL deployed instance (or a locally
running `uvicorn service.main:app`) -- not part of the fast, offline,
Azure-independent core suite the rest of tests/ is. Skipped by default;
set PITCH_E2E_BASE_URL to opt in for a manual pre-submission check:

    PITCH_E2E_BASE_URL=https://pitch-orchestrator.<...>.azurecontainerapps.io \
        python -m pytest tests/e2e/test_smoke.py -v -s

No CI wiring given the time budget for this round -- a manual run before
submission is enough to catch "the live deployment is actually broken,"
which is what this exists for.
"""
from __future__ import annotations

import os
import time

import httpx
import pytest

BASE_URL = os.environ.get("PITCH_E2E_BASE_URL")

pytestmark = pytest.mark.skipif(
    not BASE_URL, reason="set PITCH_E2E_BASE_URL to run the live-deployment smoke test",
)


def test_health_ok():
    resp = httpx.get(f"{BASE_URL}/health", timeout=15)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_full_match_pipeline_produces_a_concierge_entry():
    resp = httpx.post(f"{BASE_URL}/matches/run", json={"persona": "casual_fan", "minutes": 1}, timeout=30)
    assert resp.status_code == 200
    match_id = resp.json()["match_id"]

    deadline = time.monotonic() + 120
    saw_concierge = False
    while time.monotonic() < deadline:
        handoff = httpx.get(f"{BASE_URL}/matches/{match_id}/handoff", timeout=15)
        assert handoff.status_code == 200
        entries = handoff.json()
        if any(e["stage"] == "concierge" for e in entries):
            saw_concierge = True
            break
        time.sleep(3)

    assert saw_concierge, f"no concierge entry for match {match_id!r} within 120s"


def test_stats_ok():
    resp = httpx.get(f"{BASE_URL}/stats", timeout=30)
    assert resp.status_code == 200
    body = resp.json()
    assert "tendency_recovery" in body
    assert "grounding" in body
    assert "robustness" in body
    assert "realism" in body
