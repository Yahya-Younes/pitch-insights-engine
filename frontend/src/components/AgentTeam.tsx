import { useEffect, useState } from "react";
import { fetchAgentTrace, overlayFeedUrl, overlaySchemaUrl } from "../lib/agentTraceApi";
import type { AgentKind, AgentTraceAgent, AgentTraceResponse, HandoffPath } from "../lib/agentTraceTypes";
import { frNum, personaFr, triggerFr } from "../lib/frLabels";
import "./AgentTeam.css";

interface Props {
  matchId: string | null;
  running?: boolean;
}

const POLL_MS = 2000;

const KIND_LABEL: Record<AgentKind, string> = {
  deterministic: "Règles",
  llm: "LLM",
  "llm+verifier": "LLM + vérificateur",
};

const PATH_LABEL: Record<HandoffPath, string> = {
  llm: "LLM",
  fallback: "Repli",
  rules: "Règles",
};

/** Display names and roles per pipeline stage (API stage ids unchanged). */
const STAGE_FR: Record<string, { name: string; role: string }> = {
  scout: {
    name: "Scout",
    role: "Ingère le flux d'événements brut et rejette les événements mal formés avant tout traitement en aval.",
  },
  analyst0: {
    name: "Analyste-0",
    role: "Calcule pressing, xT, tempo et tendances, puis émet des insights candidats ancrés dans les données.",
  },
  narrator: {
    name: "Narrateur",
    role: "Explique chaque insight avec un LLM ; un contrôle d'ancrage rejette tout chiffre ou nom non justifié.",
  },
  broadcaster: {
    name: "Diffuseur",
    role: "Transforme chaque insight raconté en incrustation horodatée, lisible par les outils graphiques.",
  },
  concierge: {
    name: "Concierge",
    role: "Réécrit chaque insight pour le profil du spectateur, revérifié sur les mêmes preuves.",
  },
};

const stageName = (stage: string) => STAGE_FR[stage]?.name ?? stage;

/** Broadcaster overlay templates (agents/broadcaster/render._TEMPLATE_BY_TRIGGER). */
const TEMPLATE_FR: Record<string, string> = {
  pressing_intensity_card: "carte d'intensité du pressing",
  momentum_meter: "jauge de momentum",
  tempo_graph: "graphique de tempo",
  threat_zone_highlight: "zone de menace",
  goal_banner: "bandeau de but",
  referee_positioning_card: "carte de placement de l'arbitre",
  player_tendency_card: "carte de tendance joueur",
  generic_insight_card: "carte d'insight",
  overlay: "incrustation",
};

function subjectFr(subject: string): string {
  const recap = /^(.*) recap$/.exec(subject);
  if (recap) return `récap ${personaFr(recap[1] ?? "")}`;
  return triggerFr(subject);
}

/** Maps the backend's English timeline labels (agent_trace._label) to French. */
function labelFr(label: string): string {
  let m = /^Validated (\d+) events, rejected (\d+)$/.exec(label);
  if (m) return `${m[1]} événements validés, ${m[2]} rejetés`;
  m = /^(\d+) insight candidates from (\d+) events$/.exec(label);
  if (m) return `${m[1]} insights candidats sur ${m[2]} événements`;
  m = /^Rendered (.+) overlay$/.exec(label);
  if (m) return `Incrustation générée : ${TEMPLATE_FR[m[1] ?? ""] ?? (m[1] ?? "").replace(/_/g, " ")}`;
  m = /^Narrated (.+) \(verified\)$/.exec(label);
  if (m) return `Raconté : ${subjectFr(m[1] ?? "")} · vérifié`;
  m = /^Personalized (.+) \(verified\)$/.exec(label);
  if (m) return `Personnalisé : ${subjectFr(m[1] ?? "")} · vérifié`;
  m = /^(.+): grounding check rejected LLM text, shipped deterministic template$/.exec(label);
  if (m) return `${subjectFr(m[1] ?? "")} : texte LLM rejeté par le contrôle d'ancrage, modèle déterministe diffusé`;
  m = /^(.+): grounding check rejected LLM text, shipped narrator's verified text$/.exec(label);
  if (m) return `${subjectFr(m[1] ?? "")} : texte LLM rejeté par le contrôle d'ancrage, texte vérifié du narrateur diffusé`;
  m = /^(.+): LLM failed twice, fell back$/.exec(label);
  if (m) return `${subjectFr(m[1] ?? "")} : LLM en échec deux fois, repli`;
  m = /^(.+): fell back$/.exec(label);
  if (m) return `${subjectFr(m[1] ?? "")} : repli`;
  return label;
}

