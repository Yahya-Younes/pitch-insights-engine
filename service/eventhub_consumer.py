"""Background Event Hubs consumer -- the deployed Scout stage's real
ingestion path. Buffers raw event dicts per match_id as they arrive off the
hub and, once a `_stream_end` sentinel closes out a match, hands the whole
buffered feed to the same run_match() pipeline used by the on-demand REST
path. This is what makes ingestion genuinely event-driven rather than a
Python list passed in-process -- the windowed metrics in Analyst-0 need the
full match's events to compute rolling baselines, so buffering per match
before running the deterministic analysis is the correct granularity, not a
shortcut.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable

from azure.eventhub.aio import EventHubConsumerClient
from azure.identity.aio import DefaultAzureCredential

logger = logging.getLogger("pitch.eventhub_consumer")

OnMatchComplete = Callable[[str, list[dict], int], Awaitable[None]]


class MatchBuffer:
    def __init__(self) -> None:
        self.events: list[dict] = []
        self.duration_ms: int = 90 * 60000


class EventHubIngestConsumer:
    def __init__(self, fqdn: str, eventhub_name: str, consumer_group: str, on_match_complete: OnMatchComplete):
        self._fqdn = fqdn
        self._eventhub_name = eventhub_name
        self._consumer_group = consumer_group
        self._on_match_complete = on_match_complete
        self._buffers: dict[str, MatchBuffer] = {}
        self._credential: DefaultAzureCredential | None = None
        self._client: EventHubConsumerClient | None = None

    async def _on_event(self, partition_context, event) -> None:
        if event is None:
            return
        try:
            raw = json.loads(event.body_as_str())
        except Exception:
            logger.warning("dropping unparsable event on partition %s", partition_context.partition_id)
            await partition_context.update_checkpoint(event)
            return

        match_id = raw.get("match_id")
        if not match_id:
            await partition_context.update_checkpoint(event)
            return

        buffer = self._buffers.setdefault(match_id, MatchBuffer())
        if raw.get("type") != "_stream_end":
            buffer.events.append(raw)
            # Checkpointing is deferred to stream-end (below), not done per
            # event. Event Hubs checkpoints are a monotonic per-partition
            # offset -- checkpointing every event would mark them
            # unreplayable even if processing the match later crashes,
            # leaving a restart to reprocess that match_id against an empty
            # buffer. Deferring keeps the whole match replayable as a unit
            # until it's actually done.
            return

        buffer.duration_ms = raw.get("duration_ms", buffer.duration_ms)
        events, duration_ms = buffer.events, buffer.duration_ms
        try:
            await self._on_match_complete(match_id, events, duration_ms)
        except Exception:
            logger.exception(
                "match %s failed to process -- leaving its buffer and checkpoint in place so it replays from the start on restart",
                match_id,
            )
            return
        del self._buffers[match_id]
        await partition_context.update_checkpoint(event)

    async def run(self) -> None:
        self._credential = DefaultAzureCredential()
        self._client = EventHubConsumerClient(
            fully_qualified_namespace=self._fqdn,
            eventhub_name=self._eventhub_name,
            consumer_group=self._consumer_group,
            credential=self._credential,
        )
        async with self._client:
            await self._client.receive(on_event=self._on_event, starting_position="-1")

    async def stop(self) -> None:
        if self._client is not None:
            await self._client.close()
        if self._credential is not None:
            await self._credential.close()


def start_background(fqdn: str, eventhub_name: str, consumer_group: str, on_match_complete: OnMatchComplete) -> tuple[EventHubIngestConsumer, asyncio.Task]:
    consumer = EventHubIngestConsumer(fqdn, eventhub_name, consumer_group, on_match_complete)
    task = asyncio.create_task(consumer.run())
    return consumer, task
