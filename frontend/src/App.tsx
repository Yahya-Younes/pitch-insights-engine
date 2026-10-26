import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { fetchLenses } from "./lib/api";
import type { LensSummary, RunMatchResponse } from "./lib/types";
import { MatchContext, type MatchContextValue } from "./lib/matchContext";
import { useOverlayFeed } from "./hooks/useOverlayFeed";
import { useA11ySettings } from "./hooks/useA11ySettings";
import { I18nProvider, makeI18n } from "./i18n";
import { useFocusTrap } from "./hooks/useFocusTrap";
import { AppBar, NewMatchDialog } from "./components/AppBar";
import { Scorebug } from "./components/Scorebug";
import { AppTabPanel, AppTabs, type AppTab } from "./components/AppTabs";
import { PlayerDrawer } from "./components/PlayerDrawer";
import { LiveTab } from "./tabs/LiveTab";
import { SuiviLiveTab } from "./tabs/SuiviLiveTab";
import { JoueursTab } from "./tabs/JoueursTab";
import { RelationsTab } from "./tabs/RelationsTab";
import { TactiqueTab } from "./tabs/TactiqueTab";
import { AnalysesTab } from "./tabs/AnalysesTab";
import { ConfianceTab } from "./tabs/ConfianceTab";

type TabId = "live" | "suivi" | "joueurs" | "relations" | "tactique" | "analyses" | "confiance";

const TAB_IDS: readonly TabId[] = ["live", "suivi", "joueurs", "relations", "tactique", "analyses", "confiance"];

function isTabId(v: string): v is TabId {
  return (TAB_IDS as readonly string[]).includes(v);
}