function formatMs(ms: number | null): string {
  if (ms === null) return "--";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${frNum(ms, 0)} ms`;
  return `${frNum(ms / 1000, 1)} s`;
}

function AgentCard({ agent, active }: { agent: AgentTraceAgent; active: boolean }) {
  const isLlm = agent.kind !== "deterministic";
  const outputsLabel = agent.stage === "scout" ? "acceptés" : agent.stage === "analyst0" ? "insights" : "diffusés";
  const processedLabel = agent.stage === "scout" || agent.stage === "analyst0" ? "événements reçus" : "traités";

  return (
    <li className={`agent-card${active ? " agent-card-active" : ""}`} aria-current={active ? "step" : undefined}>
      <div className="agent-card-head">
        <span className="agent-card-name">{STAGE_FR[agent.stage]?.name ?? agent.name}</span>
        <span className={`agent-kind agent-kind-${isLlm ? "llm" : "rules"}`}>{KIND_LABEL[agent.kind]}</span>
      </div>
      <p className="agent-card-role">{STAGE_FR[agent.stage]?.role ?? agent.role}</p>
      <dl className="agent-stats">
        <div><dt>{processedLabel}</dt><dd>{agent.processed}</dd></div>
        <div><dt>{outputsLabel}</dt><dd>{agent.outputs}</dd></div>
        <div><dt>appels LLM</dt><dd>{agent.llm_calls ?? "--"}</dd></div>
        <div><dt>temps moyen</dt><dd>{formatMs(agent.avg_duration_ms)}</dd></div>
      </dl>
      {(agent.fallbacks > 0 || agent.grounding_failures > 0 || agent.llm_outages > 0) && (
        <div className="agent-flags">
          {agent.fallbacks > 0 && (
            <span className="agent-flag agent-flag-fallback">repli utilisé {agent.fallbacks}×</span>
          )}
          {agent.grounding_failures > 0 && (
            <span className="agent-flag agent-flag-caught">vérificateur : {agent.grounding_failures} rejet{agent.grounding_failures > 1 ? "s" : ""}</span>
          )}
          {agent.llm_outages > 0 && (
            <span className="agent-flag agent-flag-outage">LLM indisponible {agent.llm_outages}×</span>
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
        <h2 id="agent-team-title">L'équipe d'agents en direct</h2>
        <span className="panel-tag">{running ? "actualisé toutes les 2 s" : "depuis le journal de relais partagé"}</span>
      </div>

      {!matchId && <p className="agent-team-empty">Lance un match pour voir les cinq agents se passer le relais.</p>}

      {matchId && error && (
        <p className="agent-team-error" role="alert">Impossible de charger la trace des agents : {error}</p>
      )}

      {matchId && !trace && !error && <p className="agent-team-empty">Chargement de la trace des agents…</p>}

      {trace && (
        <>
          <ol className="agent-cards" aria-label="Agents dans l'ordre du pipeline">
            {trace.agents.map((agent) => (
              <AgentCard key={agent.stage} agent={agent} active={running && agent.stage === lastStage} />
            ))}
          </ol>

          <dl className="agent-totals" aria-label="Totaux du match">
            <div><dt>insights</dt><dd>{trace.totals.insights}</dd></div>
            <div><dt>vérifiés</dt><dd>{trace.totals.verified}</dd></div>
            <div><dt>replis</dt><dd>{trace.totals.fell_back}</dd></div>
            <div><dt>appels LLM</dt><dd>{trace.totals.llm_calls ?? "--"}</dd></div>
            <div><dt>incrustations</dt><dd>{trace.totals.overlays}</dd></div>
            <div><dt>relais</dt><dd>{trace.totals.handoffs}</dd></div>
          </dl>

          <div className="agent-timeline-wrap">
            <h3 className="agent-timeline-title">Derniers relais</h3>
            {recent.length === 0 ? (
              <p className="agent-team-empty">Aucun relais enregistré pour l'instant.</p>
            ) : (
              <ol className="agent-timeline" aria-label="Relais les plus récents en premier" tabIndex={0}>
                {recent.map((row, i) => (
                  <li key={`${row.t}-${row.stage}-${row.insight_id ?? ""}-${i}`} className="agent-timeline-row">
                    <span className="agent-timeline-t">+{frNum(row.t, 2)} s</span>
                    <span className="agent-timeline-stage">{stageName(row.stage)}</span>
                    <span className="agent-timeline-label">{labelFr(row.label)}</span>
                    <span className={`agent-path agent-path-${row.path}`}>{PATH_LABEL[row.path]}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <p className="agent-team-links">
            Partenaires graphiques :{" "}
            <a href={overlayFeedUrl(trace.match_id)} download>télécharger le flux d'incrustations du match</a>
            {" · "}
            <a href={overlaySchemaUrl()} target="_blank" rel="noreferrer">schéma</a>
          </p>
        </>
      )}
    </section>
  );
}
