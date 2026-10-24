"""One-off tool: computes real-match reference aggregates from StatsBomb
Open Data and writes the small, committed summary eval/real_data_validation
loads at runtime -- replacing eval/realism_check.py's old hand-typed
REAL_WORLD_REFERENCE_RANGES with numbers computed directly from real
Premier League matches.

Data source: StatsBomb Open Data (https://github.com/statsbomb/open-data),
free for research/non-commercial use under StatsBomb's Open Data user
agreement (attribution required -- see eval/real_data_validation.py).
Samples match events from two fully-released Premier League seasons:
  - 2015/16 (competition_id=2, season_id=27) -- 380 matches available
  - 2003/04 (competition_id=2, season_id=44) -- 38 matches available
A fixed-size random sample (not the full 418) is downloaded to keep this
reproducible in a few minutes rather than requiring a ~1.3GB one-time pull;
N_SAMPLE below controls the size.

The raw per-match StatsBomb event JSON is NOT committed to this repo (too
large, and redistributing their full dataset isn't necessary) -- only the
small aggregate summary this script produces is. Re-run this script anytime
to regenerate that summary from a fresh sample.

Usage: python -m tools.fetch_real_data_validation [n_sample] [seed]
"""
from __future__ import annotations

import json
import random
import statistics
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "eval" / "real_data_cache" / "pl_reference.json"

_RAW_BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
_SEASONS = [
    {"competition_id": 2, "season_id": 27, "label": "Premier League 2015/16"},
    {"competition_id": 2, "season_id": 44, "label": "Premier League 2003/04"},
]
# Deliberately excludes StatsBomb's "Pressure" event type: that's logged any
# time a player closes down the ball (hundreds per match), far more often
# than a real defensive action -- including it collapses PPDA to ~2 instead
# of the real, widely-reported 6-18 range. The actual Trainor PPDA formula
# predates that granular event type and counts discrete defensive actions
# only: tackles, interceptions, and fouls committed in the press zone.
_DEFENSIVE_ACTION_TYPES = {"Interception", "Foul Committed"}
_EVENTS_CACHE_DIR = OUT_PATH.parent / "_raw_events_cache"  # gitignored -- see eval/real_data_cache/.gitignore


def _fetch_json(url: str) -> object:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_match_events(match_id: int) -> list[dict]:
    """Cached fetch -- lets _compute_match_aggregates's formula be iterated
    on without re-downloading the same ~3MB match file every time."""
    _EVENTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = _EVENTS_CACHE_DIR / f"{match_id}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    events = _fetch_json(f"{_RAW_BASE}/events/{match_id}.json")
    cache_path.write_text(json.dumps(events), encoding="utf-8")
    return events


def _is_tackle(e: dict) -> bool:
    return e["type"]["name"] == "Duel" and e.get("duel", {}).get("type", {}).get("name") == "Tackle"


