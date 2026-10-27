import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { shirtNumber, shortName, useMatch } from "../lib/matchContext";
import type { Persona, RenderPayload } from "../lib/types";
import { themeFor } from "../lib/triggerTheme";
import {
  clockMinute, clockToMs, isKeyMoment, payloadTeam, prefersReducedMotion, splitHeadline, triggerLabel,
  useLiveRoster,
} from "../lib/momentumApi";
import { HeroStage } from "../components/HeroStage";
import type { HeroLinkedPlayer } from "../components/HeroStage";
import { Timeline } from "../components/Timeline";
import { PitchView } from "../components/PitchView";
import type { SeekRequest } from "../components/PitchView";
import { LineupChips } from "../components/LineupChips";
import { LiveWarmup } from "../components/LiveWarmup";
import { MomentumBar } from "../components/MomentumBar";
import { WinProbability } from "../components/WinProbability";
import { PersonaTabs } from "../components/PersonaTabs";
import { PersonaFeed } from "../components/PersonaFeed";
import { AskTheMatch } from "../components/AskTheMatch";
import { useT } from "../i18n";
import "./LiveTab.css";

const PERSONAS: readonly Persona[] = ["casual_fan", "analyst", "player_tracker"];

function isPersona(value: string): value is Persona {
  return (PERSONAS as readonly string[]).includes(value);
}

function shortText(text: string, max = 96): string {
  const { headline } = splitHeadline(text);
  return headline.length > max ? `${headline.slice(0, max - 1).trimEnd()}…` : headline;
}

