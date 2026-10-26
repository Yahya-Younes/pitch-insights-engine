"""Live output hook for the terminal stages (Broadcaster, Concierge).

Workflow outputs are otherwise only readable once the whole run finishes;
the hook lets the service publish each overlay / personalized line to
viewers the moment its stage yields it. A failing hook (e.g. Web PubSub
down) is logged and swallowed -- publishing must never break the pipeline.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

OutputHook = Callable[[Any], Awaitable[None]]


async def emit(hook: OutputHook | None, output: Any) -> None:
    if hook is None:
        return
    try:
        await hook(output)
    except Exception:
        logger.exception("live output hook failed; pipeline continues")
