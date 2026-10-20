import { useState } from "react";
import type { LensSummary, Persona, RunMatchResponse } from "../lib/types";
import { runMatch } from "../lib/api";

interface Props {
  lenses: LensSummary[];
  onMatchStarted: (summary: RunMatchResponse) => void;
}

const PERSONAS: { value: Persona; label: string }[] = [
  { value: "casual_fan", label: "Casual Fan" },
  { value: "analyst", label: "Analyst" },
  { value: "player_tracker", label: "Player Tracker" },
];

export function MatchControls({ lenses, onMatchStarted }: Props) {
  const [persona, setPersona] = useState<Persona>("casual_fan");
  const [lensId, setLensId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setBusy(true);
    setError(null);
    try {
      const summary = await runMatch({ persona, lensId: lensId || null });
      onMatchStarted(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="match-controls">
      <div className="control-group">
        <label htmlFor="persona-select">Persona</label>
        <select id="persona-select" value={persona} onChange={(e) => setPersona(e.target.value as Persona)}>
          {PERSONAS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
      <div className="control-group">
        <label htmlFor="lens-select">Coach Lens</label>
        <select id="lens-select" value={lensId} onChange={(e) => setLensId(e.target.value)}>
          <option value="">None (neutral)</option>
          {lenses.map((l) => (
            <option key={l.lens_id} value={l.lens_id}>{l.attributed_style_of}</option>
          ))}
        </select>
      </div>
      <button onClick={handleRun} disabled={busy}>
        {busy ? "Generating match..." : "Run New Match"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
