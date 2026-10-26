"""Player graph: who passes to whom, who battles whom, and who holds it together.

Pure, deterministic functions over one match's on-pitch event list (the same
events service/main.py keeps in STATE["events_by_match"]; plain dicts work
too). Built on the helpers in match_maps.py and the xT grid in metrics.py.

Graph
-----
* Nodes: every player of the selected team(s) with an action in the window --
  an on-ball event (pass, carry, dribble, shot, tackle, interception, duel),
  a pass receipt, or being the opponent in a contest. `touches` counts on-ball
  events plus completed passes received; avg_x/avg_y average all of those
  action spots (120x80 coordinates).
* Pass edges (directed): passer -> recipient_id. `count` is every pass naming
  that recipient, `completed_count` the completed ones; `xt_added` sums the xT
  gained (end minus start, in the passer's attacking direction) over completed
  passes. Edges below `min_passes` are dropped and the centralities are
  computed on what remains (i.e. on the graph that is drawn).
* Duel edges (undirected): every schema contest event names its opponent
  explicitly (duel / tackle / interception / dribble -> opponent_id), so those
  ids are used as-is. A tackled dribble and the won tackle the simulator logs
  for it at the same instant are one contest, counted once. Only if an event
  lacks an opponent id is it paired with the latest opposing on-ball event
  within 3 s, and `method` says so. Duels are cross-team, so they only appear
  in the "both" view.
* Betweenness: Brandes on the weighted directed pass graph (distance =
  1/count, exact rational arithmetic so ties are exact), normalised per team by
  (n-1)(n-2) -- the fraction of ordered teammate pairs' shortest routes that
  run through the player.

Window: from_min <= minute + second/60 < to_min; an upper bound of 90 or more
is inclusive so the event stamped exactly 90:00 isn't lost.
"""
from __future__ import annotations

import heapq
from collections import defaultdict
from fractions import Fraction
from typing import Any

from agents.analyst0.match_maps import TEAMS, event_field, event_location, player_label
from agents.analyst0.metrics import direction_of, opponent_of, xt_value

TEAM_CHOICES = ("both", "home", "away")
TOUCH_TYPES = frozenset({"pass", "carry", "dribble", "shot", "interception", "tackle", "duel"})
CONTEST_TYPES = frozenset({"duel", "tackle", "interception", "dribble"})
ON_BALL_TYPES = frozenset({"pass", "carry", "dribble", "shot"})
PAIRING_WINDOW_MS = 3000
TOP_PAIRS = 3


def _clock_ms(e: Any) -> int:
    clock = event_field(e, "match_clock_ms")
    if clock is not None:
        return int(clock)
    return (int(event_field(e, "minute", 0)) * 60 + int(event_field(e, "second", 0))) * 1000


def _in_window(e: Any, from_min: float, to_min: float) -> bool:
    t = int(event_field(e, "minute", 0)) + int(event_field(e, "second", 0)) / 60.0
    return from_min <= t < to_min or (to_min >= 90 and t == to_min)


def _preceding_carrier(events: list[Any], idx: int) -> str | None:
    """Player of the latest opposing on-ball event within PAIRING_WINDOW_MS."""
    team, clock = event_field(events[idx], "team"), _clock_ms(events[idx])
    for j in range(idx - 1, -1, -1):
        prev = events[j]
        if clock - _clock_ms(prev) > PAIRING_WINDOW_MS:
            return None
        if event_field(prev, "type") in ON_BALL_TYPES and event_field(prev, "team") not in (team, None):
            return str(event_field(prev, "player_id"))
    return None


def _contests(events: list[Any]) -> list[dict]:
    """One record per 1v1 contest: who, against whom, who won, where, when."""
    out: list[dict] = []
    tackle_keys: set[tuple[int, str, str]] = set()  # (clock, defender, carrier)
    for idx, e in enumerate(events):
        etype, team = event_field(e, "type"), event_field(e, "team")
        if etype not in CONTEST_TYPES or team not in TEAMS:
            continue
        pid, outcome = str(event_field(e, "player_id")), event_field(e, "outcome")
        opp, inferred = event_field(e, "opponent_id"), False
        if not opp and etype != "dribble":
            opp, inferred = _preceding_carrier(events, idx), True
        if not opp:
            continue
        opp = str(opp)
        clock = _clock_ms(e)
        if etype == "dribble":
            winner = opp if outcome == "tackled" else pid
            key = (clock, opp, pid) if outcome == "tackled" else None
        elif etype == "tackle":
            winner = pid if outcome == "won" else opp
            key = (clock, pid, opp) if outcome == "won" else None
        elif etype == "duel":
            winner = pid if outcome == "won" else opp
            key = None
        else:  # interception: the interceptor took the ball meant for `opp`
            winner, key = pid, None
        if key is not None:
            if key in tackle_keys:
                continue
            tackle_keys.add(key)
        out.append({"event": e, "player": pid, "team": team, "opponent": opp, "winner": winner, "inferred": inferred})
    return out


