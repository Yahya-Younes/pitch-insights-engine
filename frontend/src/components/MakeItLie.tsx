import { useEffect, useState } from "react";
import {
  fetchVerificationHeadline, tamperNarration,
  type GroundingReasons, type TamperAttack, type TamperTrace, type VerificationHeadline,
} from "../lib/makeItLieApi";
import "./MakeItLie.css";

interface Props {
  matchId: string | null;
  /** Number of insights shipped so far; 0 disables the attacks with a hint. */
  insightCount?: number;
}

const CUSTOM_MAX = 300;

const ATTACKS: { id: Exclude<TamperAttack, "custom">; label: string; hint: string }[] = [
  { id: "fake_number", label: "Fake a number", hint: "Shift the headline stat to a value the match never produced" },
  { id: "wrong_player", label: "Wrong player", hint: "Swap in a real player from this match who wasn't involved" },
  { id: "real_club_leak", label: "Real club leak", hint: "Name-drop a real Premier League club" },
];

const ATTACK_NAMES: Record<TamperAttack, string> = {
  fake_number: "fake number", wrong_player: "wrong player", real_club_leak: "real club leak", custom: "your text",
};

interface Diff { prefix: string; changed: string; suffix: string }

const solid = (c: string | undefined): boolean => c !== undefined && /\S/.test(c);

/** Common prefix/suffix diff, widened to whole tokens when it would otherwise cut one in half. */
function diffAgainst(base: string, next: string): { removed: Diff; added: Diff } {
  let p = 0;
  while (p < base.length && p < next.length && base[p] === next[p]) p++;
  while (p > 0 && solid(base[p - 1]) && (solid(base[p]) || solid(next[p]))) p--;
  let s = 0;
  while (
    s < base.length - p && s < next.length - p
    && base[base.length - 1 - s] === next[next.length - 1 - s]
  ) s++;
  while (
    s > 0 && solid(base[base.length - s])
    && (solid(base[base.length - s - 1]) || solid(next[next.length - s - 1]))
  ) s--;
  const cut = (t: string): Diff => ({
    prefix: t.slice(0, p), changed: t.slice(p, t.length - s), suffix: t.slice(t.length - s),
  });
  return { removed: cut(base), added: cut(next) };
}

function reasonChips(r: GroundingReasons): { kind: string; text: string }[] {
  return [
    ...r.unmatched_numbers.map((n) => ({ kind: "number", text: `invented number: ${n}` })),
    ...r.unmatched_entities.map((n) => ({ kind: "player", text: `wrong player: ${n}` })),
    ...r.real_world_leaks.map((n) => ({ kind: "leak", text: `real-world leak: ${n}` })),
    ...(r.off_topic ? [{ kind: "topic", text: "off-topic for this trigger" }] : []),
  ];
}

function pct(x: number): string {
  return x.toFixed(2);
}

