import { useBase64Audio } from "../hooks/useBase64Audio";
import { useT } from "../i18n";

interface Props {
  audioBase64: string | null | undefined;
  autoPlay: boolean;
  label?: string;
  /** Render a disabled button (instead of nothing) when there's no audio. */
  showWhenEmpty?: boolean;
  className?: string;
}

export function VoiceButton({ audioBase64, autoPlay, label, showWhenEmpty = false, className }: Props) {
  const { t } = useT();
  const { isPlaying, blocked, play, pause, hasAudio } = useBase64Audio(audioBase64, autoPlay);
  const classes = `ui-btn lv-voice${isPlaying ? " is-playing" : ""}${blocked ? " is-blocked" : ""}${className ? ` ${className}` : ""}`;

  if (!hasAudio) {
    if (!showWhenEmpty) return null;
    return (
      <button type="button" className={classes} disabled title={t("live.voice.noAudio")}>
        <span aria-hidden="true">▶</span> {label ?? t("live.voice.listen")}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={isPlaying ? pause : play}
      aria-pressed={isPlaying}
      title={blocked ? t("live.voice.blocked") : isPlaying ? t("live.voice.pauseTitle") : t("live.voice.listenTitle")}
    >
      <span aria-hidden="true">{isPlaying ? "⏸" : "▶"}</span>
      {isPlaying ? t("live.voice.pause") : (label ?? t("live.voice.listen"))}
    </button>
  );
}
