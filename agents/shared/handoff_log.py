"""Pluggable orchestration trace shared across every stage's executor.

An in-memory implementation is used for local dev/testing now; a
Cosmos-backed implementation can be swapped in later behind the exact same
Protocol, without touching any executor code -- this is what the plan calls
"shared state in Cosmos DB ... giving a concrete, demoable orchestration
trace," kept Azure-independent for now so the orchestration graph itself is
testable offline.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class HandoffEntry:
    stage: str
    match_id: str
    summary: dict[str, Any]
    timestamp: float = field(default_factory=time.time)


class HandoffLog(Protocol):
    def record(self, stage: str, match_id: str, summary: dict[str, Any]) -> None: ...
    def entries(self) -> list[HandoffEntry]: ...


class InMemoryHandoffLog:
    def __init__(self) -> None:
        self._entries: list[HandoffEntry] = []

    def record(self, stage: str, match_id: str, summary: dict[str, Any]) -> None:
        self._entries.append(HandoffEntry(stage=stage, match_id=match_id, summary=summary))

    def entries(self) -> list[HandoffEntry]:
        return list(self._entries)
