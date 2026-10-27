"""Thin wrapper around the Azure AI Speech REST text-to-speech endpoint --
turns the Narrator's already-grounded broadcast text (and, per-locale, the
Concierge's personalized text) into an audio clip so the live overlay can be
heard, not just read.

Deliberately synchronous + a plain REST call (no SDK) so it can run via
asyncio.to_thread exactly like the other blocking Azure clients in this
codebase (Cosmos, Web PubSub) -- no new async machinery needed.

Key-based auth, not DefaultAzureCredential: the Container App's managed
identity would need a "Cognitive Services Speech User" role assignment to
use AAD auth here, and granting IAM roles isn't something this assistant
does on its own. A resource key (the standard, fully-supported way to call
this API) avoids that entirely.

Failures never raise -- synthesize_base64() returns None and the caller
simply ships a silent card. A missing/broken voice should never take down
match processing.
"""
from __future__ import annotations

import html
import logging
import os
import urllib.error
import urllib.request
from base64 import b64encode

logger = logging.getLogger("pitch.speech")

_VOICE_BY_LOCALE: dict[str, str] = {
    "en": "en-US-AndrewMultilingualNeural",
    "fr": "fr-FR-VivienneMultilingualNeural",
    "es": "es-ES-XimenaNeural",
    "de": "de-DE-FlorianMultilingualNeural",
    "it": "it-IT-IsabellaMultilingualNeural",
    "pt": "pt-PT-RaquelNeural",
}


def voice_for_locale(locale: str) -> str:
    return _VOICE_BY_LOCALE.get(locale, _VOICE_BY_LOCALE["en"])


def _ssml(text: str, voice: str) -> str:
    lang = voice[:5]
    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{lang}">'
        f'<voice name="{voice}">{html.escape(text)}</voice></speak>'
    )


def speech_configured() -> bool:
    return bool(os.environ.get("AZURE_SPEECH_KEY") and os.environ.get("AZURE_SPEECH_REGION"))


def synthesize_base64(text: str, locale: str = "en") -> str | None:
    audio = synthesize_mp3(text, locale)
    return b64encode(audio).decode("ascii") if audio else None


def synthesize_mp3(text: str, locale: str = "en") -> bytes | None:
    key = os.environ.get("AZURE_SPEECH_KEY")
    region = os.environ.get("AZURE_SPEECH_REGION")
    if not key or not region or not text.strip():
        return None

    voice = voice_for_locale(locale)
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    req = urllib.request.Request(
        url, method="POST", data=_ssml(text, voice).encode("utf-8"),
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "pitch-insights-engine",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            audio = resp.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        logger.warning("speech synthesis failed for locale=%s: %s", locale, exc)
        return None
    return audio or None
