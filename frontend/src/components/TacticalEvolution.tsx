import { useEffect, useState } from "react";
import { fetchTactics } from "../lib/api";
import { useT } from "../i18n";
import type { MatchTacticsResponse, TacticalTimelineResponse } from "../lib/types";
import { describeZone } from "../lib/zoneLabels";

interface Props {
  matchId: string | null;
  homeTeam: string;
  awayTeam: string;
}

function TeamTimeline({ timeline, teamName }: { timeline: TacticalTimelineResponse; teamName: string }) {
  const i18n = useT();
  const { t } = i18n;
  const lastLabeled = [...timeline.windows].reverse().find((w) => w.label);

  return (
    <div className="tactics-team">
      <div className="tactics-team-header">
        <span className="tactics-team-name">{teamName}</span>
        <span className="tactics-formation-badge">{t("panels.tactics.start", { f: timeline.starting_formation })}</span>
        {lastLabeled && lastLabeled.label !== timeline.starting_formation && (
          <span className="tactics-formation-badge tactics-formation-badge-current">
            {t("panels.tactics.current", { f: lastLabeled.label ?? "" })}
          </span>
        )}
      </div>

      <div className="tactics-window-strip">
        {timeline.windows.map((w, i) => (
          <div key={i} className="tactics-window-chip" title={`${w.start_min.toFixed(0)}'-${w.end_min.toFixed(0)}'`}>
            <span className="tactics-window-label">{w.label ?? "--"}</span>
            <span className="tactics-window-time">{w.start_min.toFixed(0)}'</span>
          </div>
        ))}
      </div>

      {timeline.shifts.length > 0 && (
        <ul className="tactics-shift-list">
          {timeline.shifts.map((s, i) => (
            <li key={i} className="tactics-shift-item">
              <span className="tactics-shift-icon" aria-hidden="true">⟲</span>
              <span>
                <strong>{s.at_min.toFixed(0)}'</strong> {t("panels.tactics.shift", { from: s.from_label, to: s.to_label })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {timeline.role_changes.length > 0 && (
        <ul className="tactics-role-list">
          {timeline.role_changes.map((r, i) => (
            <li key={i} className="tactics-role-item">
              <strong>{r.player_name}</strong>
              {t("panels.tactics.role", {
                from: describeZone(i18n, r.from_zone), to: describeZone(i18n, r.to_zone), min: r.at_min.toFixed(0),
              })}
            </li>
          ))}
        </ul>
      )}

      {timeline.shifts.length === 0 && timeline.role_changes.length === 0 && (
        <p className="tactics-no-change">{t("panels.tactics.noChange")}</p>
      )}
    </div>
  );
}

export function TacticalEvolution({ matchId, homeTeam, awayTeam }: Props) {
  const { t } = useT();
  const [tactics, setTactics] = useState<MatchTacticsResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!matchId) {
      setTactics(null);
      setLoadError(false);
      return;
    }
    const id = matchId;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setLoadError(false);
    // Tactics are computed eagerly, like positions, from data already
    // known the instant the match starts -- a couple of short retries
    // just absorb ordinary request/response timing jitter.
    async function load() {
      try {
        const res = await fetchTactics(id);
        if (!cancelled) setTactics(res);
      } catch {
        attempt += 1;
        if (cancelled) return;
        if (attempt < 3) retryTimer = setTimeout(load, 800);
        else setLoadError(true);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [matchId, reloadKey]);

  return (
    <section className="feed-panel tactics-panel">
      <div className="panel-heading">
        <h2>{t("panels.tactics.title")}</h2>
        <span className="panel-tag" title={t("panels.tactics.tagTitle")}>
          {t("panels.tactics.tag")}
        </span>
      </div>

      {matchId && !tactics && loadError ? (
        <div className="empty-state">
          <p className="error" role="alert">{t("panels.tactics.loadError")}</p>
          <button type="button" className="pitch-play-button" onClick={() => setReloadKey((k) => k + 1)}>
            {t("panels.retry")}
          </button>
        </div>
      ) : !matchId || !tactics ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">🧭</span>
          <p>{t(matchId ? "panels.tactics.loading" : "panels.tactics.empty")}</p>
        </div>
      ) : (
        <div className="tactics-teams">
          <TeamTimeline timeline={tactics.home} teamName={homeTeam} />
          <TeamTimeline timeline={tactics.away} teamName={awayTeam} />
        </div>
      )}
    </section>
  );
}
