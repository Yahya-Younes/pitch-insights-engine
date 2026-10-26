import { useCallback, useEffect, useState } from "react";
import { fetchStats } from "../lib/api";
import { useT, type I18n } from "../i18n";
import { plural } from "../lib/panelLabels";
import "./StatsBadge.css";

type Stats = Awaited<ReturnType<typeof fetchStats>>;

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: Stats };

interface Tile {
  key: string;
  value: string;
  label: string;
  sub?: string;
  title: string;
  tone: "good" | "warn" | "neutral";
}

function metricLabel(i18n: I18n, metric: string): string {
  const key = `panels.trust.metric.${metric}`;
  const text = i18n.t(key);
  return text === key ? metric : text;
}

/** /stats explains an unavailable fine-tuned narrator in English; map the
 * known reasons to the catalog, keeping any trailing technical detail. */
function fineTuneReason(i18n: I18n, reason: string): string {
  if (reason.startsWith("no handoff log configured")) return i18n.t("panels.trust.ft.reason.noLog");
  if (reason.startsWith("no verified live insights yet")) return i18n.t("panels.trust.ft.reason.noInsights");
  if (reason.startsWith("fine-tuned deployment unreachable")) {
    const detail = reason.split("a while): ")[1] ?? "";
    return i18n.t("panels.trust.ft.reason.unreachable", { detail }).replace(/\s*:\s*$/, "");
  }
  return reason;
}

function buildTiles(i18n: I18n, stats: Stats): Tile[] {
  const { t } = i18n;
  const pct = (x: number) => i18n.pct(x, 0);
  const tiles: Tile[] = [];
  const tr = stats.tendency_recovery;
  tiles.push({
    key: "tendency",
    value: pct(tr.dominant_action_recovery_accuracy),
    label: t("panels.trust.tendency.label"),
    sub: t("panels.trust.tendency.sub", { n: tr.n_players_evaluated }),
    title: t("panels.trust.tendency.title"),
    tone: tr.dominant_action_recovery_accuracy >= 0.8 ? "good" : "warn",
  });

  const g = stats.grounding;
  tiles.push({
    key: "grounding",
    value: g.combined_pass_rate !== null ? pct(g.combined_pass_rate) : "--",
    label: t("panels.trust.grounding.label"),
    sub: t("panels.trust.grounding.sub", { n: g.sample_size }),
    title: t("panels.trust.grounding.title"),
    tone: g.combined_pass_rate === null ? "neutral" : g.combined_pass_rate >= 0.8 ? "good" : "warn",
  });

  const r = stats.robustness;
  tiles.push({
    key: "robustness",
    value: `${r.corruptions_caught}/${r.corruptions_total}`,
    label: t("panels.trust.robust.label"),
    sub: t("panels.trust.robust.sub", {
      fp: plural(i18n, "panels.trust.falsePositives", r.false_positives), rate: i18n.num(r.catch_rate, 2),
    }),
    title: t("panels.trust.robust.title"),
    tone: r.corruptions_caught === r.corruptions_total ? "good" : "warn",
  });

  const re = stats.realism;
  const src = re.real_data_source;
  tiles.push({
    key: "realism",
    value: `${re.in_range_count}/${re.total_count}`,
    label: t("panels.trust.realism.label"),
    sub: t("panels.trust.realism.sub", { n: src.n_matches }),
    title: t("panels.trust.realism.title", {
      n: src.n_matches, seasons: src.seasons_sampled_from.join(" + "),
      total: src.n_matches_available_total, attribution: src.attribution,
    }) + " " + re.metrics.map((m) => t("panels.trust.realism.metric", {
      metric: metricLabel(i18n, m.metric), value: i18n.num(m.value, 2),
      lo: i18n.num(m.reference_range[0], 2), hi: i18n.num(m.reference_range[1], 2),
      status: t(m.in_range ? "panels.trust.realism.in" : "panels.trust.realism.out"),
    })).join(t("panels.trust.listSep")),
    tone: re.in_range_count === re.total_count ? "good" : "warn",
  });

  const fd = stats.formation_detection;
  if (fd.shift_detection_rate !== null) {
    tiles.push({
      key: "formation",
      value: pct(fd.shift_detection_rate),
      label: t("panels.trust.formation.label"),
      sub: fd.mean_timing_error_min !== null
        ? t("panels.trust.formation.sub", { n: i18n.num(fd.mean_timing_error_min, 0) })
        : undefined,
      title: t("panels.trust.formation.title"),
      tone: fd.shift_detection_rate >= 0.8 ? "good" : "warn",
    });
  }

  const ft = stats.fine_tuned_narrator;
  if (ft.available) {
    tiles.push({
      key: "finetune",
      value: t(ft.fine_tuned_grounded ? "panels.trust.ft.grounded" : "panels.trust.ft.notGrounded"),
      label: t("panels.trust.ft.label"),
      sub: t("panels.trust.ft.sub", { model: ft.base_model }),
      title: t("panels.trust.ft.title", {
        model: ft.base_model, job: ft.job_id, n: ft.training_examples,
        ft: ft.fine_tuned_narration, prod: ft.production_narration,
      }),
      tone: ft.fine_tuned_grounded ? "good" : "warn",
    });
  } else {
    tiles.push({
      key: "finetune",
      value: t("panels.trust.ft.offline"),
      label: t("panels.trust.ft.label"),
      sub: t("panels.trust.ft.unavailable"),
      title: t("panels.trust.ft.offTitle", { reason: fineTuneReason(i18n, ft.reason) })
        + (ft.job_id ? t("panels.trust.ft.jobOk", { job: ft.job_id }) : ""),
      tone: "neutral",
    });
  }
  return tiles;
}

const SKELETON_COUNT = 6;

export function StatsBadge() {
  const i18n = useT();
  const { t } = i18n;
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
      <div className="trust-tiles" aria-busy="true" aria-label={t("panels.trust.loadingAria")}>
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className="trust-tile trust-tile-skeleton" aria-hidden="true">
            <span className="trust-skel trust-skel-value" />
            <span className="trust-skel trust-skel-label" />
            <span className="trust-skel trust-skel-sub" />
          </div>
        ))}
        <span className="trust-sr-only" role="status">{t("panels.trust.computing")}</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="trust-error" role="alert">
        <p>{t("panels.trust.error", { msg: state.message })}</p>
        <button type="button" className="trust-retry" onClick={retry}>{t("panels.retry")}</button>
      </div>
    );
  }

  const tiles = buildTiles(i18n, state.data);
  return (
    <ul className="trust-tiles" aria-label={t("panels.trust.listAria")}>
      {tiles.map((tile) => (
        <li key={tile.key} className={`trust-tile trust-tile-${tile.tone}`} title={tile.title}>
          <span className="trust-tile-value">{tile.value}</span>
          <span className="trust-tile-label">{tile.label}</span>
          {tile.sub && <span className="trust-tile-sub">{tile.sub}</span>}
        </li>
      ))}
    </ul>
  );
}
