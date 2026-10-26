import { useEffect, useState } from "react";
import {
  fetchVerificationHeadline, tamperNarration,
  type GroundingReasons, type TamperAttack, type TamperTrace, type VerificationHeadline,
} from "../lib/makeItLieApi";
import { useT, type I18n } from "../i18n";
import { plural } from "../lib/panelLabels";
import "./MakeItLie.css";

interface Props {
  matchId: string | null;
  /** Number of insights shipped so far; 0 disables the attacks with a hint. */
  insightCount?: number;
}

const CUSTOM_MAX = 300;

const ATTACKS: Exclude<TamperAttack, "custom">[] = ["fake_number", "wrong_player", "real_club_leak"];

/** Red-team suite attack families (eval/make_it_lie._VARIANT_LABELS). */
const VARIANTS = new Set(["fabricated_percentage", "wrong_player", "fabricated_count", "inflated_metric", "real_world_leak"]);

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

function reasonChips(i18n: I18n, r: GroundingReasons): { kind: string; text: string }[] {
  const { t } = i18n;
  return [
    ...r.unmatched_numbers.map((n) => ({ kind: "number", text: t("agents.mil.chip.number", { v: n }) })),
    ...r.unmatched_entities.map((n) => ({ kind: "player", text: t("agents.mil.chip.player", { v: n }) })),
    ...r.real_world_leaks.map((n) => ({ kind: "leak", text: t("agents.mil.chip.leak", { v: n }) })),
    ...(r.off_topic ? [{ kind: "topic", text: t("agents.mil.chip.topic") }] : []),
  ];
}

