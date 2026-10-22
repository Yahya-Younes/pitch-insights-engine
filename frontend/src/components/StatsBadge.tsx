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
    </div>
  );
}
