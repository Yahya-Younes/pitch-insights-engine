type StageState = "pending" | "active" | "done";

interface Props {
  running: boolean;
  sawRender: boolean;
  sawPersonalized: boolean;
}

interface Stage {
  id: string;
  label: string;
  sublabel: string;
}

const STAGES: Stage[] = [
  { id: "scout", label: "Scout", sublabel: "ingest" },
  { id: "analyst0", label: "Analyst-0", sublabel: "interpret" },
  { id: "narrator", label: "Narrator", sublabel: "explain" },
  { id: "broadcaster", label: "Broadcaster", sublabel: "render" },
  { id: "concierge", label: "Concierge", sublabel: "personalize" },
];

export function PipelineStatus({ running, sawRender, sawPersonalized }: Props) {
  const flowing = sawRender || sawPersonalized;

  const states: Record<string, StageState> = {
    scout: running ? "done" : "pending",
    analyst0: running ? "done" : "pending",
    narrator: running ? (flowing ? "done" : "active") : "pending",
    broadcaster: running ? (sawRender ? "done" : "active") : "pending",
    concierge: running ? (sawPersonalized ? "done" : "active") : "pending",
  };

  return (
    <div className="pipeline-status" aria-label="Agent pipeline status">
      {STAGES.map((stage, i) => (
        <div className="pipeline-stage-wrap" key={stage.id}>
          <div className={`pipeline-stage pipeline-stage-${states[stage.id]}`}>
            <span className="pipeline-dot" />
            <div className="pipeline-text">
              <span className="pipeline-label">{stage.label}</span>
              <span className="pipeline-sublabel">{stage.sublabel}</span>
            </div>
          </div>
          {i < STAGES.length - 1 && (
            <span className={`pipeline-connector ${states[stage.id] === "done" ? "pipeline-connector-done" : ""}`} />
          )}
        </div>
      ))}
    </div>
  );
}
