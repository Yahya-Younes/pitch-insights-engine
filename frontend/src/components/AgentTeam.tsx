import { useEffect, useState } from "react";
import { fetchAgentTrace, overlayFeedUrl, overlaySchemaUrl } from "../lib/agentTraceApi";
import type { AgentKind, AgentTraceAgent, AgentTraceResponse, HandoffPath } from "../lib/agentTraceTypes";
import "./AgentTeam.css";

interface Props {
  matchId: string | null;
  running?: boolean;
}

const POLL_MS = 2000;

const KIND_LABEL: Record<AgentKind, string> = {
  deterministic: "Rules",
  llm: "LLM",
  "llm+verifier": "LLM + verifier",
};

const PATH_LABEL: Record<HandoffPath, string> = {
  llm: "LLM",
  fallback: "Fallback",
  rules: "Rules",
};

function formatMs(ms: number | null): string {
  if (ms === null) return "--";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function AgentCard({ agent, active }: { agent: AgentTraceAgent; active: boolean }) {
  const isLlm = agent.kind !== "deterministic";
  const outputsLabel = agent.stage === "scout" ? "accepted" : agent.stage === "analyst0" ? "insights" : "shipped";
  const processedLabel = agent.stage === "scout" || agent.stage === "analyst0" ? "events in" : "handled";

  return (
    <li className={`agent-card${active ? " agent-card-active" : ""}`} aria-current={active ? "step" : undefined}>
      <div className="agent-card-head">
        <span className="agent-card-name">{agent.name}</span>
        <span className={`agent-kind agent-kind-${isLlm ? "llm" : "rules"}`}>{KIND_LABEL[agent.kind]}</span>
      </div>
      <p className="agent-card-role">{agent.role}</p>
      <dl className="agent-stats">
        <div><dt>{processedLabel}</dt><dd>{agent.processed}</dd></div>
        <div><dt>{outputsLabel}</dt><dd>{agent.outputs}</dd></div>
        <div><dt>LLM calls</dt><dd>{agent.llm_calls ?? "--"}</dd></div>
        <div><dt>avg time</dt><dd>{formatMs(agent.avg_duration_ms)}</dd></div>
      </dl>
      {(agent.fallbacks > 0 || agent.grounding_failures > 0 || agent.llm_outages > 0) && (
        <div className="agent-flags">
          {agent.fallbacks > 0 && (
            <span className="agent-flag agent-flag-fallback">fallback used {agent.fallbacks}×</span>
          )}
          {agent.grounding_failures > 0 && (
            <span className="agent-flag agent-flag-caught">verifier caught {agent.grounding_failures}</span>
          )}
          {agent.llm_outages > 0 && (
            <span className="agent-flag agent-flag-outage">LLM down {agent.llm_outages}×</span>
          )}
        </div>
      )}
    </li>
  );
}

export function AgentTeam({ matchId, running = false }: Props) {
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
        <h2 id="agent-team-title">Agent team, live</h2>
        <span className="panel-tag">{running ? "polling every 2s" : "from the shared handoff log"}</span>
      </div>

      {!matchId && <p className="agent-team-empty">Start a match to watch the five agents hand work to each other.</p>}

      {matchId && error && (
        <p className="agent-team-error" role="alert">Couldn't load the agent trace: {error}</p>
      )}

      {matchId && !trace && !error && <p className="agent-team-empty">Loading agent trace…</p>}

      {trace && (
        <>
          <ol className="agent-cards" aria-label="Agents in pipeline order">
            {trace.agents.map((agent) => (
              <AgentCard key={agent.stage} agent={agent} active={running && agent.stage === lastStage} />
            ))}
          </ol>

          <dl className="agent-totals" aria-label="Match totals">
            <div><dt>insights</dt><dd>{trace.totals.insights}</dd></div>
            <div><dt>verified</dt><dd>{trace.totals.verified}</dd></div>
            <div><dt>fell back</dt><dd>{trace.totals.fell_back}</dd></div>
            <div><dt>LLM calls</dt><dd>{trace.totals.llm_calls ?? "--"}</dd></div>
            <div><dt>overlays</dt><dd>{trace.totals.overlays}</dd></div>
            <div><dt>handoffs</dt><dd>{trace.totals.handoffs}</dd></div>
          </dl>

          <div className="agent-timeline-wrap">
            <h3 className="agent-timeline-title">Latest handoffs</h3>
            {recent.length === 0 ? (
              <p className="agent-team-empty">No handoffs recorded yet.</p>
            ) : (
              <ol className="agent-timeline" aria-label="Most recent handoffs, newest first" tabIndex={0}>
                {recent.map((row, i) => (
                  <li key={`${row.t}-${row.stage}-${row.insight_id ?? ""}-${i}`} className="agent-timeline-row">
                    <span className="agent-timeline-t">+{row.t.toFixed(2)}s</span>
                    <span className="agent-timeline-stage">{row.stage}</span>
                    <span className="agent-timeline-label">{row.label}</span>
                    <span className={`agent-path agent-path-${row.path}`}>{PATH_LABEL[row.path]}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <p className="agent-team-links">
            Graphics partners:{" "}
            <a href={overlayFeedUrl(trace.match_id)} download>download this match's overlay feed</a>
            {" · "}
            <a href={overlaySchemaUrl()} target="_blank" rel="noreferrer">overlay schema</a>
          </p>
        </>
      )}
    </section>
  );
}
