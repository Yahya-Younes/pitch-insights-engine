import { useBase64Audio } from "../hooks/useBase64Audio";

interface Props {
  audioBase64: string | null | undefined;
  autoPlay: boolean;
  label?: string;
}

export function VoiceButton({ audioBase64, autoPlay, label }: Props) {
  const { isPlaying, blocked, play, pause, hasAudio } = useBase64Audio(audioBase64, autoPlay);
  if (!hasAudio) return null;

  return (
    <button
      className={`voice-button${isPlaying ? " voice-button-playing" : ""}${blocked ? " voice-button-blocked" : ""}`}
      onClick={isPlaying ? pause : play}
      title={blocked ? "Click to play -- browser blocked autoplay" : isPlaying ? "Pause narration" : "Play narration"}
    >
      <span className="voice-button-icon">{isPlaying ? "⏸" : "🔊"}</span>
      {label ?? (blocked ? "Play voice" : isPlaying ? "Playing" : "Voice")}
    </button>
  );
}
