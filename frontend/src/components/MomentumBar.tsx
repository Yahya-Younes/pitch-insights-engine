import { useEffect, useId, useMemo, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { fetchMomentum, num2 } from "../lib/momentumApi";
import type { MomentumBucket, MomentumResponse } from "../lib/momentumApi";
import { useT } from "../i18n";
import type { I18n } from "../i18n";
import "./MomentumBar.css";

interface Props {
  matchId: string | null;
  homeTeam: string;
  awayTeam: string;
}

const W = 860;
const H = 150;
const PAD_X = 8;
const PLOT_W = W - PAD_X * 2;
const MID = H / 2;
const HALF = MID - 6;

function summarize(i18n: I18n, buckets: MomentumBucket[], homeTeam: string, awayTeam: string, lastMinute: number): string {
  let home = 0;
  let away = 0;
  let peak: MomentumBucket | null = null;
  for (const b of buckets) {
    if (b.momentum > 0.05) home += 1;
    else if (b.momentum < -0.05) away += 1;
    if (!peak || Math.abs(b.momentum) > Math.abs(peak.momentum)) peak = b;
  }
  const peakText = peak && Math.abs(peak.momentum) > 0.05
    ? ` ${i18n.t("live.mb.peak", { team: peak.momentum > 0 ? homeTeam : awayTeam, minute: peak.minute })}`
    : "";
  const summary = i18n.t("live.mb.summary", { last: lastMinute, home: homeTeam, homeCount: home, away: awayTeam, awayCount: away });
  return `${summary}${peakText}`;
}

export function MomentumBar({ matchId, homeTeam, awayTeam }: Props) {
  const i18n = useT();
  const { t } = i18n;
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: string; data: MomentumResponse | null; error: string | null } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const requestKey = matchId ? `${matchId}#${reloadKey}` : null;

  useEffect(() => {
    if (!matchId) return;
    const key = `${matchId}#${reloadKey}`;
    const ctrl = new AbortController();
    fetchMomentum(matchId, 1, ctrl.signal)
      .then((d) => setResult({ key, data: d, error: null }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setResult({ key, data: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [matchId, reloadKey]);

  const current = result && result.key === requestKey ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const loading = requestKey !== null && current === null;

  const buckets = useMemo(() => data?.buckets ?? [], [data]);
  const bucketMin = data?.bucket_min ?? 1;
  const lastMinute = (buckets[buckets.length - 1]?.minute ?? 0) + bucketMin;
  const domain = Math.max(90, lastMinute);
  const xOf = (minute: number) => PAD_X + (minute / domain) * PLOT_W;
  const barW = Math.max(1, (bucketMin / domain) * PLOT_W - 1.5);

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const minute = ((vx - PAD_X) / PLOT_W) * domain;
    const idx = Math.floor(minute / bucketMin);
    setHover(idx >= 0 && idx < buckets.length ? idx : null);
  }

  const hovered = hover !== null ? buckets[hover] : undefined;

  let body: ReactNode;
  if (!matchId) {
    body = <p className="lv-muted">{t("live.mb.noMatch")}</p>;
  } else if (loading) {
    body = (
      <div className="mb-state" role="status">
        <span className="lv-spinner" aria-hidden="true" /> {t("live.mb.loading")}
      </div>
    );
  } else if (error) {
    body = (
      <div className="mb-state mb-state-error">
        <p className="lv-error" role="alert">{t("live.mb.error", { error })}</p>
        <button type="button" className="ui-btn" onClick={() => setReloadKey((k) => k + 1)}>{t("live.retry")}</button>
      </div>
    );
  } else if (buckets.length === 0) {
    body = <p className="lv-muted">{t("live.mb.empty")}</p>;
  } else {
    body = (
      <>
        <div className="mb-chart-wrap">
          <svg
            className="mb-chart"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={summarize(i18n, buckets, homeTeam, awayTeam, lastMinute)}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
          >
            {[45].map((m) => (
              <line key={m} className="mb-half" x1={xOf(m)} x2={xOf(m)} y1={4} y2={H - 4} />
            ))}
            {buckets.map((b, i) => {
              const h = Math.min(1, Math.abs(b.momentum)) * HALF;
              const home = b.momentum >= 0;
              return (
                <rect
                  key={b.minute}
                  className={`mb-bar ${home ? "mb-bar-home" : "mb-bar-away"}${hover === i ? " is-hover" : ""}`}
                  x={xOf(b.minute) + 0.75}
                  y={home ? MID - h : MID}
                  width={barW}
                  height={Math.max(h, 0.5)}
                  rx={1}
                />
              );
            })}
            <line className="mb-axis" x1={PAD_X} x2={W - PAD_X} y1={MID} y2={MID} />
          </svg>

          {hovered && (
            <div
              className={`mb-tooltip${xOf(hovered.minute) > W * 0.7 ? " is-left" : ""}`}
              style={{ left: `${(xOf(hovered.minute) / W) * 100}%` }}
              aria-hidden="true"
            >
              <strong>{hovered.minute}'–{hovered.minute + bucketMin}'</strong>
              <span className="mb-tt-home">{t("live.mb.tooltipXt", { team: homeTeam, value: num2(i18n, hovered.home_xt) })}</span>
              <span className="mb-tt-away">{t("live.mb.tooltipXt", { team: awayTeam, value: num2(i18n, hovered.away_xt) })}</span>
              <span>
                {Math.abs(hovered.momentum) < 0.05
                  ? t("live.mb.balanced")
                  : t("live.mb.advantage", { team: hovered.momentum > 0 ? homeTeam : awayTeam })}
              </span>
            </div>
          )}

          <div className="mb-goals">
            {(data?.goals ?? []).map((g, i) => (
              <span
                key={`${g.minute}-${i}`}
                className={`ui-pill mb-goal ${g.team === "home" ? "is-home" : "is-away"}`}
                style={{ left: `${(xOf(g.minute) / W) * 100}%` }}
                title={`${g.player_name} (${g.team === "home" ? homeTeam : awayTeam})`}
              >
                ⚽ {g.minute}'
              </span>
            ))}
          </div>
        </div>

        <div className="mb-axis-labels" aria-hidden="true">
          <span>0'</span><span>45'</span><span>{domain}'</span>
        </div>
        <div className="mb-legend" aria-hidden="true">
          <span><i className="mb-swatch mb-swatch-home" />{homeTeam}</span>
          <span><i className="mb-swatch mb-swatch-away" />{awayTeam}</span>
        </div>

        <table className="ui-sr-only">
          <caption>{t("live.mb.caption")}</caption>
          <thead>
            <tr><th scope="col">{t("live.mb.colMinute")}</th><th scope="col">xT {homeTeam}</th><th scope="col">xT {awayTeam}</th><th scope="col">{t("live.mb.colMomentum")}</th></tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.minute}>
                <th scope="row">{b.minute}'</th>
                <td>{num2(i18n, b.home_xt)}</td>
                <td>{num2(i18n, b.away_xt)}</td>
                <td>{num2(i18n, b.momentum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.goals.length ?? 0) > 0 && (
          <ul className="ui-sr-only" aria-label={t("live.mb.goalsAria")}>
            {data?.goals.map((g, i) => (
              <li key={i}>{t("live.mb.goalItem", { minute: g.minute, player: g.player_name, team: g.team === "home" ? homeTeam : awayTeam })}</li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <section className="ui-card mb-panel" aria-labelledby={titleId}>
      <div className="lv-card-head">
        <h2 id={titleId} className="ui-heading">{t("live.mb.title")}</h2>
        <span className="ui-tag" title={t("live.mb.method")}>{t("live.mb.tag")}</span>
      </div>
      {body}
    </section>
  );
}
