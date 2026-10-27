import { useEffect, useState } from "react";
import { fetchAgentTrace, overlayFeedUrl, overlaySchemaUrl } from "../lib/agentTraceApi";
import type { AgentKind, AgentTokens, AgentTraceAgent, AgentTraceResponse, HandoffPath } from "../lib/agentTraceTypes";
import { useT, type I18n } from "../i18n";
import { personaLabel, plural, triggerLabel } from "../lib/panelLabels";
import "./AgentTeam.css";

interface Props {
  matchId: string | null;
  running?: boolean;
}

const POLL_MS = 2000;

const KIND_KEY: Record<AgentKind, string> = {
  deterministic: "agents.kind.deterministic",
  llm: "agents.kind.llm",
  "llm+verifier": "agents.kind.llmVerifier",
};

const PATH_KEY: Record<HandoffPath, string> = {
  llm: "agents.path.llm",
  fallback: "agents.path.fallback",
  rules: "agents.path.rules",
};

/** Pipeline stages with a catalog name and role (API stage ids unchanged). */
const KNOWN_STAGES = new Set(["scout", "analyst0", "narrator", "broadcaster", "concierge"]);

const stageName = (i18n: I18n, stage: string, fallback = stage) =>
  KNOWN_STAGES.has(stage) ? i18n.t(`agents.stage.${stage}.name`) : fallback;

/** Broadcaster overlay templates (agents/broadcaster/render._TEMPLATE_BY_TRIGGER). */
const TEMPLATES = new Set([
  "pressing_intensity_card", "momentum_meter", "tempo_graph", "threat_zone_highlight", "goal_banner",
  "referee_positioning_card", "player_tendency_card", "generic_insight_card", "overlay",
]);

function templateLabel(i18n: I18n, template: string): string {
  return TEMPLATES.has(template) ? i18n.t(`agents.template.${template}`) : template.replace(/_/g, " ");
}

function subjectLabel(i18n: I18n, subject: string): string {
  const recap = /^(.*) recap$/.exec(subject);
  if (recap) return i18n.t("agents.recap", { persona: personaLabel(i18n, recap[1] ?? "") });
  return triggerLabel(i18n, subject);
}

/** Maps the backend's English timeline labels (agent_trace._label) to the page language. */
function timelineLabel(i18n: I18n, label: string): string {
  const { t } = i18n;
  let m = /^Validated (\d+) events, rejected (\d+)$/.exec(label);
  if (m) return t("agents.label.validated", { ok: m[1] ?? "", rejected: m[2] ?? "" });
  m = /^(\d+) insight candidates from (\d+) events$/.exec(label);
  if (m) return t("agents.label.candidates", { n: m[1] ?? "", events: m[2] ?? "" });
  m = /^Rendered (.+) overlay$/.exec(label);
  if (m) return t("agents.label.rendered", { template: templateLabel(i18n, m[1] ?? "") });
  m = /^Narrated (.+) \(verified\)$/.exec(label);
  if (m) return t("agents.label.narrated", { subject: subjectLabel(i18n, m[1] ?? "") });
  m = /^Personalized (.+) \(verified\)$/.exec(label);
  if (m) return t("agents.label.personalized", { subject: subjectLabel(i18n, m[1] ?? "") });
  m = /^(.+): grounding check rejected LLM text, shipped deterministic template$/.exec(label);
  if (m) return t("agents.label.rejectedTemplate", { subject: subjectLabel(i18n, m[1] ?? "") });
  m = /^(.+): grounding check rejected LLM text, shipped narrator's verified text$/.exec(label);
  if (m) return t("agents.label.rejectedNarrator", { subject: subjectLabel(i18n, m[1] ?? "") });
  m = /^(.+): LLM failed twice, fell back$/.exec(label);
  if (m) return t("agents.label.failedTwice", { subject: subjectLabel(i18n, m[1] ?? "") });
  m = /^(.+): fell back$/.exec(label);
  if (m) return t("agents.label.fellBack", { subject: subjectLabel(i18n, m[1] ?? "") });
  return label;
}

