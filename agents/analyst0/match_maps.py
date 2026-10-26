"""Match Maps: defensive "threat prevented", shot map and pass network.

Pure, deterministic functions over one match's on-pitch event list (the
same pydantic events service/main.py keeps in STATE["events_by_match"]).
Plain dicts are accepted too, so callers can pass `model_dump()` output.

Threat prevented
----------------
Every ball-winning defensive action is credited with the Expected Threat
(xT) the *attacking* team held at that spot just before losing the ball,
using the existing Markov xT grid in agents/analyst0/metrics.py (no second
model). Orientation matters: a home defender winning the ball at x=8 is
valued as the away team's xT at x=8 (right next to the goal away attacks),
which is high -- not home's own-box xT, which is near zero.

What counts, given what datagen/schema.py actually emits:
  * interception -- valued at the intended destination of the intercepted
    pass (the most recent opposing pass in the same possession) when one is
    found, else at the interception location;
  * tackle with outcome "won".
Not counted: aerial duels (in the simulator a won duel doesn't reliably mean
possession changed hands), blocked shots (the shot event names no blocker),
and clearances/blocks (no such event types exist in the schema).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from agents.analyst0.metrics import direction_of, opponent_of, xt_value

TEAMS = ("home", "away")
TOP_MOMENTS = 5


def _get(event: Any, key: str, default: Any = None) -> Any:
    if isinstance(event, dict):
        return event.get(key, default)
    return getattr(event, key, default)


def _loc(value: Any) -> tuple[float, float]:
    return (float(value[0]), float(value[1]))


def _team_names(events: list[Any]) -> dict[str, str]:
    names = {"home": "Home", "away": "Away"}
    seen: set[str] = set()
    for e in events:
        team = _get(e, "team")
        if team in names and team not in seen and _get(e, "team_name"):
            names[team] = str(_get(e, "team_name"))
            seen.add(team)
        if len(seen) == 2:
            break
    return names


def _name(event: Any, player_names: dict[str, str] | None) -> str:
    pid = str(_get(event, "player_id", ""))
    return (player_names or {}).get(pid) or str(_get(event, "player_name") or pid)


# Public names for sibling modules (e.g. player_graph.py) -- same functions.
event_field = _get
event_location = _loc
player_label = _name


# ---------------------------------------------------------------------------
# Threat prevented
# ---------------------------------------------------------------------------

def _intercepted_pass_target(events: list[Any], idx: int) -> tuple[float, float] | None:
    """End location of the opposing pass this interception cut out, if any:
    walk back within the same possession to the latest pass by the other team."""
    interceptor_team = _get(events[idx], "team")
    possession = _get(events[idx], "possession_id")
    for j in range(idx - 1, -1, -1):
        prev = events[j]
        if _get(prev, "possession_id") != possession:
            return None
        if _get(prev, "type") == "pass" and _get(prev, "team") != interceptor_team:
            return _loc(_get(prev, "end_location"))
    return None


def compute_threat_prevented(events: list[Any], player_names: dict[str, str] | None = None) -> dict:
    team_names = _team_names(events)
    moments: list[dict] = []
    for idx, e in enumerate(events):
        etype = _get(e, "type")
        if etype == "interception":
            target = _intercepted_pass_target(events, idx)
            valued_at = target if target is not None else _loc(_get(e, "location"))
            basis = "intended pass destination" if target is not None else "interception location"
        elif etype == "tackle" and _get(e, "outcome") == "won":
            valued_at = _loc(_get(e, "location"))
            basis = "tackle location"
        else:
            continue
        team = _get(e, "team")
        if team not in TEAMS:
            continue
        attacking = opponent_of(team)
        value = xt_value(valued_at, direction_of(attacking))
        moments.append({
            "event_id": str(_get(e, "event_id", "")),
            "action": etype,
            "team": team,
            "player_id": str(_get(e, "player_id", "")),
            "player_name": _name(e, player_names),
            "minute": int(_get(e, "minute", 0)),
            "second": int(_get(e, "second", 0)),
            "location": list(_loc(_get(e, "location"))),
            "valued_at": list(valued_at),
            "basis": basis,
            "xt_prevented": round(value, 4),
            "_raw": value,
        })

    teams = {t: {"team_name": team_names[t], "xt_prevented": 0.0, "actions": 0} for t in TEAMS}
    players: dict[str, dict] = {}
    by_action: dict[str, int] = defaultdict(int)
    total = 0.0
    for m in moments:
        raw = m.pop("_raw")
        total += raw
        teams[m["team"]]["xt_prevented"] += raw
        teams[m["team"]]["actions"] += 1
        by_action[m["action"]] += 1
        p = players.setdefault(m["player_id"], {
            "player_id": m["player_id"], "player_name": m["player_name"], "team": m["team"],
            "xt_prevented": 0.0, "actions": 0, "interceptions": 0, "tackles_won": 0,
        })
        p["xt_prevented"] += raw
        p["actions"] += 1
        p["interceptions" if m["action"] == "interception" else "tackles_won"] += 1

    for t in teams.values():
        t["xt_prevented"] = round(t["xt_prevented"], 4)
    player_rows = sorted(players.values(), key=lambda p: (-p["xt_prevented"], p["player_id"]))
    for p in player_rows:
        p["xt_prevented"] = round(p["xt_prevented"], 4)
    top = sorted(moments, key=lambda m: (-m["xt_prevented"], m["minute"], m["second"]))[:TOP_MOMENTS]

    return {
        "teams": teams,
        "players": player_rows,
        "top_moments": top,
        "moments": moments,
        "n_actions": len(moments),
        "by_action": dict(by_action),
        "all_moments_total": round(total, 4),
        "method": (
            "Each interception / won tackle is credited with the xT the attacking side held where the ball "
            "was won (for interceptions: the intercepted pass's intended destination), read off the "
            "deterministic Markov xT grid used across the analytics. Aerial duels, blocked shots and "
            "clearances are not counted: the event stream doesn't attribute them cleanly."
        ),
    }


# ---------------------------------------------------------------------------
# Shot map
# ---------------------------------------------------------------------------

def compute_shot_map(events: list[Any], player_names: dict[str, str] | None = None) -> dict:
    team_names = _team_names(events)
    shots: list[dict] = []
    xg_raw = {t: 0.0 for t in TEAMS}
    teams = {t: {"shots": 0, "xg": 0.0, "goals": 0, "on_target": 0, "team_name": team_names[t]} for t in TEAMS}
    for e in events:
        if _get(e, "type") != "shot" or _get(e, "team") not in TEAMS:
            continue
        team = _get(e, "team")
        outcome = str(_get(e, "outcome"))
        xg = float(_get(e, "xg", 0.0))
        shots.append({
            "event_id": str(_get(e, "event_id", "")),
            "team": team,
            "player_id": str(_get(e, "player_id", "")),
            "player_name": _name(e, player_names),
            "minute": int(_get(e, "minute", 0)),
            "second": int(_get(e, "second", 0)),
            "location": list(_loc(_get(e, "location"))),
            "end_location": list(_loc(_get(e, "end_location"))),
            "xg": round(xg, 4),
            "outcome": outcome,
            "shot_speed_kmh": float(_get(e, "shot_speed_kmh", 0.0)),
        })
        t = teams[team]
        t["shots"] += 1
        xg_raw[team] += xg
        t["goals"] += outcome == "goal"
        t["on_target"] += outcome in ("goal", "saved")
    for team in TEAMS:
        teams[team]["xg"] = round(xg_raw[team], 3)
    return {"shots": shots, "teams": teams}


# ---------------------------------------------------------------------------
# Pass network
# ---------------------------------------------------------------------------

def compute_pass_network(
    events: list[Any], team: str, min_edge_count: int = 3, player_names: dict[str, str] | None = None,
) -> dict:
    """Nodes = players of `team` placed at the mean of every location where they
    passed or received a completed pass; edges = completed passer->recipient
    counts (>= min_edge_count). Recipients come straight off the pass event's
    recipient_id -- no inference needed."""
    team_names = _team_names(events)
    names: dict[str, str] = {}
    sum_xy: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    passes: dict[str, int] = defaultdict(int)
    received: dict[str, int] = defaultdict(int)
    pairs: dict[tuple[str, str], int] = defaultdict(int)
    completed = 0
    for e in events:
        if _get(e, "type") != "pass" or _get(e, "team") != team or _get(e, "outcome") != "complete":
            continue
        rid = _get(e, "recipient_id")
        if not rid:
            continue
        pid = str(_get(e, "player_id"))
        rid = str(rid)
        completed += 1
        names.setdefault(pid, _name(e, player_names))
        if rid not in names:
            names[rid] = (player_names or {}).get(rid) or str(_get(e, "recipient_name") or rid)
        sx, sy = _loc(_get(e, "location"))
        ex, ey = _loc(_get(e, "end_location"))
        for who, x, y in ((pid, sx, sy), (rid, ex, ey)):
            acc = sum_xy[who]
            acc[0] += x
            acc[1] += y
            acc[2] += 1
        passes[pid] += 1
        received[rid] += 1
        pairs[(pid, rid)] += 1

    nodes = []
    for pid, (x, y, n) in sum_xy.items():
        nodes.append({
            "player_id": pid,
            "player_name": names.get(pid, pid),
            "avg_location": [round(x / n, 2), round(y / n, 2)],
            "passes": passes[pid],
            "received": received[pid],
            "involvement": passes[pid] + received[pid],
        })
    nodes.sort(key=lambda n: (-n["involvement"], n["player_id"]))
    edges = [
        {"source": s, "target": t, "count": c}
        for (s, t), c in pairs.items() if c >= min_edge_count
    ]
    edges.sort(key=lambda e: (-e["count"], e["source"], e["target"]))
    return {
        "team": team,
        "team_name": team_names.get(team, team),
        "min_edge_count": min_edge_count,
        "completed_passes": completed,
        "nodes": nodes,
        "edges": edges,
        "max_edge_count": max((e["count"] for e in edges), default=0),
    }