export function LiveTab() {
  const {
    matchId, homeTeam, awayTeam, renderEvents, personalizedEvents, followedPlayerId, setFollowedPlayerId, openPlayer,
  } = useMatch();
  const i18n = useT();
  const { t } = i18n;
  const roster = useLiveRoster(matchId);
  // Selection is tagged with its match so a new match falls back to live
  // mode without a reset effect.
  const [selection, setSelection] = useState<{ matchId: string | null; id: string | null; followLive: boolean }>(
    { matchId: null, id: null, followLive: true },
  );
  const [seek, setSeek] = useState<SeekRequest | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [showAllMoments, setShowAllMoments] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const momentsTitleId = useId();
  const commentTitleId = useId();

  const latest = renderEvents[renderEvents.length - 1] ?? null;
  const sameMatch = selection.matchId === matchId;
  const followLive = !sameMatch || selection.followLive;

  // Esc stops following (unless a modal, e.g. the player drawer, handles it).
  useEffect(() => {
    if (!followedPlayerId) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      setFollowedPlayerId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [followedPlayerId, setFollowedPlayerId]);

  const selected = (followLive ? null : renderEvents.find((p) => p.render_id === selection.id)) ?? latest;
  const selectedIndex = selected ? renderEvents.findIndex((p) => p.render_id === selected.render_id) : -1;
  const newerCount = selectedIndex >= 0 ? renderEvents.length - selectedIndex - 1 : 0;
  const isBehindLive = !followLive && newerCount > 0;

  function selectManually(renderId: string) {
    setSelection({ matchId, id: renderId, followLive: renderId === latest?.render_id });
  }

  function jumpToLive() {
    setSelection({ matchId, id: null, followLive: true });
  }

  function selectMoment(p: RenderPayload) {
    selectManually(p.render_id);
    setSeek((prev) => ({ ms: clockToMs(p.game_clock), nonce: (prev?.nonce ?? 0) + 1 }));
    heroRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
  }

  function toggleFollow(pid: string) {
    setFollowedPlayerId(followedPlayerId === pid ? null : pid);
  }

  const playerName = (pid: string) => roster.byId.get(pid)?.name ?? t("live.player.fallback", { num: shirtNumber(pid) });
  const playerLabel = (pid: string) => `#${shirtNumber(pid)} ${shortName(playerName(pid))}`;
  const followedLabel = followedPlayerId ? playerLabel(followedPlayerId) : null;
  const followedFullName = followedPlayerId ? playerName(followedPlayerId) : null;

  const linkedPlayers: HeroLinkedPlayer[] = (selected?.linked_players ?? []).map((pid) => ({
    playerId: pid,
    label: playerLabel(pid),
    team: pid.startsWith("away") ? "away" : "home",
  }));

  const moments = useMemo(() => {
    const list = showAllMoments ? renderEvents : renderEvents.filter(isKeyMoment);
    return [...list].reverse();
  }, [renderEvents, showAllMoments]);

  const personaCounts = useMemo(() => {
    const counts: Partial<Record<Persona, number>> = {};
    for (const m of personalizedEvents) {
      if (isPersona(m.persona)) counts[m.persona] = (counts[m.persona] ?? 0) + 1;
    }
    return counts;
  }, [personalizedEvents]);
  const latestPersona = personalizedEvents[personalizedEvents.length - 1]?.persona;
  const effectivePersona: Persona = persona ?? (latestPersona && isPersona(latestPersona) ? latestPersona : "casual_fan");
  const personaMessages = useMemo(
    () => personalizedEvents.filter((m) => m.persona === effectivePersona),
    [personalizedEvents, effectivePersona],
  );

  if (!matchId) {
    return (
      <div className="lv-root">
        <div className="ui-card lv-empty lv-empty-hero">
          <span className="lv-empty-icon" aria-hidden="true">⚽</span>
          <p>{t("live.tab.empty")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lv-root">
      <div className="lv-main">
        <div ref={heroRef} className="lv-hero-wrap">
          {selected ? (
            <>
              <HeroStage
                payload={selected}
                homeTeam={homeTeam}
                awayTeam={awayTeam}
                autoPlayAudio={followLive}
                linkedPlayers={linkedPlayers}
                followedPlayerId={followedPlayerId}
                onFollowPlayer={toggleFollow}
              />
              <div className="lv-hero-nav">
                <Timeline payloads={renderEvents} selectedId={selected.render_id} onSelect={selectManually} />
                {isBehindLive ? (
                  <button type="button" className="ui-btn ui-btn-primary lv-jump-live" onClick={jumpToLive}>
                    <span className="lv-live-dot" aria-hidden="true" />{" "}
                    {t(newerCount > 1 ? "live.tab.backToLiveMany" : "live.tab.backToLiveOne", { count: i18n.num(newerCount) })}
                  </button>
                ) : (
                  <span className="ui-pill is-danger lv-live-badge"><span className="lv-live-dot" aria-hidden="true" /> {t("live.tab.onAir")}</span>
                )}
              </div>
            </>
          ) : (
            <LiveWarmup key={matchId} matchId={matchId} />
          )}
        </div>

        <PitchView
          matchId={matchId}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          roster={roster.byId}
          followedPlayerId={followedPlayerId}
          onToggleFollow={toggleFollow}
          onOpenPlayer={openPlayer}
          seek={seek}
        >
          <LineupChips
            players={roster.players}
            status={roster.status}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            followedPlayerId={followedPlayerId}
            onToggleFollow={toggleFollow}
          />
          {followedPlayerId && followedLabel && (
            <div className={`lv-follow-bar is-${followedPlayerId.startsWith("away") ? "away" : "home"}`} role="status">
              <span>👁 {t("live.follow.prefix")} <strong>{followedLabel}</strong> — {t("live.follow.escHint")}</span>
              <span className="lv-follow-actions">
                <button type="button" className="ui-btn lv-btn-sm" onClick={() => openPlayer(followedPlayerId)}>{t("live.follow.sheet")}</button>
                <button type="button" className="ui-btn lv-btn-sm" onClick={() => setFollowedPlayerId(null)}>{t("live.follow.quit")}</button>
              </span>
            </div>
          )}
        </PitchView>

        <MomentumBar matchId={matchId} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>

      <aside className="lv-side" aria-label={t("live.tab.sideAria")}>
        <WinProbability matchId={matchId} homeTeam={homeTeam} awayTeam={awayTeam} />

        <section className="ui-card lv-moments" aria-labelledby={momentsTitleId}>
          <div className="lv-card-head">
            <h2 id={momentsTitleId} className="ui-heading">{t("live.moments.title")}</h2>
            <button
              type="button"
              className={`ui-pill${showAllMoments ? " is-solid is-gold" : ""}`}
              aria-pressed={showAllMoments}
              onClick={() => setShowAllMoments((v) => !v)}
            >
              {t("live.moments.all")}
            </button>
          </div>
          {moments.length === 0 ? (
            <p className="lv-muted">
              {renderEvents.length === 0
                ? t("live.moments.emptyNone")
                : t("live.moments.emptyKey")}
            </p>
          ) : (
            <ul className="lv-moment-list">
              {moments.map((p) => {
                const side = payloadTeam(p.data_points);
                const theme = themeFor(p.graphic_type);
                const current = p.render_id === selected?.render_id;
                return (
                  <li key={p.render_id}>
                    <button
                      type="button"
                      className={`lv-moment${current ? " is-current" : ""}`}
                      aria-current={current ? "true" : undefined}
                      onClick={() => selectMoment(p)}
                      style={{ "--lv-trigger": theme.color } as CSSProperties}
                    >
                      <span className={`lv-moment-min${side ? ` is-${side}` : ""}`}>{clockMinute(p.game_clock)}'</span>
                      <span className="lv-moment-icon" aria-hidden="true">{theme.icon}</span>
                      <span className="lv-moment-text">
                        <span className="lv-moment-kind">{triggerLabel(i18n, p.graphic_type)}</span>
                        {shortText(p.narrative_text)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="ui-card lv-comment" aria-labelledby={commentTitleId}>
          <div className="lv-card-head">
            <h2 id={commentTitleId} className="ui-heading">{t("live.comment.title")}</h2>
          </div>
          <PersonaTabs value={effectivePersona} onChange={setPersona} counts={personaCounts} />
          {followedLabel && (
            <div className="lv-focus-row">
              <span className="ui-pill is-home is-solid">{t("live.comment.focus", { name: followedLabel })}</span>
              <button
                type="button"
                className="lv-link-btn"
                onClick={() => setFollowedPlayerId(null)}
                aria-label={t("live.comment.removeFocus")}
              >
                ✕
              </button>
            </div>
          )}
          <div className="lv-comment-feed">
            <PersonaFeed
              messages={personaMessages}
              focusTerm={followedFullName}
              autoPlayLatest={false}
              emptyText={
                personalizedEvents.length === 0
                  ? t("live.comment.emptyNone")
                  : t("live.comment.emptyPersona")
              }
            />
          </div>
          <AskTheMatch matchId={matchId} focusPlayerName={followedFullName} embedded />
        </section>
      </aside>
    </div>
  );
}
