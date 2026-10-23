import { useEffect, useState } from "react";
import { fetchStats } from "../lib/api";

type Stats = Awaited<ReturnType<typeof fetchStats>>;

export function StatsBadge() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => setStats(null));
  }, []);

  if (!stats) return null;

  const tendencyPct = Math.round(stats.tendency_recovery.dominant_action_recovery_accuracy * 100);
  const groundingPct = stats.grounding.combined_pass_rate !== null
    ? Math.round(stats.grounding.combined_pass_rate * 100)
    : null;

  return (
    <div className="stats-badge" title="Computed live from this running system -- not asserted in a README. Tendency recovery: inferred player tendencies scored against the generator's own hidden ground truth. Grounding: the real pass rate from eval.grounding_check across live-run matches.">
      <span className="stats-chip">
        <strong>{tendencyPct}%</strong> tendency recovery accuracy
      </span>
      {groundingPct !== null && (
        <span className="stats-chip">
          <strong>{groundingPct}%</strong> grounding pass rate
          <span className="stats-chip-sub">({stats.grounding.sample_size} live insights)</span>
        </span>
      )}
      <span
        className="stats-chip"
        title="Deliberately corrupted narrations (fabricated numbers, wrong-but-real player names, off-topic phrasing) run through the live grounding checker on every page load -- not a static claim."
      >
        <strong>{stats.robustness.corruptions_caught}/{stats.robustness.corruptions_total}</strong> fabrications caught
        <span className="stats-chip-sub">({stats.robustness.false_positives} false positives)</span>
      </span>
      <span
        className="stats-chip"
        title={
          "Our generator's basic match stats (pressing intensity, pass completion, shot volume, possession split) "
          + "compared against small, publicly reported real-world ranges -- not our own hand-calibrated xT model, "
          + "and not a precise proprietary dataset. Reported honestly either way: "
          + stats.realism.metrics.map((m) => `${m.metric}=${m.value} (range ${m.reference_range[0]}-${m.reference_range[1]}, ${m.in_range ? "in range" : "out of range"})`).join("; ")
        }
      >
        <strong>{stats.realism.in_range_count}/{stats.realism.total_count}</strong> stats within real-world range
        <span className="stats-chip-sub">(vs. public EPL-range benchmarks)</span>
      </span>
      {stats.formation_detection.shift_detection_rate !== null && (
        <span
          className="stats-chip"
          title="Both teams independently roll a possible mid-match tactical reshuffle in our synthetic history; this is how often analyst0's formation tracker actually detects it, and how far off the detected timing typically is -- inferred purely from observed event locations, scored against the generator's own hidden shift timestamp."
        >
          <strong>{Math.round(stats.formation_detection.shift_detection_rate * 100)}%</strong> tactical shifts detected
          <span className="stats-chip-sub">
            (±{stats.formation_detection.mean_timing_error_min?.toFixed(0)}min timing)
          </span>
        </span>
      )}
    </div>
  );
}
