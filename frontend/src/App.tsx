import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { fetchLenses } from "./lib/api";
import type { LensSummary, RunMatchResponse } from "./lib/types";
import { useOverlayFeed } from "./hooks/useOverlayFeed";
import { Header } from "./components/Header";
import { StatsBadge } from "./components/StatsBadge";
import { MatchControls } from "./components/MatchControls";
import { PipelineStatus } from "./components/PipelineStatus";
import { MatchHeader } from "./components/MatchHeader";
import { HeroStage } from "./components/HeroStage";
import { Timeline } from "./components/Timeline";
import { HistoryRail } from "./components/HistoryRail";
import { PersonaFeed } from "./components/PersonaFeed";
import { AskTheMatch } from "./components/AskTheMatch";
import { PitchView } from "./components/PitchView";
import { TacticalEvolution } from "./components/TacticalEvolution";
import { WhatIfPanel } from "./components/WhatIfPanel";

function App() {
  const [lenses, setLenses] = useState<LensSummary[]>([]);
  const [lastMatch, setLastMatch] = useState<RunMatchResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followLive, setFollowLive] = useState(true);
  const { events, status } = useOverlayFeed();

  useEffect(() => {
    fetchLenses().then(setLenses).catch(() => setLenses([]));
  }, []);

  // Web PubSub's send_to_all has no concept of "room" -- every connected
  // client gets every match's broadcasts. Without filtering by the current
  // match_id, a still-processing earlier match's events bleed into whatever
  // match is currently selected, showing cards that never happened in it.
  const renderEvents = useMemo(
    () => events
      .filter((e): e is Extract<typeof e, { kind: "render" }> => e.kind === "render")
      .map((e) => e.data)
      .filter((d) => !lastMatch || d.match_id === lastMatch.match_id),
    [events, lastMatch],
  );
  const personalizedEvents = useMemo(
    () => events
      .filter((e): e is Extract<typeof e, { kind: "personalized" }> => e.kind === "personalized")
      .map((e) => e.data)
      .filter((d) => !lastMatch || d.match_id === lastMatch.match_id),
    [events, lastMatch],
  );

  const latest = renderEvents[renderEvents.length - 1] ?? null;

  useEffect(() => {
    if (followLive && latest) setSelectedId(latest.render_id);
  }, [followLive, latest]);

  const selected = renderEvents.find((p) => p.render_id === selectedId) ?? latest;
  const isBehindLive = !followLive && latest && selected?.render_id !== latest.render_id;

  function selectManually(renderId: string) {
    setSelectedId(renderId);
    setFollowLive(renderId === latest?.render_id);
  }

  function handleMatchStarted(summary: RunMatchResponse) {
    setLastMatch(summary);
    setSelectedId(null);
    setFollowLive(true);
  }

  return (
    <div className="app">
      <Header status={status} />
      <StatsBadge />

      <main className="app-main">
        <MatchControls lenses={lenses} onMatchStarted={handleMatchStarted} />

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

        {selected ? (
          <div className="broadcast-block">
            <HeroStage payload={selected} homeTeam={lastMatch?.home_team ?? ""} awayTeam={lastMatch?.away_team ?? ""} />
            {isBehindLive && (
              <button className="jump-live-button" onClick={() => setFollowLive(true)}>
                ● Jump to live -- {renderEvents.length - renderEvents.findIndex((p) => p.render_id === selectedId) - 1} newer
              </button>
            )}
            <Timeline payloads={renderEvents} selectedId={selectedId} onSelect={selectManually} />
          </div>
        ) : (
          lastMatch && (
            <div className="hero-stage hero-stage-waiting">
              <span className="spinner spinner-lg" />
              Waiting for the first insight to clear the Narrator...
            </div>
          )
        )}

        <PitchView matchId={lastMatch?.match_id ?? null} />

        <TacticalEvolution
          matchId={lastMatch?.match_id ?? null}
          homeTeam={lastMatch?.home_team ?? "Home"}
          awayTeam={lastMatch?.away_team ?? "Away"}
        />

        <div className="columns">
          <section className="feed-panel">
            <div className="panel-heading">
              <h2>Broadcast History</h2>
              <span className="panel-tag">stage d &middot; render</span>
            </div>
            <HistoryRail payloads={renderEvents} selectedId={selectedId} onSelect={selectManually} />
          </section>

          <section className="feed-panel">
            <div className="panel-heading">
              <h2>Live Commentary</h2>
              <span className="panel-tag">stage e &middot; personalize</span>
            </div>
            <PersonaFeed messages={personalizedEvents} />
          </section>

          <AskTheMatch matchId={lastMatch?.match_id ?? null} />
          <WhatIfPanel matchId={lastMatch?.match_id ?? null} insights={renderEvents} />
        </div>
      </main>

      <footer className="app-footer">
        <span>Built on Microsoft Agent Framework &middot; Azure AI Foundry &middot; Container Apps &middot; Cosmos DB &middot; Event Hubs &middot; Web PubSub</span>
      </footer>
    </div>
  );
}

export default App;
