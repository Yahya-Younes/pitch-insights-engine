"""Publishes one full synthetic match's events to Event Hubs at an
accelerated replay pace -- the genuine stage-(a) ingestion transport: the
deployed service's Scout stage consumes these exactly as they'd arrive off a
live feed, not as an in-memory list handed to it directly.

Usage: python -m datagen.streamer --match-id DEMO-1 --seed 7 --minutes 3
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time

from azure.eventhub import EventData
from azure.eventhub.aio import EventHubProducerClient
from azure.identity.aio import DefaultAzureCredential

from datagen.match_simulator import MatchSimulator

PERIOD_MS = 45 * 60 * 1000
BATCH_SIZE = 25


async def stream_match(match_id: str, seed: int, replay_seconds: float) -> None:
    fqdn = os.environ["EVENTHUB_FQDN"]
    eventhub_name = os.environ.get("EVENTHUB_NAME", "pitch-events")

    result = MatchSimulator(match_id, seed).generate_match()
    raw_events = [e.model_dump(mode="json") for e in result.events]
    duration_ms = 2 * PERIOD_MS

    credential = DefaultAzureCredential()
    producer = EventHubProducerClient(
        fully_qualified_namespace=fqdn, eventhub_name=eventhub_name, credential=credential,
    )

    delay = replay_seconds / max(1, len(raw_events) // BATCH_SIZE)
    async with producer:
        for i in range(0, len(raw_events), BATCH_SIZE):
            batch = await producer.create_batch()
            for raw in raw_events[i:i + BATCH_SIZE]:
                batch.add(EventData(json.dumps(raw)))
            await producer.send_batch(batch)
            print(f"sent events {i}..{i + len(batch)} of {len(raw_events)}")
            await asyncio.sleep(delay)

        sentinel = await producer.create_batch()
        sentinel.add(EventData(json.dumps({"type": "_stream_end", "match_id": match_id, "duration_ms": duration_ms})))
        await producer.send_batch(sentinel)
        print(f"match {match_id} fully streamed: {len(raw_events)} events")

    await credential.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--match-id", default=f"DEMO-{int(time.time())}")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--minutes", type=float, default=3.0, help="wall-clock minutes to compress the 90-minute match into")
    args = parser.parse_args()

    asyncio.run(stream_match(args.match_id, args.seed, args.minutes * 60))
