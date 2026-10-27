"""Server-side resource caps: how many matches stay in memory, and how many
Tactics Lab simulations can run at once (REST and MCP share one guard)."""
from __future__ import annotations

import asyncio
import threading
import time

import pytest

from service import mcp_server
from service.state import (
    PER_MATCH_KEYS,
    PLAYER_GRAPH_CACHE_KEY,
    SimulationBusy,
    SimulationGuard,
    register_match,
)

TERMINAL_STATUSES = {"done", "crashed", "failed"}


def _wait_until_terminal(client, match_id: str, timeout_s: float = 30.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        resp = client.get(f"/matches/{match_id}/status")
        if resp.status_code == 200 and resp.json()["status"] in TERMINAL_STATUSES:
            return
        time.sleep(0.05)
    pytest.fail(f"match {match_id} never finished")


# -- in-memory match cap ------------------------------------------------------

def test_register_match_drops_every_entry_of_the_oldest_match(monkeypatch):
    monkeypatch.setenv("MAX_MATCHES_IN_MEMORY", "2")
    state: dict = {key: {} for key in PER_MATCH_KEYS}
    state[PLAYER_GRAPH_CACHE_KEY] = {}
    for match_id in ("A", "B"):
        register_match(state, match_id)
        for key in PER_MATCH_KEYS:
            state[key][match_id] = object()
        state[PLAYER_GRAPH_CACHE_KEY][(match_id, 0, 90, "both", False, 1)] = object()

    evicted = register_match(state, "C")

    assert evicted == ["A"]
    assert all("A" not in state[key] and "B" in state[key] for key in PER_MATCH_KEYS)
    assert [k[0] for k in state[PLAYER_GRAPH_CACHE_KEY]] == ["B"]


def test_registering_a_known_match_again_makes_it_the_newest(monkeypatch):
    monkeypatch.setenv("MAX_MATCHES_IN_MEMORY", "2")
    state: dict = {}
    register_match(state, "A")
    register_match(state, "B")
    register_match(state, "A")

    assert register_match(state, "C") == ["B"]


def test_running_more_matches_than_the_cap_frees_the_oldest_ones(client, monkeypatch):
    monkeypatch.setenv("MAX_MATCHES_IN_MEMORY", "2")
    match_ids = []
    for seed in (11, 12, 13):
        match_id = client.post("/matches/run", json={"seed": seed, "minutes": 1}).json()["match_id"]
        _wait_until_terminal(client, match_id)
        match_ids.append(match_id)

    assert client.get(f"/matches/{match_ids[0]}/positions").status_code == 404
    for match_id in match_ids[1:]:
        assert client.get(f"/matches/{match_id}/positions").status_code == 200


# -- Tactics Lab concurrency guard ----------------------------------------------

def test_guard_rejects_a_second_simulation_while_one_is_running():
    guard = SimulationGuard()
    started, release = threading.Event(), threading.Event()

    def slow():
        started.set()
        release.wait(5)
        return "first"

    async def scenario():
        first = asyncio.create_task(guard.run(slow))
        await asyncio.to_thread(started.wait, 5)
        with pytest.raises(SimulationBusy):
            await guard.run(lambda: "second")
        release.set()
        assert await first == "first"
        # The slot is released once the first run has finished.
        assert await guard.run(lambda: "third") == "third"

    asyncio.run(scenario())


def test_guard_enforces_a_process_wide_per_minute_limit(monkeypatch):
    monkeypatch.setenv("SIMULATE_LIMIT_PER_MIN", "2")
    guard = SimulationGuard()

    async def scenario():
        assert await guard.run(lambda: 1) == 1
        assert await guard.run(lambda: 2) == 2
        with pytest.raises(SimulationBusy):
            await guard.run(lambda: 3)

    asyncio.run(scenario())


def test_rest_simulate_returns_429_when_the_lab_is_busy(client, _fresh_simulation_guard):
    _fresh_simulation_guard._running = 1

    resp = client.post(
        "/tactics-lab/simulate", json={"home_formation": "4-3-3", "away_formation": "4-4-2", "n_matches": 1},
    )

    assert resp.status_code == 429


def test_mcp_simulate_is_bound_by_the_same_guard(_fresh_simulation_guard):
    _fresh_simulation_guard._running = 1

    result = asyncio.run(mcp_server.simulate_tactics_matchup("4-3-3", "4-4-2", 1))

    assert "error" in result