def _betweenness(nodes: list[str], adj: dict[str, dict[str, Fraction]]) -> dict[str, Fraction]:
    """Brandes (2001) for weighted directed graphs, unnormalised."""
    cb: dict[str, Fraction] = dict.fromkeys(nodes, Fraction(0))
    for s in nodes:
        dist: dict[str, Fraction] = {s: Fraction(0)}
        sigma: dict[str, int] = {s: 1}
        preds: dict[str, list[str]] = defaultdict(list)
        order: list[str] = []
        done: set[str] = set()
        heap: list[tuple[Fraction, str]] = [(Fraction(0), s)]
        while heap:
            d, v = heapq.heappop(heap)
            if v in done or d > dist[v]:
                continue
            done.add(v)
            order.append(v)
            for w, weight in sorted(adj.get(v, {}).items()):
                nd = d + weight
                if w not in dist or nd < dist[w]:
                    dist[w], sigma[w], preds[w] = nd, sigma[v], [v]
                    heapq.heappush(heap, (nd, w))
                elif nd == dist[w] and w not in done:
                    sigma[w] += sigma[v]
                    preds[w].append(v)
        delta: dict[str, Fraction] = dict.fromkeys(order, Fraction(0))
        for w in reversed(order):
            for v in preds[w]:
                delta[v] += Fraction(sigma[v], sigma[w]) * (1 + delta[w])
            if w != s:
                cb[w] += delta[w]
    return cb


