import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

function toBlobUrl(base64: string): string {
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
}

/** Plays a narration clip: either a path on the API (`audio_url` of a live
 * message -- the mp3 is only fetched, and synthesized server-side, when it
 * plays) or an inline base64 mp3 (what-if / Ask the match answers).
 * Browsers block unprompted autoplay with sound, so the first attempt is
 * tried silently; if it's rejected (no prior user gesture on the page yet),
 * `blocked` flips true so the UI can offer a manual play button instead of
 * failing silently forever. A clip that can't load (expired, speech down)
 * reports no audio. */
export function useNarrationAudio(
  source: { url?: string | null; base64?: string | null },
  autoPlay: boolean,
) {
  const { url, base64 } = source;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => {
      setIsPlaying(false);
      setFailed(true);
    };
    return () => {
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const src = url ? `${API_BASE}${url}` : base64 ? toBlobUrl(base64) : null;
    if (!audio || !src) return;
    // Nothing is downloaded until it plays, so an unplayed line costs no speech call.
    audio.preload = autoPlay ? "auto" : "none";
    audio.src = src;
    setBlocked(false);
    setFailed(false);
    if (autoPlay) {
      audio.play().catch((err: DOMException) => {
        if (err.name === "NotAllowedError") setBlocked(true);
      });
    }
    return () => {
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, base64]);

  function play() {
    audioRef.current?.play().then(() => setBlocked(false)).catch((err: DOMException) => {
      if (err.name === "NotAllowedError") setBlocked(true);
    });
  }

  function pause() {
    audioRef.current?.pause();
  }

  return { isPlaying, blocked, play, pause, hasAudio: Boolean(url || base64) && !failed };
}
