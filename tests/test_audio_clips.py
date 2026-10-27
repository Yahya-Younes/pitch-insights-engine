"""Live narration audio is served over HTTP, never inside the Web PubSub
messages (service/audio_clips.py)."""
from __future__ import annotations

import asyncio
import json
import threading

import service.main as main_module
from datagen.match_simulator import MatchSimulator
from service.audio_clips import AudioClips

MP3 = b"ID3fake-mp3-bytes"


class _CountingSynth:
    def __init__(self, audio: bytes | None = MP3):
        self.calls: list[tuple[str, str]] = []
        self._audio = audio
        self._lock = threading.Lock()

    def __call__(self, text: str, locale: str) -> bytes | None:
        with self._lock:
            self.calls.append((text, locale))
        return self._audio


def _clips(synth=None, **kw) -> AudioClips:
    return AudioClips(synthesize=synth or _CountingSynth(), enabled=lambda: True, **kw)


def test_no_url_when_speech_is_not_configured():
    assert AudioClips(synthesize=_CountingSynth(), enabled=lambda: False).register("Goal!") is None
    assert _clips().register("   ") is None


def test_same_text_same_url_and_locale_matters():
    clips = _clips()
    url = clips.register("Goal!", "en")
    assert url.startswith("/audio/")
    assert clips.register("Goal!", "en") == url
    assert clips.register("Goal!", "fr") != url


def test_audio_is_synthesized_once_on_first_request_then_cached():
    synth = _CountingSynth()
    clips = _clips(synth)
    clip_id = clips.register("Goal!", "fr").rsplit("/", 1)[1]
    assert synth.calls == []  # nothing until someone plays it

    async def three_listeners():
        return await asyncio.gather(*(clips.get(clip_id) for _ in range(3)))

    assert asyncio.run(three_listeners()) == [MP3, MP3, MP3]
    assert asyncio.run(clips.get(clip_id)) == MP3
    assert synth.calls == [("Goal!", "fr")]


def test_unknown_clip_is_not_synthesized():
    synth = _CountingSynth()
    clips = _clips(synth)
    assert not clips.known("0" * 32)
    assert asyncio.run(clips.get("0" * 32)) is None
    assert synth.calls == []


def test_old_texts_are_forgotten_beyond_the_cap():
    clips = _clips(max_texts=2)
    first = clips.register("one").rsplit("/", 1)[1]
    clips.register("two")
    clips.register("three")
    assert not clips.known(first)


def test_audio_endpoint(client, STATE):
    STATE["audio_clips"] = _clips()
    url = STATE["audio_clips"].register("Goal!", "en")

    resp = client.get(url)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/mpeg"
    assert resp.content == MP3
    assert "immutable" in resp.headers["cache-control"]

    assert client.get("/audio/" + "0" * 32).status_code == 404


def test_audio_endpoint_503_when_synthesis_fails(client, STATE):
    STATE["audio_clips"] = _clips(_CountingSynth(audio=None))
    url = STATE["audio_clips"].register("Goal!", "en")
    assert client.get(url).status_code == 503


def test_live_messages_carry_an_audio_url_not_the_audio(client, STATE):
    class RecordingPublisher:
        def __init__(self):
            self.renders, self.personalized = [], []

        def publish_render(self, payload):
            self.renders.append(payload)

        def publish_personalized(self, match_id, persona, text, audio_url):
            self.personalized.append((text, audio_url))

    synth = _CountingSynth()
    STATE["audio_clips"] = _clips(synth)
    STATE["publisher"] = publisher = RecordingPublisher()
    events = [e.model_dump(mode="json") for e in MatchSimulator("M-AUDIO", seed=3).generate_match().events]

    asyncio.run(main_module._run_and_publish(
        events, "M-AUDIO", 90 * 60000, persona="casual_fan", lens_id=None, player_names={}, locale="fr",
    ))

    assert publisher.renders and publisher.personalized
    for payload in publisher.renders:
        assert payload.audio_url.startswith("/audio/")
        assert len(json.dumps(payload.model_dump(mode="json"))) < 4000  # a few KB, not ~100 KB of mp3
    for text, audio_url in publisher.personalized:
        assert audio_url == STATE["audio_clips"].register(text, "fr")
    assert synth.calls == []  # nobody played anything yet
