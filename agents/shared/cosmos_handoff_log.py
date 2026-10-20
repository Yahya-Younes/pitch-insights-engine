"""Cosmos-backed HandoffLog -- the deployed counterpart to InMemoryHandoffLog,
behind the exact same Protocol so no executor code changes when swapping one
for the other. Uses AAD auth (DefaultAzureCredential) so the deployed
Container App authenticates via its managed identity, and a developer's own
`az login` session works the same way locally -- no Cosmos key ever handled.
"""
from __future__ import annotations

import asyncio
import logging
import time
from uuid import uuid4

from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential

from agents.shared.handoff_log import HandoffEntry

logger = logging.getLogger("pitch.cosmos_handoff_log")


class CosmosHandoffLog:
    def __init__(self, endpoint: str, database: str = "pitch", container: str = "handoff_log"):
        client = CosmosClient(endpoint, credential=DefaultAzureCredential())
        self._container = client.get_database_client(database).get_container_client(container)

    def record(self, stage: str, match_id: str, summary: dict) -> None:
        """Writes the entry on a worker thread rather than inline: the
        underlying azure-cosmos client is synchronous, and every stage's
        executor calls record() directly from its async handler without
        awaiting it -- an inline call would block the whole single-threaded
        event loop (and therefore every other insight's concurrent
        processing) for as long as this one write takes, including any SDK
        retry/backoff under throttling."""
        entry = HandoffEntry(stage=stage, match_id=match_id, summary=summary)
        item = {
            "id": uuid4().hex,
            "match_id": entry.match_id,
            "stage": entry.stage,
            "summary": entry.summary,
            "timestamp": entry.timestamp,
        }

        def _write() -> None:
            try:
                self._container.create_item(item)
            except Exception:
                logger.exception("failed to persist handoff entry: match=%s stage=%s", match_id, stage)

        try:
            asyncio.get_running_loop().run_in_executor(None, _write)
        except RuntimeError:
            _write()

    def entries(self, match_id: str | None = None) -> list[HandoffEntry]:
        if match_id is not None:
            query = "SELECT * FROM c WHERE c.match_id = @match_id ORDER BY c.timestamp"
            params = [{"name": "@match_id", "value": match_id}]
            items = self._container.query_items(query=query, parameters=params, partition_key=match_id)
        else:
            query = "SELECT * FROM c ORDER BY c.timestamp"
            items = self._container.query_items(query=query, enable_cross_partition_query=True)
        return [
            HandoffEntry(stage=i["stage"], match_id=i["match_id"], summary=i["summary"], timestamp=i["timestamp"])
            for i in items
        ]
