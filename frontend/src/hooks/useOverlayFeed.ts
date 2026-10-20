import { useEffect, useRef, useState } from "react";
import { negotiate } from "../lib/api";
import type { OverlayEvent } from "../lib/types";

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

/** Connects directly to the Web PubSub hub (via a short-lived negotiated
 * URL from the backend) and keeps a rolling feed of everything the deployed
 * pipeline has pushed live -- render payloads from Broadcaster and
 * personalized recaps from Concierge, interleaved in arrival order. */
export function useOverlayFeed(maxEvents = 100) {
  const [events, setEvents] = useState<OverlayEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      try {
        const { url } = await negotiate();
        if (cancelled) return;
        const socket = new WebSocket(url);
        socketRef.current = socket;
        socket.onopen = () => setStatus("open");
        socket.onclose = () => setStatus("closed");
        socket.onerror = () => setStatus("error");
        socket.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data) as OverlayEvent;
            setEvents((prev) => [...prev.slice(-(maxEvents - 1)), parsed]);
          } catch {
            // ignore malformed pushes
          }
        };
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [maxEvents]);

  return { events, status };
}
