"""Shared, module-level app state and its lazy-factory builders.

Imported by both service/main.py (the FastAPI app) and service/mcp_server.py
(the MCP server mounted alongside it on the same Container App) so they
operate on the exact same live handoff log / publisher / lenses /
checkpoint storage -- populated once by main.py's lifespan -- rather than
each building its own, divergent copy.
"""
from __future__ import annotations

import os
import tempfile

STATE: dict = {}


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
