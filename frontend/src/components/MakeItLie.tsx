import { useEffect, useState } from "react";
import {
  fetchVerificationHeadline, tamperNarration,
  type GroundingReasons, type TamperAttack, type TamperTrace, type VerificationHeadline,
} from "../lib/makeItLieApi";
import { frNum } from "../lib/frLabels";
import "./MakeItLie.css";

interface Props {
  matchId: string | null;
  /** Number of insights shipped so far; 0 disables the attacks with a hint. */
  insightCount?: number;
}

const CUSTOM_MAX = 300;

const ATTACKS: { id: Exclude<TamperAttack, "custom">; label: string; hint: string }[] = [
  { id: "fake_number", label: "Faux chiffre", hint: "Remplace la stat principale par une valeur que le match n'a jamais produite" },
  { id: "wrong_player", label: "Mauvais joueur", hint: "Glisse un vrai joueur du match qui n'était pas impliqué" },
  { id: "real_club_leak", label: "Club réel", hint: "Cite un vrai club de Premier League" },
];

const ATTACK_NAMES: Record<TamperAttack, string> = {
  fake_number: "faux chiffre", wrong_player: "mauvais joueur", real_club_leak: "club réel", custom: "ton texte",
};

/** French labels for the red-team suite's attack families (eval/make_it_lie._VARIANT_LABELS). */
const VARIANT_FR: Record<string, string> = {
  fabricated_percentage: "Pic de pourcentage inventé",
  wrong_player: "Vrai joueur de l'effectif, mauvais moment",
  fabricated_count: "Total de saison inventé",
  inflated_metric: "Stat principale gonflée ×1000",
  real_world_leak: "Club ou joueur réel cité",
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
    ...r.unmatched_numbers.map((n) => ({ kind: "number", text: `chiffre inventé : ${n}` })),
    ...r.unmatched_entities.map((n) => ({ kind: "player", text: `mauvais joueur : ${n}` })),
    ...r.real_world_leaks.map((n) => ({ kind: "leak", text: `nom réel cité : ${n}` })),
    ...(r.off_topic ? [{ kind: "topic", text: "hors sujet pour ce déclencheur" }] : []),
  ];
}

