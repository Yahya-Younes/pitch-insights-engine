"""Narration clips for the live feed, served over HTTP instead of riding in
the Web PubSub messages.

An mp3 is ~100 KB once base64-encoded, and Web PubSub bills every 2 KB of
every message to every connected viewer: with audio inline, one match cost
~2 MB per viewer and the Free tier's 20k-message daily quota ran out after a
few dozen match-views. Now a live message carries only `audio_url`
("/audio/<clip_id>"), and the clip is synthesized the first time someone
plays it, then cached. Nobody listening means no speech call at all.

Clip ids are a hash of (locale, text): the same narration is synthesized
once, and only text this service published can be fetched -- the endpoint is
not a free text-to-speech proxy. Everything lives in memory, which is enough
for the single-replica Container App; after a restart old clips 404 and the
player simply shows no audio.
"""
from __future__ import annotations

import asyncio
import hashlib
from collections import OrderedDict
from collections.abc import Callable

from agents.shared.speech_synthesizer import speech_configured, synthesize_mp3

Synthesize = Callable[[str, str], bytes | None]


class AudioClips:
    def __init__(
        self, synthesize: Synthesize = synthesize_mp3, enabled: Callable[[], bool] = speech_configured,
        max_texts: int = 5000, max_clips: int = 300,
    ):
        self._synthesize = synthesize
        self._enabled = enabled
        self._texts: OrderedDict[str, tuple[str, str]] = OrderedDict()
        self._clips: OrderedDict[str, bytes] = OrderedDict()
        self._pending: dict[str, asyncio.Task[bytes | None]] = {}
        self._max_texts = max_texts
        self._max_clips = max_clips

    def register(self, text: str, locale: str = "en") -> str | None:
        """The `audio_url` for this text, or None when speech isn't configured."""
        if not self._enabled() or not text.strip():
            return None
        clip_id = hashlib.sha256(f"{locale}\n{text}".encode()).hexdigest()[:32]
        self._texts[clip_id] = (text, locale)
        self._texts.move_to_end(clip_id)
        while len(self._texts) > self._max_texts:
            self._texts.popitem(last=False)
        return f"/audio/{clip_id}"

    def known(self, clip_id: str) -> bool:
        return clip_id in self._texts or clip_id in self._clips

    async def get(self, clip_id: str) -> bytes | None:
        """The mp3, synthesized on first request. Concurrent requests for the
        same clip share one synthesis call."""
        if clip_id in self._clips:
            self._clips.move_to_end(clip_id)
            return self._clips[clip_id]
        if clip_id not in self._texts:
            return None
        task = self._pending.get(clip_id)
        if task is None:
            text, locale = self._texts[clip_id]
            task = asyncio.create_task(asyncio.to_thread(self._synthesize, text, locale))
            self._pending[clip_id] = task
        # shield: a viewer closing the tab must not cancel the synthesis others wait on.
        audio = await asyncio.shield(task)
        self._pending.pop(clip_id, None)
        if audio:
            self._clips[clip_id] = audio
            while len(self._clips) > self._max_clips:
                self._clips.popitem(last=False)
        return audio
