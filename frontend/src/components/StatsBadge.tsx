import { useCallback, useEffect, useState } from "react";
import { fetchStats } from "../lib/api";
import { frNum } from "../lib/frLabels";
import "./StatsBadge.css";

type Stats = Awaited<ReturnType<typeof fetchStats>>;

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: Stats };

const METRIC_FR: Record<string, string> = {
  ppda: "PPDA",
  pass_completion_pct: "réussite des passes (%)",
  shots_per_team: "tirs par équipe",
  possession_pct: "possession (%)",
};

interface Tile {
  key: string;
  value: string;
  label: string;
  sub?: string;
  title: string;
  tone: "good" | "warn" | "neutral";
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

function buildTiles(stats: Stats): Tile[] {
  const tiles: Tile[] = [];
  const tr = stats.tendency_recovery;
  tiles.push({
    key: "tendency",
    value: pct(tr.dominant_action_recovery_accuracy),
    label: "Récupération des tendances",
    sub: `${tr.n_players_evaluated} joueurs évalués`,
    title: "Tendances des joueurs déduites des matchs simulés, comparées à la vérité cachée du générateur "
      + "(inférence par fréquences, sans entraînement ML).",
    tone: tr.dominant_action_recovery_accuracy >= 0.8 ? "good" : "warn",
  });

  const g = stats.grounding;
  tiles.push({
    key: "grounding",
    value: g.combined_pass_rate !== null ? pct(g.combined_pass_rate) : "--",
    label: "Taux d'ancrage validé",
    sub: `${g.sample_size} insights en direct`,
    title: "Part réelle des textes du narrateur et du concierge qui passent le contrôle d'ancrage "
      + "(eval.grounding_check) sur les derniers matchs joués.",
    tone: g.combined_pass_rate === null ? "neutral" : g.combined_pass_rate >= 0.8 ? "good" : "warn",
  });

  const r = stats.robustness;
  tiles.push({
    key: "robustness",
    value: `${r.corruptions_caught}/${r.corruptions_total}`,
    label: "Fausses infos détectées",
    sub: `${r.false_positives} faux positif${r.false_positives > 1 ? "s" : ""} · taux ${frNum(r.catch_rate, 2)}`,
    title: "Narrations volontairement corrompues (chiffres inventés, mauvais joueur réel, hors sujet) "
      + "passées au vérificateur en direct à chaque chargement -- pas une affirmation figée.",
    tone: r.corruptions_caught === r.corruptions_total ? "good" : "warn",
  });

  const re = stats.realism;
  const src = re.real_data_source;
  tiles.push({
    key: "realism",
    value: `${re.in_range_count}/${re.total_count}`,
    label: "Stats dans la fourchette réelle",
    sub: `${src.n_matches} matchs PL réels · StatsBomb`,
    title: `Stats de base du générateur comparées à la fourchette min-max observée sur ${src.n_matches} matchs réels `
      + `(${src.seasons_sampled_from.join(" + ")}, tirés de ${src.n_matches_available_total}) -- ${src.attribution}. `
      + re.metrics.map((m) =>
        `${METRIC_FR[m.metric] ?? m.metric} = ${frNum(m.value, 2)} (fourchette ${frNum(m.reference_range[0], 2)}–${frNum(m.reference_range[1], 2)}, `
        + `${m.in_range ? "dans la fourchette" : "hors fourchette"})`).join(" ; "),
    tone: re.in_range_count === re.total_count ? "good" : "warn",
  });

  const fd = stats.formation_detection;
  if (fd.shift_detection_rate !== null) {
    tiles.push({
      key: "formation",
      value: pct(fd.shift_detection_rate),
      label: "Changements tactiques détectés",
      sub: fd.mean_timing_error_min !== null ? `±${frNum(fd.mean_timing_error_min, 0)} min d'écart` : undefined,
      title: "Fréquence à laquelle le suivi de formation détecte le changement tactique caché d'une équipe, "
        + "déduit uniquement des positions observées. Les changements synthétiques sont nets : l'écart de timing "
        + "moyen est le chiffre le plus parlant.",
      tone: fd.shift_detection_rate >= 0.8 ? "good" : "warn",
    });
  }

  const ft = stats.fine_tuned_narrator;
  if (ft.available) {
    tiles.push({
      key: "finetune",
      value: ft.fine_tuned_grounded ? "Ancré" : "Non ancré",
      label: "Narrateur affiné",
      sub: `échantillon live · ${ft.base_model}`,
      title: `${ft.base_model} affiné (job ${ft.job_id}, ${ft.training_examples} exemples auto-distillés). `
        + `Dernier insight vérifié, raconté à l'instant et revérifié : « ${ft.fine_tuned_narration} » `
        + `-- production : « ${ft.production_narration} »`,
      tone: ft.fine_tuned_grounded ? "good" : "warn",
    });
  } else {
    tiles.push({
      key: "finetune",
      value: "Hors ligne",
      label: "Narrateur affiné",
      sub: "indisponible pour le moment",
      title: `Comparaison du narrateur affiné indisponible : ${ft.reason}`
        + (ft.job_id ? ` (job d'entraînement ${ft.job_id} réussi)` : ""),
      tone: "neutral",
    });
  }
  return tiles;
}

const SKELETON_COUNT = 6;

export function StatsBadge() {
  const [state, setState] = useState<Load>({ status: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    // The very first /stats call computes the history-based figures (several
    // simulated matches) and can take a while; never render nothing meanwhile.
    fetchStats()
      .then((data) => { if (alive) setState({ status: "ok", data }); })
      .catch((e: unknown) => {
        if (alive) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => { alive = false; };
  }, [reload]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setReload((n) => n + 1);
  }, []);

  if (state.status === "loading") {
    return (
      <div className="trust-tiles" aria-busy="true" aria-label="Chargement des chiffres de confiance">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className="trust-tile trust-tile-skeleton" aria-hidden="true">
            <span className="trust-skel trust-skel-value" />
            <span className="trust-skel trust-skel-label" />
            <span className="trust-skel trust-skel-sub" />
          </div>
        ))}
        <span className="trust-sr-only" role="status">Calcul des chiffres en direct…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="trust-error" role="alert">
        <p>Impossible de charger les chiffres de confiance ({state.message}).</p>
        <button type="button" className="trust-retry" onClick={retry}>Réessayer</button>
      </div>
    );
  }

  const tiles = buildTiles(state.data);
  return (
    <ul className="trust-tiles" aria-label="Chiffres de confiance mesurés en direct">
      {tiles.map((t) => (
        <li key={t.key} className={`trust-tile trust-tile-${t.tone}`} title={t.title}>
          <span className="trust-tile-value">{t.value}</span>
          <span className="trust-tile-label">{t.label}</span>
          {t.sub && <span className="trust-tile-sub">{t.sub}</span>}
        </li>
      ))}
    </ul>
  );
}