function Headline() {
  const [data, setData] = useState<VerificationHeadline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchVerificationHeadline()
      .then((h) => { if (alive) setData(h); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  if (error) return <p className="error mil-headline-error" role="alert">Verification headline unavailable: {error}</p>;
  if (!data) {
    return (
      <div className="mil-headline mil-headline-loading" aria-busy="true">
        <span className="spinner" /> Running the red-team suite...
      </div>
    );
  }
  const breakdown = data.by_attack.map((a) => `${a.label}: ${a.caught}/${a.planted}`).join("\n");
  return (
    <div className="mil-headline" role="status" aria-label="Fact-check verification headline" title={breakdown}>
      <span className="mil-headline-main">
        <strong>{data.caught}/{data.planted}</strong> planted errors caught
      </span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span className={data.reached_air === 0 ? "mil-headline-good" : "mil-headline-bad"}>
        <strong>{data.reached_air}</strong> reached air
      </span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span>precision <strong>{pct(data.precision)}</strong></span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span>recall <strong>{pct(data.recall)}</strong></span>
      <span className="mil-headline-sub">
        {data.false_positives}/{data.clean_tested} clean sentences wrongly rejected · re-run live, no LLM
      </span>
    </div>
  );
}

function Highlighted({ diff, variant }: { diff: Diff; variant: "removed" | "added" }) {
  return (
    <>
      {diff.prefix}
      {diff.changed && (variant === "added"
        ? <mark className="mil-added">{diff.changed}</mark>
        : <del className="mil-removed">{diff.changed}</del>)}
      {diff.suffix}
    </>
  );
}

function Trace({ trace }: { trace: TamperTrace }) {
  const diff = diffAgainst(trace.original_text, trace.tampered_text);
  const rejected = trace.verdict === "rejected";
  const chips = reasonChips(trace.reasons);
  const isCustom = trace.attack === "custom";

  return (
    <ol className="mil-trace" aria-label="Verification trace">
      <li className="mil-step" style={{ animationDelay: "0ms" }}>
        <span className="mil-step-num" aria-hidden="true">1</span>
        <div className="mil-step-body">
          <p className="mil-step-title">Tampered narration <span className="mil-attack-tag">{ATTACK_NAMES[trace.attack]}</span></p>
          {!isCustom && (
            <p className="mil-text mil-text-original">
              <span className="mil-label">was</span>
              <Highlighted diff={diff.removed} variant="removed" />
            </p>
          )}
          <p className="mil-text mil-text-tampered">
            <span className="mil-label">{isCustom ? "you wrote" : "now"}</span>
            {isCustom ? trace.tampered_text : <Highlighted diff={diff.added} variant="added" />}
          </p>
        </div>
      </li>

      <li className="mil-step" style={{ animationDelay: "450ms" }}>
        <span className="mil-step-num" aria-hidden="true">2</span>
        <div className="mil-step-body">
          <p className="mil-step-title">
            Live grounding check
            <span className={`mil-verdict ${rejected ? "mil-verdict-rejected" : "mil-verdict-passed"}`}>
              {rejected ? "REJECTED" : "PASSED"}
            </span>
          </p>
          {rejected ? (
            <ul className="mil-chips" aria-label="Why it was rejected">
              {chips.map((c) => <li key={`${c.kind}-${c.text}`} className={`mil-chip mil-chip-${c.kind}`}>{c.text}</li>)}
            </ul>
          ) : (
            <p className="mil-note">
              Every number, roster name and topic keyword traced back to the insight, and no real-world
              names were found -- so the checker let it through.
            </p>
          )}
          <p className="mil-fineprint"><code>{trace.checker}</code> -- the same function the Narrator runs on every insight.</p>
        </div>
      </li>

      <li className="mil-step" style={{ animationDelay: "900ms" }}>
        <span className="mil-step-num" aria-hidden="true">3</span>
        <div className="mil-step-body">
          {trace.shipped === "corrected" && trace.corrected_text ? (
            <>
              <p className="mil-step-title">
                What actually airs
                <span className="mil-verdict mil-verdict-shipped">SHIPPED</span>
                {trace.corrected_verdict === "passed" && <span className="verify-badge verify-badge-ok">✓ re-verified</span>}
              </p>
              <p className="mil-text mil-text-shipped">{trace.corrected_text}</p>
              <p className="mil-fineprint">Deterministic fallback built only from the insight's own fields -- no model call.</p>
            </>
          ) : (
            <>
              <p className="mil-step-title">
                What actually airs
                <span className="mil-verdict mil-verdict-warn">SHIPPED AS WRITTEN</span>
              </p>
              <p className="mil-text">{trace.tampered_text}</p>
              <p className="mil-note mil-note-honest">
                Honest result: this one got through. The checker verifies numbers (within ±0.6), roster names,
                topic keywords and a real-world name blocklist -- not meaning. Small tweaks or claims without
                numbers or names can pass.
              </p>
            </>
          )}
        </div>
      </li>
    </ol>
  );
}

export function MakeItLie({ matchId, insightCount }: Props) {
  const [customText, setCustomText] = useState("");
  const [trace, setTrace] = useState<TamperTrace | null>(null);
  const [runId, setRunId] = useState(0);
  const [busy, setBusy] = useState<TamperAttack | null>(null);
  const [error, setError] = useState<string | null>(null);

  const noInsights = insightCount !== undefined && insightCount === 0;
  const disabled = !matchId || noInsights || busy !== null;
  const hint = !matchId
    ? "Run a match first -- then try to sneak a lie past the fact-checker."
    : noInsights ? "Waiting for the first verified insight to tamper with..." : null;

  async function attack(kind: TamperAttack) {
    if (!matchId) return;
    if (kind === "custom" && !customText.trim()) return;
    setBusy(kind);
    setError(null);
    try {
      const res = await tamperNarration(matchId, kind, kind === "custom" ? { customText: customText.trim() } : {});
      setTrace(res);
      setRunId((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="feed-panel mil-panel" aria-labelledby="mil-title">
      <div className="panel-heading">
        <h2 id="mil-title">Try to make it lie</h2>
        <span className="panel-tag">live fact-check · no LLM</span>
      </div>

      <Headline />

      <div className="mil-attacks" role="group" aria-label="Choose an attack">
        {ATTACKS.map((a) => (
          <button
            key={a.id}
            type="button"
            className="mil-attack-button"
            title={a.hint}
            aria-label={`${a.label}: ${a.hint}`}
            disabled={disabled}
            onClick={() => attack(a.id)}
          >
            {busy === a.id ? <span className="spinner" /> : a.label}
          </button>
        ))}
      </div>

      <div className="mil-custom-row">
        <label className="mil-sr-only" htmlFor="mil-custom">Write your own fake narration</label>
        <input
          id="mil-custom"
          className="mil-custom-input"
          type="text"
          maxLength={CUSTOM_MAX}
          placeholder="…or write your own lie, e.g. “Pressing like Manchester City, PPDA down 400%”"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !disabled && attack("custom")}
          disabled={!matchId || noInsights}
        />
        <button
          type="button"
          className="mil-attack-button mil-attack-custom"
          disabled={disabled || !customText.trim()}
          onClick={() => attack("custom")}
          aria-label="Check my text against the fact-checker"
        >
          {busy === "custom" ? <span className="spinner" /> : "Check it"}
        </button>
      </div>
      {customText.length > CUSTOM_MAX - 40 && (
        <p className="mil-fineprint">{customText.length}/{CUSTOM_MAX}</p>
      )}

      {hint && <p className="mil-hint">{hint}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {trace ? (
        <div aria-live="polite">
          <Trace key={runId} trace={trace} />
        </div>
      ) : (
        !hint && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">🕵️</span>
            <p>Pick an attack. We'll corrupt the latest verified narration and show you exactly what the fact-checker does with it.</p>
          </div>
        )
      )}
    </section>
  );
}
