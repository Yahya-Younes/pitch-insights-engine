import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { fetchLenses } from "./lib/api";
import type { LensSummary, RunMatchResponse } from "./lib/types";
import { useOverlayFeed } from "./hooks/useOverlayFeed";
import { Header } from "./components/Header";
import { MatchControls } from "./components/MatchControls";
import { PipelineStatus } from "./components/PipelineStatus";
import { MatchHeader } from "./components/MatchHeader";
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

  const hasFeed = renderEvents.length > 0 || personalizedEvents.length > 0;

  return (
    <div className="app">
      <Header status={status} />

      <main className="app-main">
        <MatchControls lenses={lenses} onMatchStarted={setLastMatch} />

        {lastMatch && (
          <>
            <PipelineStatus
              running={Boolean(lastMatch)}
              sawRender={renderEvents.length > 0}
              sawPersonalized={personalizedEvents.length > 0}
            />
            <MatchHeader
              homeTeam={lastMatch.home_team}
              awayTeam={lastMatch.away_team}
              insightCount={renderEvents.length}
            />
          </>
        )}

        <div className="columns">
          <section className="feed-panel">
            <div className="panel-heading">
              <h2>Broadcaster Overlay</h2>
              <span className="panel-tag">stage d &middot; render</span>
            </div>
            {renderEvents.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">📺</span>
                <p>{hasFeed ? "Waiting on the first render payload..." : "No render payloads yet. Run a match to see the live overlay feed."}</p>
              </div>
            ) : (
              <div className="overlay-feed">
                {renderEvents.map((e) => (
                  <OverlayCard key={e.data.render_id} payload={e.data} />
                ))}
              </div>
            )}
          </section>

          <section className="feed-panel">
            <div className="panel-heading">
              <h2>Concierge Personalization</h2>
              <span className="panel-tag">stage e &middot; personalize</span>
            </div>
            <PersonaFeed messages={personalizedEvents} />
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <span>Built on Microsoft Agent Framework &middot; Azure AI Foundry &middot; Container Apps &middot; Cosmos DB &middot; Event Hubs &middot; Web PubSub</span>
      </footer>
    </div>
  );
}

export default App;
