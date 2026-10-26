import { useBase64Audio } from "../hooks/useBase64Audio";

interface Props {
  audioBase64: string | null | undefined;
  autoPlay: boolean;
  label?: string;
  /** Render a disabled button (instead of nothing) when there's no audio. */
  showWhenEmpty?: boolean;
  className?: string;
}

export function VoiceButton({ audioBase64, autoPlay, label, showWhenEmpty = false, className }: Props) {
  const { isPlaying, blocked, play, pause, hasAudio } = useBase64Audio(audioBase64, autoPlay);
  const classes = `ui-btn lv-voice${isPlaying ? " is-playing" : ""}${blocked ? " is-blocked" : ""}${className ? ` ${className}` : ""}`;

  if (!hasAudio) {
    if (!showWhenEmpty) return null;
    return (
      <button type="button" className={classes} disabled title="Pas de narration audio pour cet insight">
        <span aria-hidden="true">▶</span> {label ?? "Écouter"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={isPlaying ? pause : play}
      aria-pressed={isPlaying}
      title={blocked ? "Clique pour lancer — le navigateur a bloqué la lecture automatique" : isPlaying ? "Mettre en pause" : "Écouter la narration"}
    >
      <span aria-hidden="true">{isPlaying ? "⏸" : "▶"}</span>
      {isPlaying ? "Pause" : (label ?? "Écouter")}
    </button>
  );
}
