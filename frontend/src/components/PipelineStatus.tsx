import { useT } from "../i18n";

type StageState = "pending" | "active" | "done";

interface Props {
  running: boolean;
  sawRender: boolean;
  sawPersonalized: boolean;
}

interface Stage {
  id: string;
  /** Agent name -- a proper noun, not translated. */
  label: string;
}

const STAGES: Stage[] = [
  { id: "scout", label: "Scout" },
  { id: "analyst0", label: "Analyst-0" },
  { id: "narrator", label: "Narrator" },
  { id: "broadcaster", label: "Broadcaster" },
  { id: "concierge", label: "Concierge" },
];

export function PipelineStatus({ running, sawRender, sawPersonalized }: Props) {
  const { t } = useT();
  const flowing = sawRender || sawPersonalized;

  const states: Record<string, StageState> = {
    scout: running ? "done" : "pending",
    analyst0: running ? "done" : "pending",
    narrator: running ? (flowing ? "done" : "active") : "pending",
    broadcaster: running ? (sawRender ? "done" : "active") : "pending",
    concierge: running ? (sawPersonalized ? "done" : "active") : "pending",
  };

  return (
    <div className="pipeline-status" aria-label={t("shell.pipeline.label")}>
      {STAGES.map((stage, i) => (
        <div className="pipeline-stage-wrap" key={stage.id}>
          <div className={`pipeline-stage pipeline-stage-${states[stage.id]}`}>
            <span className="pipeline-dot" />
            <div className="pipeline-text">
              <span className="pipeline-label">{stage.label}</span>
              <span className="pipeline-sublabel">{t(`shell.pipeline.${stage.id}`)}</span>
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
