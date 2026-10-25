"""Ad-hoc, time-bucketed analytics querying over one match's event stream --
lets a client ask for an arbitrary time-sliced view of the match's data on
demand (bucket size, metric), not just receive pre-packaged insights.

Built entirely from datagen's event schema and the same proven metric
primitives eval/realism_check.py and agents/analyst0/metrics.py already use
(compute_ppda, tempo_series) -- no new simulation logic, no new data store.

Honest scoping note: this buckets whatever events have already been
generated for a match (the same "generate up to `minutes`, then process"
model service/main.py's positions/tactics already use), not a truly
incrementally-growing live stream the way the in-game Event Hubs path is --
see service/eventhub_consumer.py for that genuinely real-time ingestion
path, which this module works against identically once wired in.
"""
from __future__ import annotations

from agents.analyst0.metrics import compute_ppda, tempo_series
from datagen.schema import AnyEvent


def compute_match_analytics(events: list[AnyEvent], duration_ms: int, bucket_minutes: float = 5.0) -> dict:
    """Time-buckets the match into `bucket_minutes`-wide windows and reports,
    per bucket: each team's PPDA (pressing intensity), possession split,
    shot counts, and tempo (actions/minute) -- the same metrics the realism
    scorecard and Narrator's insights are built from, just exposed as a
    queryable series instead of only a match-wide average or a one-off
    narrated moment."""
    bucket_ms = int(bucket_minutes * 60000)
    bucket_ms = max(bucket_ms, 60000)  # a sub-1-minute bucket isn't meaningful for PPDA sample sizes
    n_buckets = max(1, -(-duration_ms // bucket_ms))  # ceil division

    # tempo_series keys its (t, value) pairs by t in milliseconds, not
    # minutes -- convert to the same rounded-minute keys buckets use below,
    # or every lookup would silently miss and report tempo=None everywhere.
    raw_tempo = tempo_series(events, duration_ms, window_minutes=max(2, int(bucket_minutes)), step_minutes=int(max(1, bucket_minutes)))
    tempo = {round(t_ms / 60000, 1): value for t_ms, value in raw_tempo}

    buckets = []
    for i in range(n_buckets):
        start_ms = i * bucket_ms
        end_ms = min((i + 1) * bucket_ms, duration_ms)
        window_events = [e for e in events if start_ms <= getattr(e, "match_clock_ms", -1) < end_ms]

        touches_home = sum(1 for e in window_events if getattr(e, "team", None) == "home")
        touches_away = sum(1 for e in window_events if getattr(e, "team", None) == "away")
        total_touches = touches_home + touches_away
        possession_home_pct = round(100.0 * touches_home / total_touches, 1) if total_touches else None

        shots_home = sum(1 for e in window_events if e.type == "shot" and e.team == "home")
        shots_away = sum(1 for e in window_events if e.type == "shot" and e.team == "away")
        goals_home = sum(1 for e in window_events if e.type == "shot" and e.team == "home" and e.outcome == "goal")
        goals_away = sum(1 for e in window_events if e.type == "shot" and e.team == "away" and e.outcome == "goal")

        start_min = round(start_ms / 60000, 1)
        buckets.append({
            "start_min": start_min,
            "end_min": round(end_ms / 60000, 1),
            "home_ppda": compute_ppda(events, "home", start_ms, end_ms),
            "away_ppda": compute_ppda(events, "away", start_ms, end_ms),
            "possession_home_pct": possession_home_pct,
            "shots_home": shots_home, "shots_away": shots_away,
            "goals_home": goals_home, "goals_away": goals_away,
            "tempo_actions_per_min": tempo.get(start_min),
            "event_count": len(window_events),
        })

    return {
        "bucket_minutes": bucket_minutes,
        "n_buckets": len(buckets),
        "buckets": buckets,
        "method": f"{bucket_minutes}-minute buckets over the match's already-generated event stream; "
                  "PPDA/possession/shots/goals counted per bucket, tempo from the same rolling z-score "
                  "series the rhythm_change insight trigger uses -- ad-hoc queryable analytics over the "
                  "same underlying data the narrated insights come from, not a separate claim.",
    }
