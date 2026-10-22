import { useEffect, useRef, useState } from "react";

function toBlobUrl(base64: string): string {
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
}

/** Plays a base64 mp3 clip as it arrives. Browsers block unprompted
 * autoplay with sound, so the first attempt is tried silently; if it's
 * rejected (no prior user gesture on the page yet), `blocked` flips true so
 * the UI can offer a manual play button instead of failing silently forever. */
export function useBase64Audio(base64: string | null | undefined, autoPlay: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => setIsPlaying(false);
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    if (!base64 || !audioRef.current) return;
    const url = toBlobUrl(base64);
    const audio = audioRef.current;
    audio.src = url;
    setBlocked(false);
    if (autoPlay) {
      audio.play().catch(() => setBlocked(true));
    }
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base64]);

  function play() {
    audioRef.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  }

  function pause() {
    audioRef.current?.pause();
  }

  return { isPlaying, blocked, play, pause, hasAudio: Boolean(base64) };
}