def _compute_match_aggregates(events: list[dict]) -> dict[str, float] | None:
    """Mirrors eval.realism_check.compute_match_aggregates's four metrics,
    computed from StatsBomb's real event schema instead of our synthetic
    one. StatsBomb normalizes event location so x always increases toward
    the acting team's own attacking goal (confirmed empirically: a sample
    match's shot locations average ~x=100 for both teams in both playing
    periods) -- so, unlike our own schema, no home/away direction flip is
    needed: each team's own defensive 60% is always x in [0, 72]."""
    teams = sorted({e["team"]["name"] for e in events if "team" in e})
    if len(teams) != 2:
        return None
    team_a, team_b = teams

    passes = [e for e in events if e["type"]["name"] == "Pass"]
    if not passes:
        return None
    completed = [p for p in passes if "outcome" not in p.get("pass", {})]
    pass_completion_pct = round(100.0 * len(completed) / len(passes), 1)

    shots_a = sum(1 for e in events if e["type"]["name"] == "Shot" and e["team"]["name"] == team_a)
    shots_b = sum(1 for e in events if e["type"]["name"] == "Shot" and e["team"]["name"] == team_b)
    shots_per_team = round((shots_a + shots_b) / 2, 1)

    touches_a = sum(1 for e in events if e.get("team", {}).get("name") == team_a)
    touches_b = sum(1 for e in events if e.get("team", {}).get("name") == team_b)
    total_touches = touches_a + touches_b
    possession_pct = round(100.0 * touches_a / total_touches, 1) if total_touches else 50.0

    def _ppda_for(pressing: str, opponent: str) -> float | None:
        opponent_passes = sum(
            1 for e in events
            if e["type"]["name"] == "Pass" and e["team"]["name"] == opponent
            and e.get("location") and e["location"][0] <= 72.0
        )
        defensive_actions = sum(
            1 for e in events
            if e["team"]["name"] == pressing and e.get("location") and e["location"][0] <= 72.0
            and (e["type"]["name"] in _DEFENSIVE_ACTION_TYPES or _is_tackle(e))
        )
        if opponent_passes == 0 and defensive_actions == 0:
            return None
        return opponent_passes / max(1, defensive_actions)

    ppda_values = [v for v in (_ppda_for(team_a, team_b), _ppda_for(team_b, team_a)) if v is not None]
    ppda = round(sum(ppda_values) / len(ppda_values), 2) if ppda_values else None
    if ppda is None:
        return None

    return {
        "ppda": ppda, "pass_completion_pct": pass_completion_pct,
        "shots_per_team": shots_per_team, "possession_pct": possession_pct,
    }


def main(n_sample: int, seed: int) -> None:
    rng = random.Random(seed)
    all_match_ids: list[tuple[int, str]] = []
    for season in _SEASONS:
        url = f"{_RAW_BASE}/matches/{season['competition_id']}/{season['season_id']}.json"
        matches = _fetch_json(url)
        for m in matches:
            all_match_ids.append((m["match_id"], season["label"]))
        print(f"{season['label']}: {len(matches)} matches available")

    sample = rng.sample(all_match_ids, min(n_sample, len(all_match_ids)))
    print(f"sampling {len(sample)} matches total")

    per_match: list[dict] = []
    for i, (match_id, season_label) in enumerate(sample):
        try:
            events = _fetch_match_events(match_id)
            agg = _compute_match_aggregates(events)
        except Exception as exc:
            print(f"  [{i+1}/{len(sample)}] match {match_id} failed: {exc!r} -- skipping")
            continue
        if agg is None:
            print(f"  [{i+1}/{len(sample)}] match {match_id} ({season_label}): insufficient data -- skipping")
            continue
        per_match.append({**agg, "match_id": match_id, "season": season_label})
        print(f"  [{i+1}/{len(sample)}] match {match_id} ({season_label}): {agg}")
        time.sleep(0.15)  # polite to GitHub's raw content host, not a hard rate limit requirement

    metrics = ["ppda", "pass_completion_pct", "shots_per_team", "possession_pct"]
    summary = {}
    for metric in metrics:
        values = [m[metric] for m in per_match]
        summary[metric] = {
            "mean": round(statistics.mean(values), 2),
            "stdev": round(statistics.stdev(values), 2) if len(values) > 1 else 0.0,
            "min": round(min(values), 2),
            "max": round(max(values), 2),
        }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({
        "source": "StatsBomb Open Data (https://github.com/statsbomb/open-data)",
        "attribution": "Data courtesy of StatsBomb (https://statsbomb.com/what-we-do/hub/free-data/)",
        "seasons_sampled_from": [s["label"] for s in _SEASONS],
        "n_matches": len(per_match),
        "n_matches_available_total": len(all_match_ids),
        "match_ids": [m["match_id"] for m in per_match],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "metrics": summary,
    }, indent=2), encoding="utf-8")
    print(f"\nwrote {len(per_match)}-match summary to {OUT_PATH}")
    for metric, s in summary.items():
        print(f"  {metric}: mean={s['mean']} stdev={s['stdev']} range=[{s['min']}, {s['max']}]")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 20151527
    main(n, seed)
