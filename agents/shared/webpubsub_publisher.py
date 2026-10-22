"""Thin publisher wrapping Azure Web PubSub -- pushes every Broadcaster
RenderPayload and every Concierge personalized text live to the hub so the
frontend overlay updates as the match plays, instead of polling.
"""
from __future__ import annotations

from azure.identity import DefaultAzureCredential
from azure.messaging.webpubsubservice import WebPubSubServiceClient

from agents.shared.models import RenderPayload


class WebPubSubPublisher:
    def __init__(self, endpoint: str, hub: str = "pitch_overlay"):
        self._client = WebPubSubServiceClient(
            endpoint=endpoint, hub=hub, credential=DefaultAzureCredential(),
        )

    def publish_render(self, payload: RenderPayload) -> None:
        # Pass the dict itself (not a pre-serialized string) -- with
        # content_type="application/json" the SDK does the JSON encoding;
        # handing it an already-serialized string here double-encodes it
        # into a quoted/escaped JSON string, which breaks JSON.parse() on
        # the receiving end (it comes back a string, not an object).
        self._client.send_to_all(
            message={"kind": "render", "data": payload.model_dump(mode="json")},
            content_type="application/json",
        )

    def publish_personalized(
        self, match_id: str, persona: str, text: str, audio_base64: str | None = None,
    ) -> None:
        self._client.send_to_all(
            message={"kind": "personalized", "data": {
                "match_id": match_id, "persona": persona, "text": text, "audio_base64": audio_base64,
            }},
            content_type="application/json",
        )

    def client_access_url(self) -> str:
        """A short-lived URL the frontend connects to directly over WebSocket
        to receive live pushes -- avoids ever handing the frontend a Web
        PubSub key or AAD token of its own."""
        return self._client.get_client_access_token()["url"]
