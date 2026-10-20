import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { fetchLenses } from "./lib/api";
import type { LensSummary, RunMatchResponse } from "./lib/types";
import { useOverlayFeed } from "./hooks/useOverlayFeed";
import { MatchControls } from "./components/MatchControls";
import { OverlayCard } from "./components/OverlayCard";
import { PersonaFeed } from "./components/PersonaFeed";

function App() {
  const [lenses, setLenses] = useState<LensSummary[]>([]);
  const [lastMatch, setLastMatch] = useState<RunMatchResponse | null>(null);
  const { events, status } = useOverlayFeed();

  useEffect(() => {
    fetchLenses().then(setLenses).catch(() => setLenses([]));
  }, []);

  const renderEvents = useMemo(
    () => events.filter((e): e is Extract<typeof e, { kind: "render" }> => e.kind === "render"),
    [events],
  );
  const personalizedEvents = useMemo(
    () => events.filter((e): e is Extract<typeof e, { kind: "personalized" }> => e.kind === "personalized").map((e) => e.data),
    [events],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Pitch Insights Engine</h1>
        <span className={`status-pill status-${status}`}>{status}</span>
      </header>

      <MatchControls lenses={lenses} onMatchStarted={setLastMatch} />

      {lastMatch && (
        <p className="match-summary">
          {lastMatch.home_team} vs {lastMatch.away_team} -- processing in the background, live cards will appear below as each insight is narrated.
        </p>
      )}

      <div className="columns">
        <section>
          <h2>Broadcaster Overlay (stage d)</h2>
          {renderEvents.length === 0 && (
            <p className="empty-state">No render payloads yet -- run a match to see the live overlay feed.</p>
          )}
          <div className="overlay-feed">
            {renderEvents.map((e) => (
              <OverlayCard key={e.data.render_id} payload={e.data} />
            ))}
          </div>
        </section>

        <section>
          <h2>Concierge Personalization (stage e)</h2>
          <PersonaFeed messages={personalizedEvents} />
        </section>
      </div>
    </div>
  );
}

export default App;