function formatMs(i18n: I18n, ms: number | null): string {
  if (ms === null) return "--";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${i18n.num(ms, 0)} ms`;
  return `${i18n.num(ms / 1000, 1)} s`;
}

function formatTokens(i18n: I18n, tokens: AgentTokens | null | undefined): string {
  if (!tokens) return "--";
  const total = tokens.input_tokens + tokens.output_tokens;
  return total >= 1000 ? `${i18n.num(total / 1000, 1)}k` : i18n.num(total, 0);
}

function AgentCard({ agent, active }: { agent: AgentTraceAgent; active: boolean }) {
  const i18n = useT();
  const { t } = i18n;
  const isLlm = agent.kind !== "deterministic";
  const outputsLabel = t(
    agent.stage === "scout" ? "agents.card.accepted" : agent.stage === "analyst0" ? "agents.card.insights" : "agents.card.shipped",
  );
  const processedLabel = t(
    agent.stage === "scout" || agent.stage === "analyst0" ? "agents.card.eventsIn" : "agents.card.processed",
  );

  return (
    <li className={`agent-card${active ? " agent-card-active" : ""}`} aria-current={active ? "step" : undefined}>
      <div className="agent-card-head">
        <span className="agent-card-name">{stageName(i18n, agent.stage, agent.name)}</span>
        <span className={`agent-kind agent-kind-${isLlm ? "llm" : "rules"}`}>{t(KIND_KEY[agent.kind])}</span>
      </div>
      <p className="agent-card-role">
        {KNOWN_STAGES.has(agent.stage) ? t(`agents.stage.${agent.stage}.role`) : agent.role}
      </p>
      <dl className="agent-stats">
        <div><dt>{processedLabel}</dt><dd>{agent.processed}</dd></div>
        <div><dt>{outputsLabel}</dt><dd>{agent.outputs}</dd></div>
        <div><dt>{t("agents.llmCalls")}</dt><dd>{agent.llm_calls ?? "--"}</dd></div>
        <div><dt>{t("agents.card.avgTime")}</dt><dd>{formatMs(i18n, agent.avg_duration_ms)}</dd></div>
        {isLlm && (
          <div title={t("agents.tokensHint")}><dt>{t("agents.tokens")}</dt><dd>{formatTokens(i18n, agent.tokens)}</dd></div>
        )}
      </dl>
      {(agent.fallbacks > 0 || agent.grounding_failures > 0 || agent.llm_outages > 0) && (
        <div className="agent-flags">
          {agent.fallbacks > 0 && (
            <span className="agent-flag agent-flag-fallback">{t("agents.flag.fallback", { n: agent.fallbacks })}</span>
          )}
          {agent.grounding_failures > 0 && (
            <span className="agent-flag agent-flag-caught">{plural(i18n, "agents.flag.rejections", agent.grounding_failures)}</span>
          )}
          {agent.llm_outages > 0 && (
            <span className="agent-flag agent-flag-outage">{t("agents.flag.outage", { n: agent.llm_outages })}</span>
          )}
        </div>
      )}
    </li>
  );
}

export function AgentTeam({ matchId, running = false }: Props) {
  const i18n = useT();
  const { t } = i18n;
  const [trace, setTrace] = useState<AgentTraceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTrace(null);
    setError(null);
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    const controller = new AbortController();
    let inFlight = false;

    const load = () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      fetchAgentTrace(matchId, controller.signal)
        .then((data) => {
          setTrace(data);
          setError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          inFlight = false;
          if (!controller.signal.aborted) setLoading(false);
        });
    };

    // One fetch always (also the final refresh once `running` flips to
    // false); keep polling only while the match is still running.
    load();
    const interval = running ? window.setInterval(load, POLL_MS) : undefined;
    return () => {
      controller.abort();
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [matchId, running]);

  const lastStage = trace?.timeline[trace.timeline.length - 1]?.stage;
  const recent = trace ? [...trace.timeline].reverse() : [];

  return (
    <section className="feed-panel agent-team" aria-labelledby="agent-team-title" aria-busy={loading && !trace}>
      <div className="panel-heading">
        <h2 id="agent-team-title">{t("agents.title")}</h2>
        <span className="panel-tag">{t(running ? "agents.tagLive" : "agents.tagLog")}</span>
      </div>

      {!matchId && <p className="agent-team-empty">{t("agents.empty")}</p>}

      {matchId && error && (
        <p className="agent-team-error" role="alert">{t("agents.error", { error })}</p>
      )}

      {matchId && !trace && !error && <p className="agent-team-empty">{t("agents.loading")}</p>}

      {trace && (
        <>
          <ol className="agent-cards" aria-label={t("agents.cardsAria")}>
            {trace.agents.map((agent) => (
              <AgentCard key={agent.stage} agent={agent} active={running && agent.stage === lastStage} />
            ))}
          </ol>

          <dl className="agent-totals" aria-label={t("agents.totalsAria")}>
            <div><dt>{t("agents.totals.insights")}</dt><dd>{trace.totals.insights}</dd></div>
            <div><dt>{t("agents.totals.verified")}</dt><dd>{trace.totals.verified}</dd></div>
            <div><dt>{t("agents.totals.fellBack")}</dt><dd>{trace.totals.fell_back}</dd></div>
            <div><dt>{t("agents.llmCalls")}</dt><dd>{trace.totals.llm_calls ?? "--"}</dd></div>
            <div title={t("agents.tokensHint")}><dt>{t("agents.tokens")}</dt><dd>{formatTokens(i18n, trace.totals.llm_tokens)}</dd></div>
            <div><dt>{t("agents.totals.overlays")}</dt><dd>{trace.totals.overlays}</dd></div>
            <div><dt>{t("agents.totals.handoffs")}</dt><dd>{trace.totals.handoffs}</dd></div>
          </dl>

          <div className="agent-timeline-wrap">
            <h3 className="agent-timeline-title">{t("agents.timelineTitle")}</h3>
            {recent.length === 0 ? (
              <p className="agent-team-empty">{t("agents.noHandoffs")}</p>
            ) : (
              <ol className="agent-timeline" aria-label={t("agents.timelineAria")} tabIndex={0}>
                {recent.map((row, i) => (
                  <li key={`${row.t}-${row.stage}-${row.insight_id ?? ""}-${i}`} className="agent-timeline-row">
                    <span className="agent-timeline-t">+{i18n.num(row.t, 2)} s</span>
                    <span className="agent-timeline-stage">{stageName(i18n, row.stage)}</span>
                    <span className="agent-timeline-label">{timelineLabel(i18n, row.label)}</span>
                    <span className={`agent-path agent-path-${row.path}`}>{t(PATH_KEY[row.path])}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <p className="agent-team-links">
            {t("agents.links")}{" "}
            <a href={overlayFeedUrl(trace.match_id)} download>{t("agents.download")}</a>
            {" · "}
            <a href={overlaySchemaUrl()} target="_blank" rel="noreferrer">{t("agents.schema")}</a>
          </p>
        </>
      )}
    </section>
  );
}
