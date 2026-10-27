"""Shared, module-level app state and its lazy-factory builders.

Imported by both service/main.py (the FastAPI app) and service/mcp_server.py
(the MCP server mounted alongside it on the same Container App) so they
operate on the exact same live handoff log / publisher / lenses /
checkpoint storage -- populated once by main.py's lifespan -- rather than
each building its own, divergent copy.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import time
from collections import deque

STATE: dict = {}

# Every per-match entry kept in memory for matches run via POST /matches/run,
# including the caches built from them (which hold the same event/position
# lists by reference, so they must go too or nothing is actually freed).
PER_MATCH_KEYS = (
    "match_status", "events_by_match", "positions_by_match", "tactics_by_match",
    "duration_ms_by_match", "player_names_by_match", "player_roles_by_match",
    "player_tags_by_match", "player_ratings_by_match", "live_ratings_by_match",
)
# Keyed by (match_id, *params) rather than by match_id alone.
PLAYER_GRAPH_CACHE_KEY = "player_graph_cache"
_MATCH_ORDER_KEY = "match_order"


def max_matches_in_memory() -> int:
    return max(1, int(os.environ.get("MAX_MATCHES_IN_MEMORY", "20")))


def register_match(state: dict, match_id: str) -> list[str]:
    """Records match_id as the newest in-memory match and drops every
    per-match entry of the oldest ones beyond MAX_MATCHES_IN_MEMORY.

    Without this nothing was ever removed: a full 90-minute match is
    ~190 MB resident, on a single 2 GiB replica. Returns the evicted ids."""
    order: dict = state.setdefault(_MATCH_ORDER_KEY, {})
    order.pop(match_id, None)
    order[match_id] = None

    evicted = []
    while len(order) > max_matches_in_memory():
        oldest = next(iter(order))
        del order[oldest]
        evicted.append(oldest)

    for old in evicted:
        for key in PER_MATCH_KEYS:
            state.get(key, {}).pop(old, None)
        graph_cache = state.get(PLAYER_GRAPH_CACHE_KEY, {})
        for cache_key in [k for k in graph_cache if k[0] == old]:
            del graph_cache[cache_key]
    return evicted


class SimulationBusy(Exception):
    """Raised instead of queueing when the Tactics Lab is already at capacity."""


class SimulationGuard:
    """Process-wide cap on Tactics Lab Monte-Carlo runs, shared by the REST
    endpoint and the MCP tool. A 200-match run is ~25 s of pure CPU on a
    1-vCPU replica, so per-IP rate limits alone (and the MCP tool had none)
    let a handful of callers starve the whole app. Over capacity is
    rejected straight away rather than queued, so waiting callers can't
    pile up either."""

    def __init__(self) -> None:
        self._running = 0
        self._calls: deque[float] = deque()

    @staticmethod
    def max_concurrent() -> int:
        return max(1, int(os.environ.get("SIMULATE_MAX_CONCURRENT", "1")))

    @staticmethod
    def limit_per_min() -> int:
        return max(1, int(os.environ.get("SIMULATE_LIMIT_PER_MIN", "20")))

    async def run(self, fn, *args, **kwargs):
        now = time.monotonic()
        while self._calls and now - self._calls[0] > 60:
            self._calls.popleft()
        if self._running >= self.max_concurrent():
            raise SimulationBusy("a Tactics Lab simulation is already running -- try again in a few seconds")
        if len(self._calls) >= self.limit_per_min():
            raise SimulationBusy("Tactics Lab rate limit exceeded -- try again in a minute")
        self._calls.append(now)
        self._running += 1
        try:
            # The worker thread can't be cancelled, so the slot is only
            # released once it has actually finished.
            return await asyncio.to_thread(fn, *args, **kwargs)
        finally:
            self._running -= 1


SIMULATION_GUARD = SimulationGuard()


def build_handoff_log():
    endpoint = os.environ.get("COSMOS_ENDPOINT")
    if not endpoint:
        from agents.shared.handoff_log import InMemoryHandoffLog
        return InMemoryHandoffLog()
    from agents.shared.cosmos_handoff_log import CosmosHandoffLog
    return CosmosHandoffLog(endpoint)


def build_publisher():
    endpoint = os.environ.get("WEBPUBSUB_ENDPOINT")
    if not endpoint:
        return None
    from agents.shared.webpubsub_publisher import WebPubSubPublisher
    return WebPubSubPublisher(endpoint, hub=os.environ.get("WEBPUBSUB_HUB", "pitch_overlay"))


def build_checkpoint_storage():
    # File-based, not Cosmos-backed -- an accepted, documented limitation
    # for this round: it survives an in-process crash-and-resume demo
    # within one running replica, not a full container restart. A single
    # shared instance is reused across runs so every match's checkpoints
    # land in the same store and stay resumable for the life of the
    # replica.
    #
    # FileCheckpointStorage pickles workflow state and, by design, refuses
    # to deserialize any type not explicitly allow-listed (a safety feature
    # against deserializing arbitrary pickled data) -- without this list
    # every checkpoint save silently fails (logged, not raised) and
    # get_last_checkpoint_id() never has anything to return, which is
    # exactly the failure mode the crash-resume demo exists to avoid
    # becoming invisible again.
    from agent_framework import FileCheckpointStorage

    from agents.orchestrator.workflow import CHECKPOINT_ALLOWED_TYPES
    path = os.environ.get("CHECKPOINT_DIR", os.path.join(tempfile.gettempdir(), "pitch-checkpoints"))
    return FileCheckpointStorage(path, allowed_checkpoint_types=CHECKPOINT_ALLOWED_TYPES)
