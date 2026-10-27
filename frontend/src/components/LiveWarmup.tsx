import { useEffect, useState } from "react";
import { fetchAgentTrace } from "../lib/agentTraceApi";
import type { AgentTraceAgent, AgentTraceResponse } from "../lib/agentTraceTypes";
import { useT } from "../i18n";
import { CountUpText } from "./CountUp";

const POLL_MS = 1500;

type StepState = "pending" | "active" | "done";

interface Step {
  id: string;
  /** Agent name -- a proper noun, not translated. */
  name: string;
  state: StepState;
  label: string;
  detail: string | null;
  note?: string | null;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What the agents are doing before the first verified insight lands: the
 * real counters from the agent trace (events validated, moments detected,
 * moments narrated and checked, drafts rejected by the fact-checker),
 * polled while this is on screen. The workflow hands the Broadcaster a whole
 * batch of narrated moments at once, so "x/y written" is exactly how far the
 * first on-air insight is. Mount with key={matchId} so the clock restarts
 * per match. */
export function LiveWarmup({ matchId }: { matchId: string }) {
  const i18n = useT();
  const { t } = i18n;
  const [trace, setTrace] = useState<AgentTraceResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number | undefined;
    const load = () => {
      fetchAgentTrace(matchId, ctrl.signal)
        .then(setTrace)
        .catch(() => { /* keep the last known counters; the next poll retries */ })
        .finally(() => {
          if (!ctrl.signal.aborted) timer = window.setTimeout(load, POLL_MS);
        });
    };
    load();
    const started = Date.now();
    const tick = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, [matchId]);

  const agent = (stage: string): AgentTraceAgent | undefined => trace?.agents.find((a) => a.stage === stage);
  const scout = agent("scout");
  const analyst = agent("analyst0");
  const narrator = agent("narrator");
  const validated = scout?.outputs ?? 0;
  const moments = analyst?.outputs ?? 0;
  const analysed = analyst?.processed ?? 0;
  const narrated = narrator?.outputs ?? 0;
  const rejected = narrator?.grounding_failures ?? 0;

  const steps: Step[] = [
    {
      id: "scout", name: "Scout",
      state: validated > 0 ? "done" : "active",
      label: t("live.warmup.scout"),
      detail: validated > 0 ? t("live.warmup.scoutDone", { n: i18n.num(validated) }) : null,
    },
    {
      id: "analyst0", name: "Analyst-0",
      state: moments > 0 ? "done" : validated > 0 ? "active" : "pending",
      label: t("live.warmup.analyst"),
      detail: moments > 0
        ? t("live.warmup.analystDone", { n: i18n.num(moments) })
        : analysed > 0 ? t("live.warmup.analystBusy", { n: i18n.num(analysed) }) : null,
    },
    {
      id: "narrator", name: "Narrator",
      state: moments > 0 && narrated >= moments ? "done" : moments > 0 ? "active" : "pending",
      label: t("live.warmup.narrator"),
      detail: moments > 0
        ? t("live.warmup.narratorProgress", { done: i18n.num(Math.min(narrated, moments)), total: i18n.num(moments) })
        : null,
      note: rejected > 0 ? t("live.warmup.narratorRejected", { n: i18n.num(rejected) }) : null,
    },
    {
      id: "broadcaster", name: "Broadcaster",
      state: moments > 0 && narrated >= moments ? "active" : "pending",
      label: t("live.warmup.broadcaster"),
      detail: null,
    },
  ];
  // Weighted the way the wait actually splits: nearly all of it is narration.
  const progress = (validated > 0 ? 0.08 : 0.02) + (moments > 0 ? 0.08 : 0)
    + (moments > 0 ? 0.76 * Math.min(1, narrated / moments) : 0);

  return (
    <div className="ui-card lv-hero lv-warmup">
      <div className="lv-warmup-head">
        <p className="lv-warmup-title" role="status">{t("live.tab.waiting")}</p>
        <span className="lv-warmup-clock" aria-hidden="true">{clock(elapsed)}</span>
      </div>
      <div className="lv-warmup-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <ol className="lv-warmup-steps">
        {steps.map((s) => (
          <li key={s.id} className={`lv-warmup-step is-${s.state}`}>
            <span className="lv-warmup-mark" aria-hidden="true">{s.state === "done" ? "✓" : ""}</span>
            <span className="lv-warmup-body">
              <span className="lv-warmup-name">
                {s.name}
                <span className="ui-sr-only"> · {t(`live.warmup.state.${s.state}`)}</span>
              </span>
              <span className="lv-warmup-label">{s.label}</span>
              {s.detail && (
                <span className="lv-warmup-detail"><CountUpText text={s.detail} durationMs={600} /></span>
              )}
              {s.note && <span className="lv-warmup-note"><CountUpText text={s.note} durationMs={600} /></span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