function pct(x: number): string {
  return frNum(x, 2);
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

  if (error) return <p className="error mil-headline-error" role="alert">Bilan de vérification indisponible : {error}</p>;
  if (!data) {
    return (
      <div className="mil-headline mil-headline-loading" aria-busy="true">
        <span className="spinner" /> Lancement de la batterie d'attaques…
      </div>
    );
  }
  const breakdown = data.by_attack.map((a) => `${VARIANT_FR[a.attack] ?? a.label} : ${a.caught}/${a.planted}`).join("\n");
  return (
    <div className="mil-headline" role="status" aria-label="Bilan de la vérification des faits" title={breakdown}>
      <span className="mil-headline-main">
        <strong>{data.caught}/{data.planted}</strong> erreurs plantées détectées
      </span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span className={data.reached_air === 0 ? "mil-headline-good" : "mil-headline-bad"}>
        <strong>{data.reached_air}</strong> diffusée{data.reached_air > 1 ? "s" : ""}
      </span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span>précision <strong>{pct(data.precision)}</strong></span>
      <span className="mil-dot" aria-hidden="true">·</span>
      <span>rappel <strong>{pct(data.recall)}</strong></span>
      <span className="mil-headline-sub">
        {data.false_positives}/{data.clean_tested} phrases correctes rejetées à tort · recalculé en direct, sans LLM
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
    <ol className="mil-trace" aria-label="Trace de vérification">
      <li className="mil-step" style={{ animationDelay: "0ms" }}>
        <span className="mil-step-num" aria-hidden="true">1</span>
        <div className="mil-step-body">
          <p className="mil-step-title">Narration falsifiée <span className="mil-attack-tag">{ATTACK_NAMES[trace.attack]}</span></p>
          {!isCustom && (
            <p className="mil-text mil-text-original">
              <span className="mil-label">avant</span>
              <Highlighted diff={diff.removed} variant="removed" />
            </p>
          )}
          <p className="mil-text mil-text-tampered">
            <span className="mil-label">{isCustom ? "tu as écrit" : "après"}</span>
            {isCustom ? trace.tampered_text : <Highlighted diff={diff.added} variant="added" />}
          </p>
        </div>
      </li>

      <li className="mil-step" style={{ animationDelay: "450ms" }}>
        <span className="mil-step-num" aria-hidden="true">2</span>
        <div className="mil-step-body">
          <p className="mil-step-title">
            Contrôle d'ancrage en direct
            <span className={`mil-verdict ${rejected ? "mil-verdict-rejected" : "mil-verdict-passed"}`}>
              {rejected ? "REJETÉ" : "VALIDÉ"}
            </span>
          </p>
          {rejected ? (
            <ul className="mil-chips" aria-label="Motifs du rejet">
              {chips.map((c) => <li key={`${c.kind}-${c.text}`} className={`mil-chip mil-chip-${c.kind}`}>{c.text}</li>)}
            </ul>
          ) : (
            <p className="mil-note">
              Chaque chiffre, nom de joueur et mot-clé du sujet remonte à l'insight, et aucun nom réel
              n'a été trouvé : le vérificateur l'a donc laissé passer.
            </p>
          )}
          <p className="mil-fineprint"><code>{trace.checker}</code> -- la même fonction que le Narrateur exécute sur chaque insight.</p>
        </div>
      </li>

      <li className="mil-step" style={{ animationDelay: "900ms" }}>
        <span className="mil-step-num" aria-hidden="true">3</span>
        <div className="mil-step-body">
          {trace.shipped === "corrected" && trace.corrected_text ? (
            <>
              <p className="mil-step-title">
                Ce qui passe réellement à l'antenne
                <span className="mil-verdict mil-verdict-shipped">DIFFUSÉ</span>
                {trace.corrected_verdict === "passed" && <span className="verify-badge verify-badge-ok">✓ revérifié</span>}
              </p>
              <p className="mil-text mil-text-shipped">{trace.corrected_text}</p>
              <p className="mil-fineprint">Repli déterministe construit uniquement à partir des champs de l'insight -- aucun appel au modèle.</p>
            </>
          ) : (
            <>
              <p className="mil-step-title">
                Ce qui passe réellement à l'antenne
                <span className="mil-verdict mil-verdict-warn">DIFFUSÉ TEL QUEL</span>
              </p>
              <p className="mil-text">{trace.tampered_text}</p>
              <p className="mil-note mil-note-honest">
                Résultat honnête : celui-ci est passé. Le vérificateur contrôle les chiffres (à ±0,6 près), les noms
                de l'effectif, les mots-clés du sujet et une liste de noms réels interdits -- pas le sens. De petites
                retouches ou des affirmations sans chiffre ni nom peuvent passer.
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
    ? "Lance d'abord un match, puis essaie de glisser un mensonge au vérificateur."
    : noInsights ? "En attente du premier insight vérifié à falsifier…" : null;

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
        <h2 id="mil-title">Essaie de le faire mentir</h2>
        <span className="panel-tag">vérification en direct · sans LLM</span>
      </div>

      <Headline />

      <div className="mil-attacks" role="group" aria-label="Choisis une attaque">
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
        <label className="mil-sr-only" htmlFor="mil-custom">Écris ta propre fausse narration</label>
        <input
          id="mil-custom"
          className="mil-custom-input"
          type="text"
          maxLength={CUSTOM_MAX}
          placeholder="…ou écris ton propre mensonge, ex. « Un pressing digne de Manchester City, PPDA en baisse de 400 % »"
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
          aria-label="Soumettre mon texte au vérificateur"
        >
          {busy === "custom" ? <span className="spinner" /> : "Vérifier"}
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
            <p>Choisis une attaque : on falsifie la dernière narration vérifiée et on te montre exactement ce qu'en fait le vérificateur.</p>
          </div>
        )
      )}
    </section>
  );
}
