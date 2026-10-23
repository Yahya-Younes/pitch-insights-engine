"""Regression tests for the Event Hubs consumer's checkpointing fix. The
original code checkpointed every event immediately -- including a match's
events before it was actually confirmed processed -- so a crash mid-match
left the buffer wiped and the offset already past those events, meaning a
restart would reprocess the match_id against an empty buffer. These tests
pin the corrected behaviour: checkpoint once, only after _on_match_complete
succeeds for the match's _stream_end event.
"""
import asyncio
import json

from service.eventhub_consumer import EventHubIngestConsumer


class _FakeEvent:
    def __init__(self, body: dict):
        self._body = json.dumps(body)

    def body_as_str(self) -> str:
        return self._body


class _FakePartitionContext:
    def __init__(self):
        self.partition_id = "0"
        self.checkpoints: list = []

    async def update_checkpoint(self, event) -> None:
        self.checkpoints.append(event)


def test_intermediate_events_are_not_checkpointed_individually():
    async def _never_called(match_id, events, duration_ms):
        raise AssertionError("on_match_complete should not run for a non-stream_end event")

    consumer = EventHubIngestConsumer("fqdn", "eh", "$Default", _never_called)
    ctx = _FakePartitionContext()
    asyncio.run(consumer._on_event(ctx, _FakeEvent({"match_id": "M1", "type": "shot"})))

    assert ctx.checkpoints == [], "intermediate events must not advance the checkpoint on their own"
    assert len(consumer._buffers["M1"].events) == 1


def test_match_complete_failure_does_not_checkpoint_or_lose_the_buffer():
    async def _always_fails(match_id, events, duration_ms):
        raise RuntimeError("simulated downstream failure")

    consumer = EventHubIngestConsumer("fqdn", "eh", "$Default", _always_fails)
    ctx = _FakePartitionContext()
    asyncio.run(consumer._on_event(ctx, _FakeEvent({"match_id": "M2", "type": "shot"})))
    asyncio.run(consumer._on_event(ctx, _FakeEvent({"match_id": "M2", "type": "_stream_end", "duration_ms": 1000})))

    assert ctx.checkpoints == [], "a failed match must not advance the checkpoint -- it should replay from the start"
    assert "M2" in consumer._buffers, "the buffer must survive a processing failure, not be deleted"
    assert len(consumer._buffers["M2"].events) == 1


def test_match_complete_success_checkpoints_once_and_clears_the_buffer():
    received: dict = {}

    async def _record(match_id, events, duration_ms):
        received["match_id"] = match_id
        received["events"] = events
        received["duration_ms"] = duration_ms

    consumer = EventHubIngestConsumer("fqdn", "eh", "$Default", _record)
    ctx = _FakePartitionContext()
    asyncio.run(consumer._on_event(ctx, _FakeEvent({"match_id": "M3", "type": "shot"})))
    assert ctx.checkpoints == []

    stream_end_event = _FakeEvent({"match_id": "M3", "type": "_stream_end", "duration_ms": 5400000})
    asyncio.run(consumer._on_event(ctx, stream_end_event))

    assert ctx.checkpoints == [stream_end_event], "checkpoint exactly once, only after success"
    assert "M3" not in consumer._buffers
    assert received["match_id"] == "M3"
    assert len(received["events"]) == 1
    assert received["duration_ms"] == 5400000