def compute_player_graph(
    events: list[Any],
    from_min: float = 0,
    to_min: float = 90,
    team: str = "both",
    include_duels: bool = True,
    min_passes: int = 2,
    player_names: dict[str, str] | None = None,
) -> dict:
    if not 0 <= from_min < to_min <= 120:
        raise ValueError("need 0 <= from_min < to_min <= 120")
    if team not in TEAM_CHOICES:
        raise ValueError(f"team must be one of {TEAM_CHOICES}")
    if min_passes < 1:
        raise ValueError("min_passes must be >= 1")
    teams = TEAMS if team == "both" else (team,)

    names: dict[str, str] = {}
    team_of: dict[str, str] = {}
    for e in events:
        t = event_field(e, "team")
        if t not in TEAMS or event_field(e, "player_id") is None:
            continue
        pid = str(event_field(e, "player_id"))
        names.setdefault(pid, player_label(e, player_names))
        team_of.setdefault(pid, t)
        rid = event_field(e, "recipient_id")
        if rid:
            names.setdefault(str(rid), (player_names or {}).get(str(rid)) or str(event_field(e, "recipient_name") or rid))
            team_of.setdefault(str(rid), t)
        opp = event_field(e, "opponent_id")
        if opp:
            team_of.setdefault(str(opp), opponent_of(t))

    touches: dict[str, int] = defaultdict(int)
    made: dict[str, int] = defaultdict(int)
    received: dict[str, int] = defaultdict(int)
    spots: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0])
    pairs: dict[tuple[str, str], dict] = {}

    def spot(pid: str, loc: Any) -> None:
        x, y = event_location(loc)
        acc = spots[pid]
        acc[0] += x
        acc[1] += y
        acc[2] += 1

    for e in events:
        etype, t = event_field(e, "type"), event_field(e, "team")
        if t not in teams or etype not in TOUCH_TYPES or not _in_window(e, from_min, to_min):
            continue
        pid = str(event_field(e, "player_id"))
        touches[pid] += 1
        spot(pid, event_field(e, "location"))
        if etype != "pass":
            continue
        made[pid] += 1
        rid = event_field(e, "recipient_id")
        if not rid:
            continue
        rid = str(rid)
        pair = pairs.setdefault((pid, rid), {"count": 0, "completed_count": 0, "xt": 0.0})
        pair["count"] += 1
        spot(rid, event_field(e, "end_location"))
        if event_field(e, "outcome") == "complete":
            pair["completed_count"] += 1
            received[rid] += 1
            touches[rid] += 1
            d = direction_of(t)
            pair["xt"] += xt_value(event_location(event_field(e, "end_location")), d) - xt_value(
                event_location(event_field(e, "location")), d)

    contests = [c for c in _contests(events) if _in_window(c["event"], from_min, to_min)]
    for c in contests:
        if team_of.get(c["opponent"], opponent_of(c["team"])) in teams:
            team_of.setdefault(c["opponent"], opponent_of(c["team"]))
            spot(c["opponent"], event_field(c["event"], "location"))

    node_ids = sorted(spots, key=lambda p: (TEAMS.index(team_of[p]), p))

    # --- pass edges + centralities on the thresholded graph -----------------
    pass_edges = [
        {"source": s, "target": r, "kind": "pass", "count": p["count"], "completed_count": p["completed_count"],
         "xt_added": round(p["xt"], 4), "directed": True}
        for (s, r), p in pairs.items() if p["count"] >= min_passes
    ]
    pass_edges.sort(key=lambda e: (-e["count"], e["source"], e["target"]))
    adj: dict[str, dict[str, Fraction]] = defaultdict(dict)
    neighbours: dict[str, set[str]] = defaultdict(set)
    for e in pass_edges:
        adj[e["source"]][e["target"]] = Fraction(1, e["count"])
        neighbours[e["source"]].add(e["target"])
        neighbours[e["target"]].add(e["source"])

    betweenness: dict[str, float] = {}
    degree: dict[str, float] = {}
    for t in teams:
        members = [p for p in node_ids if team_of[p] == t]
        n = len(members)
        raw = _betweenness(members, adj)
        for p in members:
            betweenness[p] = float(raw[p] / ((n - 1) * (n - 2))) if n > 2 else 0.0
            degree[p] = len(neighbours[p]) / (n - 1) if n > 1 else 0.0

    nodes = [{
        "id": p,
        "name": names.get(p) or (player_names or {}).get(p) or p,
        "team": team_of[p],
        "touches": touches[p],
        "passes_made": made[p],
        "passes_received": received[p],
        "degree_centrality": round(degree[p], 4),
        "betweenness": round(betweenness[p], 4),
        "avg_x": round(spots[p][0] / spots[p][2], 2),
        "avg_y": round(spots[p][1] / spots[p][2], 2),
    } for p in node_ids]
    nodes.sort(key=lambda n: (TEAMS.index(n["team"]), -n["touches"], n["id"]))

    # --- duel edges -----------------------------------------------------------
    duel_edges: list[dict] = []
    inferred = 0
    if include_duels:
        in_graph = set(node_ids)
        duels: dict[tuple[str, str], dict] = {}
        for c in contests:
            a, b = c["player"], c["opponent"]
            if a not in in_graph or b not in in_graph:
                continue
            src, dst = sorted((a, b))
            d = duels.setdefault((src, dst), {"source": src, "target": dst, "kind": "duel", "count": 0,
                                              "won_by_source": 0, "won_by_target": 0, "directed": False})
            d["count"] += 1
            d["won_by_source" if c["winner"] == src else "won_by_target"] += 1
            inferred += c["inferred"]
        duel_edges = sorted(duels.values(), key=lambda e: (-e["count"], e["source"], e["target"]))

    # --- insights -------------------------------------------------------------
    by_id = {n["id"]: n for n in nodes}
    hub = None
    if nodes and max(betweenness.values()) > 0:
        best = min(node_ids, key=lambda p: (-betweenness[p], -degree[p], -(made[p] + received[p]), p))
        node = by_id[best]
        hub = {
            "player_id": best,
            "name": node["name"],
            "betweenness": node["betweenness"],
            "reason": (
                f"{node['name']} lies on {betweenness[best]:.0%} of the shortest passing routes between teammates "
                f"({node['passes_made']} passes made, {node['passes_received']} received, "
                f"{len(neighbours[best])} regular passing partners)."
            ),
        }

    combined: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0, 0.0])
    for (s, r), p in pairs.items():
        if s in by_id and r in by_id:
            acc = combined[tuple(sorted((s, r)))]
            acc[0] += p["count"]
            acc[1] += p["xt"]
    top_pairs = [
        {"a": a, "b": b, "passes": int(c), "xt_added": round(x, 4)}
        for (a, b), (c, x) in sorted(combined.items(), key=lambda kv: (-kv[1][0], -kv[1][1], kv[0]))[:TOP_PAIRS]
    ]
    most_contested = (
        {"a": duel_edges[0]["source"], "b": duel_edges[0]["target"], "count": duel_edges[0]["count"]}
        if duel_edges else None
    )
    isolated = sorted(p for p in node_ids if not neighbours[p])

    method = (
        f"Directed pass graph from each pass's recipient_id in the window (edges with >= {min_passes} passes; "
        "Brandes betweenness with distance = 1/count, normalised per team by (n-1)(n-2)); "
    )
    if not include_duels:
        method += "duels not requested."
    elif team != "both":
        method += "duels are cross-team, so they are omitted from a single-team view."
    else:
        method += ("duels from the opponent_id each duel/tackle/interception/dribble event carries "
                   "(a tackled dribble and its tackle count once).")
        if inferred:
            method += (f" {inferred} contest(s) lacking an opponent id were inferred from the preceding "
                       f"opposing on-ball event within {PAIRING_WINDOW_MS // 1000}s.")

    return {
        "window": {"from_min": from_min, "to_min": to_min},
        "nodes": nodes,
        "edges": pass_edges + duel_edges,
        "insights": {
            "hub": hub,
            "top_pairs": top_pairs,
            "most_contested_duel": most_contested,
            "isolated_players": isolated,
        },
        "method": method,
    }