function Headline() {
  const i18n = useT();
  const { t } = i18n;
  const [data, setData] = useState<VerificationHeadline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchVerificationHeadline()
      .then((h) => { if (alive) setData(h); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  if (error) return <p className="error mil-headline-error" role="alert">{t("agents.mil.headline.error", { error })}</p>;
  if (!data) {
    return (
      <div className="mil-headline mil-headline-loading" aria-busy="true">
        <span className="spinner" /> {t("agents.mil.headline.loading")}
      </div>
    );
  }
  const breakdown = data.by_attack.map((a) => t("agents.mil.headline.breakdownRow", {
    label: VARIANTS.has(a.attack) ? t(`agents.mil.variant.${a.attack}`) : a.label, caught: a.caught, planted: a.planted,
  })).join("\n");
  return (
    <div className="mil-headline" role="status" aria-label={t("agents.mil.headline.aria")} title={breakdown}>
      <span className="mil-headline-main">
        <strong>{data.caught}/{data.planted}</strong> {t("agents.mil.headline.caught")}
      </span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span className={data.reached_air === 0 ? "mil-headline-good" : "mil-headline-bad"}>
        <strong>{data.reached_air}</strong> {plural(i18n, "agents.mil.headline.aired", data.reached_air)}
      </span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span>{t("agents.mil.headline.precision")} <strong>{i18n.num(data.precision, 2)}</strong></span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span>{t("agents.mil.headline.recall")} <strong>{i18n.num(data.recall, 2)}</strong></span>
      <span className="mil-headline-sub">
        {t("agents.mil.headline.sub", { fp: data.false_positives, clean: data.clean_tested })}
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
  const i18n = useT();
  const { t } = i18n;
  const diff = diffAgainst(trace.original_text, trace.tampered_text);
  const rejected = trace.verdict === "rejected";
  const chips = reasonChips(i18n, trace.reasons);
  const isCustom = trace.attack === "custom";

  return (
    <ol className="mil-trace" aria-label={t("agents.mil.trace.aria")}>
      <li className="mil-step" style={{ animationDelay: "0ms" }}>
        <span className="mil-step-num" aria-hidden="true">1</span>
        <div className="mil-step-body">
          <p className="mil-step-title">
            {t("agents.mil.trace.step1")} <span className="mil-attack-tag">{t(`agents.mil.attackName.${trace.attack}`)}</span>
          </p>
          {!isCustom && (
            <p className="mil-text mil-text-original">
              <span className="mil-label">{t("agents.mil.trace.before")}</span>
              <Highlighted diff={diff.removed} variant="removed" />
            </p>
          )}
          <p className="mil-text mil-text-tampered">
            <span className="mil-label">{t(isCustom ? "agents.mil.trace.youWrote" : "agents.mil.trace.after")}</span>
            {isCustom ? trace.tampered_text : <Highlighted diff={diff.added} variant="added" />}
          </p>
        </div>
      </li>

      <li className="mil-step" style={{ animationDelay: "450ms" }}>
        <span className="mil-step-num" aria-hidden="true">2</span>
        <div className="mil-step-body">
          <p className="mil-step-title">
            {t("agents.mil.trace.step2")}
            <span className={`mil-verdict ${rejected ? "mil-verdict-rejected" : "mil-verdict-passed"}`}>
              {t(rejected ? "agents.mil.trace.rejected" : "agents.mil.trace.passed")}
            </span>
          </p>
          {rejected ? (
            <ul className="mil-chips" aria-label={t("agents.mil.trace.reasonsAria")}>
              {chips.map((c) => <li key={`${c.kind}-${c.text}`} className={`mil-chip mil-chip-${c.kind}`}>{c.text}</li>)}
            </ul>
          ) : (
            <p className="mil-note">{t("agents.mil.trace.passedNote")}</p>
          )}
          <p className="mil-fineprint"><code>{trace.checker}</code> {t("agents.mil.trace.checkerNote")}</p>
        </div>
      </li>

      <li className="mil-step" style={{ animationDelay: "900ms" }}>
        <span className="mil-step-num" aria-hidden="true">3</span>
        <div className="mil-step-body">
          {trace.shipped === "corrected" && trace.corrected_text ? (
            <>
              <p className="mil-step-title">
                {t("agents.mil.trace.step3")}
                <span className="mil-verdict mil-verdict-shipped">{t("agents.mil.trace.shipped")}</span>
                {trace.corrected_verdict === "passed" && (
                  <span className="verify-badge verify-badge-ok">{t("agents.mil.trace.reverified")}</span>
                )}
              </p>
              <p className="mil-text mil-text-shipped">{trace.corrected_text}</p>
              <p className="mil-fineprint">{t("agents.mil.trace.fallbackNote")}</p>
            </>
          ) : (
            <>
              <p className="mil-step-title">
                {t("agents.mil.trace.step3")}
                <span className="mil-verdict mil-verdict-warn">{t("agents.mil.trace.shippedAsIs")}</span>
              </p>
              <p className="mil-text">{trace.tampered_text}</p>
              <p className="mil-note mil-note-honest">{t("agents.mil.trace.honest", { tol: i18n.num(0.6, 1) })}</p>
            </>
          )}
        </div>
      </li>
    </ol>
  );
}

export function MakeItLie({ matchId, insightCount }: Props) {
  const { t } = useT();
  const [customText, setCustomText] = useState("");
  const [trace, setTrace] = useState<TamperTrace | null>(null);
  const [runId, setRunId] = useState(0);
  const [busy, setBusy] = useState<TamperAttack | null>(null);
  const [error, setError] = useState<string | null>(null);

  const noInsights = insightCount !== undefined && insightCount === 0;
  const disabled = !matchId || noInsights || busy !== null;
  const hint = !matchId
    ? t("agents.mil.hintNoMatch")
    : noInsights ? t("agents.mil.hintWaiting") : null;

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
        <h2 id="mil-title">{t("agents.mil.title")}</h2>
        <span className="panel-tag">{t("agents.mil.tag")}</span>
      </div>

      <Headline />

      <div className="mil-attacks" role="group" aria-label={t("agents.mil.attacksAria")}>
        {ATTACKS.map((id) => {
          const label = t(`agents.mil.attack.${id}.label`);
          const hintText = t(`agents.mil.attack.${id}.hint`);
          return (
            <button
              key={id}
              type="button"
              className="mil-attack-button"
              title={hintText}
              aria-label={t("agents.mil.attackAria", { label, hint: hintText })}
              disabled={disabled}
              onClick={() => attack(id)}
            >
              {busy === id ? <span className="spinner" /> : label}
            </button>
          );
        })}
      </div>

      <div className="mil-custom-row">
        <label className="mil-sr-only" htmlFor="mil-custom">{t("agents.mil.customLabel")}</label>
        <input
          id="mil-custom"
          className="mil-custom-input"
          type="text"
          maxLength={CUSTOM_MAX}
          placeholder={t("agents.mil.placeholder")}
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
          aria-label={t("agents.mil.submitAria")}
        >
          {busy === "custom" ? <span className="spinner" /> : t("agents.mil.verify")}
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
            <p>{t("agents.mil.empty")}</p>
          </div>
        )
      )}
    </section>
  );
}
