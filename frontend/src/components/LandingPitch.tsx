import type { CSSProperties } from "react";
import { useT } from "../i18n";
import { triggerLabel } from "../lib/momentumApi";
import { themeFor } from "../lib/triggerTheme";
import "./LandingPitch.css";

type Dot = readonly [x: number, y: number];

// 120x80 board; home attacks to the right.
const HOME: readonly Dot[] = [[10, 40], [28, 40], [44, 20], [46, 60], [64, 34], [78, 56], [92, 30]];
const AWAY: readonly Dot[] = [[110, 40], [98, 48], [96, 24], [86, 62], [72, 46], [62, 22]];
// The ball's route (see lp-ball keyframes): 28,40 -> 44,20 -> 64,34 -> 78,56 -> 92,30 -> goal.
const PASSES: readonly [Dot, Dot][] = [
  [[28, 40], [44, 20]], [[44, 20], [64, 34]], [[64, 34], [78, 56]], [[78, 56], [92, 30]], [[92, 30], [115, 38]],
];

function drift(i: number): CSSProperties {
  // Deterministic, uneven drift so the players never move in sync.
  const dx = ((i * 37) % 7) / 3 - 1;
  const dy = ((i * 53) % 5) / 2 - 1;
  return {
    "--dx": `${dx * 1.6}px`,
    "--dy": `${dy * 1.6}px`,
    animationDuration: `${2.6 + ((i * 7) % 5) * 0.45}s`,
    animationDelay: `${-((i * 3) % 4) * 0.7}s`,
  } as CSSProperties;
}

/** Decorative landing preview: a passing move on a mini pitch and the kind
 * of verified insight cards the agents produce. Not live data, labelled as
 * a preview; reduced motion gets a still frame. */
export function LandingPitch() {
  const i18n = useT();
  const { t } = i18n;
  const cards = [
    { type: "pressure_spike", minute: 23, text: t("shell.landing.demo.pressure", { pct: i18n.pct(0.33, 0) }) },
    { type: "xt_surge", minute: 41, text: t("shell.landing.demo.xt", { x: i18n.num(6.3, 1) }) },
    { type: "rhythm_change", minute: 67, text: t("shell.landing.demo.tempo", { n: i18n.num(14) }) },
  ];

  return (
    <div className="lp" aria-hidden="true">
      <span className="lp-tag">{t("shell.landing.demo.tag")}</span>
      <svg className="lp-pitch" viewBox="0 0 120 80" role="presentation">
        <defs>
          <pattern id="lp-stripes" width="16" height="80" patternUnits="userSpaceOnUse">
            <rect width="8" height="80" className="lp-grass-a" />
            <rect x="8" width="8" height="80" className="lp-grass-b" />
          </pattern>
          <radialGradient id="lp-heat">
            <stop offset="0" stopColor="var(--team-home)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--team-home)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="4" y="4" width="112" height="72" rx="1.5" fill="url(#lp-stripes)" />
        <g className="lp-lines">
          <rect x="4" y="4" width="112" height="72" rx="1.5" />
          <line x1="60" y1="4" x2="60" y2="76" />
          <circle cx="60" cy="40" r="9" />
          <rect x="4" y="22" width="16" height="36" />
          <rect x="100" y="22" width="16" height="36" />
          <rect x="4" y="31" width="6" height="18" />
          <rect x="110" y="31" width="6" height="18" />
          <rect x="1.5" y="35" width="2.5" height="10" />
          <rect x="116" y="35" width="2.5" height="10" />
        </g>

        <circle className="lp-heat" cx="92" cy="33" r="15" fill="url(#lp-heat)" />

        {PASSES.map(([[x1, y1], [x2, y2]], i) => (
          <line
            key={i}
            className={`lp-pass lp-pass-${i + 1}${i === PASSES.length - 1 ? " is-shot" : ""}`}
            x1={x1} y1={y1} x2={x2} y2={y2}
            pathLength={1}
          />
        ))}

        {AWAY.map(([x, y], i) => (
          <circle key={`a${i}`} className="lp-p is-away" cx={x} cy={y} r="2.4" style={drift(i + 11)} />
        ))}
        {HOME.map(([x, y], i) => (
          <circle key={`h${i}`} className="lp-p is-home" cx={x} cy={y} r="2.4" style={drift(i)} />
        ))}
        <circle className="lp-ring" cx="92" cy="30" r="4" />
        <circle className="lp-ball" r="1.4" />
      </svg>

      <div className="lp-cards">
        {cards.map((c, i) => {
          const theme = themeFor(c.type);
          return (
            <div key={c.type} className="lp-card" style={{ "--lp-accent": theme.color, animationDelay: `${i * 10}s` } as CSSProperties}>
              <div className="lp-card-head">
                <span className="lp-card-icon">{theme.icon}</span>
                <span className="lp-card-kind">{triggerLabel(i18n, c.type)}</span>
                <span className="lp-card-min">{c.minute}'</span>
              </div>
              <p className="lp-card-text">{c.text}</p>
              <span className="lp-card-ok">{t("live.hero.verified")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