function tabFromHash(): TabId {
  const h = window.location.hash.replace(/^#/, "");
  return isTabId(h) ? h : "live";
}

function renderTab(id: TabId) {
  switch (id) {
    case "live": return <LiveTab />;
    case "suivi": return <SuiviLiveTab />;
    case "joueurs": return <JoueursTab />;
    case "relations": return <RelationsTab />;
    case "tactique": return <TactiqueTab />;
    case "analyses": return <AnalysesTab />;
    case "confiance": return <ConfianceTab />;
  }
}

function App() {
  const [lenses, setLenses] = useState<LensSummary[]>([]);
  const [lastMatch, setLastMatch] = useState<RunMatchResponse | null>(null);
  const [followedPlayerId, setFollowedPlayerId] = useState<string | null>(null);
  const [drawerPlayerId, setDrawerPlayerId] = useState<string | null>(null);
  const [newMatchOpen, setNewMatchOpen] = useState(false);
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const { events, status } = useOverlayFeed();
  const { settings, cycleTextSize, toggleContrast, setLocale } = useA11ySettings();
  // App renders the I18nProvider itself, so its own JSX translates directly.
  const { t } = useMemo(() => makeI18n(settings.locale), [settings.locale]);
  const tabs = useMemo<readonly AppTab<TabId>[]>(
    () => TAB_IDS.map((id) => ({ id, label: t(`shell.tab.${id}`) })),
    [t],
  );

  useEffect(() => {
    fetchLenses().then(setLenses).catch(() => setLenses([]));
  }, []);

  // Selected tab <-> URL hash, so a tab link is shareable and back/forward or
  // a pasted link switches tab.
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const selectTab = useCallback((id: TabId) => {
    setTab(id);
    if (window.location.hash !== `#${id}`) window.history.replaceState(null, "", `#${id}`);
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

  const openPlayer = useCallback((playerId: string) => setDrawerPlayerId(playerId), []);
  const closeDrawer = useCallback(() => setDrawerPlayerId(null), []);
  const closeNewMatch = useCallback(() => setNewMatchOpen(false), []);

  function handleMatchStarted(summary: RunMatchResponse) {
    setLastMatch(summary);
    setFollowedPlayerId(null);
    setDrawerPlayerId(null);
    setNewMatchOpen(false);
    selectTab("live");
  }

  const ctx = useMemo<MatchContextValue>(() => ({
    match: lastMatch,
    matchId: lastMatch?.match_id ?? null,
    homeTeam: lastMatch?.home_team ?? "",
    awayTeam: lastMatch?.away_team ?? "",
    renderEvents,
    personalizedEvents,
    lenses,
    followedPlayerId,
    setFollowedPlayerId,
    openPlayer,
  }), [lastMatch, renderEvents, personalizedEvents, lenses, followedPlayerId, openPlayer]);

  // Player drawer: focus moves in on open, Esc closes, focus returns on close.
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerOpen = drawerPlayerId !== null;
  useFocusTrap(drawerOpen, drawerRef, closeDrawer);

  // No background scrolling behind a modal layer.
  const modalOpen = drawerOpen || newMatchOpen;
  useEffect(() => {
    if (!modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [modalOpen]);

  return (
    <I18nProvider locale={settings.locale}>
    <MatchContext.Provider value={ctx}>
      <div className="app">
        <a className="skip-link" href="#main-content">{t("shell.skipLink")}</a>

        <AppBar
          feedStatus={status}
          textSize={settings.textSize}
          contrast={settings.contrast}
          locale={settings.locale}
          onCycleTextSize={cycleTextSize}
          onToggleContrast={toggleContrast}
          onLocaleChange={setLocale}
          onOpenNewMatch={() => setNewMatchOpen(true)}
          newMatchOpen={newMatchOpen}
        />

        <div className="app-sticky">
          <Scorebug match={lastMatch} />
          <AppTabs tabs={tabs} selected={tab} onSelect={selectTab} />
        </div>

        <main id="main-content" className="app-main" tabIndex={-1}>
          {lastMatch && (
            <h1 className="ui-sr-only">
              {t("shell.srTitle", { home: lastMatch.home_team, away: lastMatch.away_team })}
            </h1>
          )}
          {!lastMatch && (
            <section className="landing-hero" aria-labelledby="landing-title">
              <span className="ui-pill is-home">{t("shell.landing.pill")}</span>
              <h1 id="landing-title" className="landing-title">
                {t("shell.landing.title")}
              </h1>
              <p className="landing-sub">
                {t("shell.landing.sub")}
              </p>
              <button
                type="button"
                className="ui-btn ui-btn-primary landing-cta"
                onClick={() => setNewMatchOpen(true)}
                aria-haspopup="dialog"
              >
                <span aria-hidden="true">▶</span> {t("shell.newMatch")}
              </button>
            </section>
          )}

          <AppTabPanel key={tab} id={tab} intro={t(`shell.intro.${tab}`)}>
            {renderTab(tab)}
          </AppTabPanel>
        </main>

        <footer className="app-footer">
          <span>{t("shell.footer.builtOn")} Microsoft Agent Framework &middot; Azure AI Foundry &middot; Container Apps &middot; Cosmos DB &middot; Event Hubs &middot; Web PubSub</span>
        </footer>
      </div>

      <NewMatchDialog
        open={newMatchOpen}
        onClose={closeNewMatch}
        lenses={lenses}
        onMatchStarted={handleMatchStarted}
        locale={settings.locale}
      />

      {drawerPlayerId !== null && (
        <div className="drawer-layer">
          <div className="drawer-backdrop" onClick={closeDrawer} aria-hidden="true" />
          <div
            ref={drawerRef}
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.drawer.title")}
            tabIndex={-1}
          >
            <div className="drawer-chrome">
              <span className="drawer-chrome-title">{t("shell.drawer.title")}</span>
              <button type="button" className="ui-btn drawer-close" onClick={closeDrawer} aria-label={t("shell.drawer.close")}>
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <div className="drawer-body">
              <PlayerDrawer playerId={drawerPlayerId} onClose={closeDrawer} />
            </div>
          </div>
        </div>
      )}
    </MatchContext.Provider>
    </I18nProvider>
  );
}

export default App;
