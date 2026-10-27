import { useNarrationAudio } from "../hooks/useNarrationAudio";
import { useT } from "../i18n";

interface Props {
  /** Live messages: path of the clip on the API, fetched only when it plays. */
  audioUrl?: string | null;
  /** HTTP answers (what-if, Ask the match): the mp3 inline. */
  audioBase64?: string | null;
  autoPlay: boolean;
  label?: string;
  /** Render a disabled button (instead of nothing) when there's no audio. */
  showWhenEmpty?: boolean;
  className?: string;
}

export function VoiceButton({ audioUrl, audioBase64, autoPlay, label, showWhenEmpty = false, className }: Props) {
  const { t } = useT();
  const { isPlaying, blocked, play, pause, hasAudio } = useNarrationAudio({ url: audioUrl, base64: audioBase64 }, autoPlay);
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
