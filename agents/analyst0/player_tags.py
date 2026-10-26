"""Player speed/distance "tags" and ball/shot speed from a match's synthetic
position track (datagen/trajectory.py) and event stream.

Pure CPU, deterministic, no LLM calls.

Units: positions are in StatsBomb pitch units (x in [0, 120], y in [0, 80]).
They are converted to metres against a standard 105 m x 68 m pitch, with the
two axes scaled independently (StatsBomb units are not square metres).

Speed: per-frame step speeds are averaged over a trailing 1 s window -- the
raw 10 Hz interpolation has single-frame spikes. Any single step faster than
MAX_PLAUSIBLE_KMH is physically impossible for a footballer; on this
synthetic track it is always an interpolation artefact (the interpolator
snapping a player to their next event location, or a passer "riding" the
ball for one segment). Those steps are dropped from the speed window, but
still count towards distance -- the player did have to get there.

Sprint: the 1 s rolling mean speed reaching SPRINT_KMH (25.2 km/h, the
common broadcast-tracking threshold). One sprint per upward crossing; it
ends when the rolling mean drops back below the threshold.

Ball speed is NOT derived from the animated ball: the animation uses a fixed
segment duration per action, so its apparent speed is meaningless. Shot and
pass speeds come from the simulator's own per-event values
(`shot_speed_kmh`, `ball_speed_kmh`), which are themselves synthetic.
"""
from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping
from typing import Any

PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0
X_M_PER_UNIT = PITCH_LENGTH_M / 120.0
Y_M_PER_UNIT = PITCH_WIDTH_M / 80.0

SPRINT_KMH = 25.2
MAX_PLAUSIBLE_KMH = 37.0
SMOOTHING_WINDOW_MS = 1000
# A rolling mean is only trusted once at least this share of its window holds
# valid (non-artefact) samples.
_MIN_VALID_SHARE = 0.7
# A new match top speed must beat the standing record by this much to earn a
# tag, so near-identical records don't spam the ticker.
_RECORD_MIN_GAIN_KMH = 0.1

METHOD = (
    "Synthetic: speeds and distances are computed from the interpolated position "
    "track (not real player tracking) on a 105 x 68 m pitch, averaged over a 1 s "
    f"window. Single-frame moves above {MAX_PLAUSIBLE_KMH:g} km/h are interpolation "
    "artefacts and are excluded from speed (still counted as distance). Off-ball "
    "players only drift toward their recent average position, so distances read "
    "well below real Premier League totals (~10-12 km). Shot and pass speeds are "
    "the simulator's generated per-event values."
)


def format_game_clock(t_ms: int | float) -> str:
    total_s = int(t_ms // 1000)
    return f"{total_s // 60:02d}:{total_s % 60:02d}"


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _team_for(pid: str, teams: Mapping[str, str]) -> str:
    if pid in teams:
        return teams[pid]
    prefix = pid.split("_", 1)[0]
    return prefix if prefix in ("home", "away") else "unknown"


class _PlayerState:
    __slots__ = (
        "last", "distance_m", "km_tagged", "window", "valid_sum", "valid_n",
        "top_kmh", "top_t", "in_sprint", "sprint_start", "sprint_peak", "sprint_peak_t", "sprints",
    )

    def __init__(self, pos: tuple[float, float], window_len: int):
        self.last = pos
        self.distance_m = 0.0
        self.km_tagged = 0
        self.window: deque[float | None] = deque(maxlen=window_len)
        self.valid_sum = 0.0
        self.valid_n = 0
        self.top_kmh = 0.0
        self.top_t: int | None = None
        self.in_sprint = False
        self.sprint_start = 0
        self.sprint_peak = 0.0
        self.sprint_peak_t = 0
        self.sprints = 0

    def push(self, step_m: float | None) -> None:
        if len(self.window) == self.window.maxlen:
            old = self.window[0]
            if old is not None:
                self.valid_sum -= old
                self.valid_n -= 1
        self.window.append(step_m)
        if step_m is not None:
            self.valid_sum += step_m
            self.valid_n += 1


def compute_player_tags(
    frames: Iterable[Any],
    events: Iterable[Any],
    player_names: Mapping[str, str],
    *,
    sprint_kmh: float = SPRINT_KMH,
    max_kmh: float = MAX_PLAUSIBLE_KMH,
    window_ms: int = SMOOTHING_WINDOW_MS,
) -> dict:
    """Per-player distance / top speed / sprints, time-stamped threshold tags,
    and shot/pass ball speeds. `frames` are PositionFrame-like (t_ms, players)
    objects or dicts; `events` are schema events or their JSON dicts."""
    events = list(events)
    teams: dict[str, str] = {}
    for e in events:
        pid, team = _get(e, "player_id"), _get(e, "team")
        if isinstance(pid, str) and isinstance(team, str) and pid not in teams:
            teams[pid] = team

    def name(pid: str) -> str:
        return player_names.get(pid, pid)

    states: dict[str, _PlayerState] = {}
    tags: list[dict] = []
    episodes: list[tuple[int, float, str]] = []  # (peak t_ms, peak km/h, player)
    max_step_mps = max_kmh / 3.6
    steps_total = 0
    steps_excluded = 0
    prev_t: int | None = None
    window_len = 1

    for frame in frames:
        t_ms = int(_get(frame, "t_ms"))
        players: Mapping[str, Any] = _get(frame, "players") or {}
        if prev_t is None:
            if len(players) == 0:
                continue
            prev_t = t_ms
            for pid, (x, y) in players.items():
                states[pid] = _PlayerState((float(x), float(y)), 1)
            continue
        dt_s = (t_ms - prev_t) / 1000.0
        if dt_s <= 0:
            continue
        if window_len == 1:
            # Window length fixed from the first observed sample interval.
            window_len = max(1, round(window_ms / (dt_s * 1000.0)))
            for st in states.values():
                st.window = deque(maxlen=window_len)
        prev_t = t_ms

        for pid, (x, y) in players.items():
            x, y = float(x), float(y)
            st = states.get(pid)
            if st is None:
                st = states[pid] = _PlayerState((x, y), window_len)
                continue
            lx, ly = st.last
            st.last = (x, y)
            step_m = (((x - lx) * X_M_PER_UNIT) ** 2 + ((y - ly) * Y_M_PER_UNIT) ** 2) ** 0.5
            st.distance_m += step_m
            steps_total += 1
            if step_m / dt_s > max_step_mps:
                steps_excluded += 1
                st.push(None)
            else:
                st.push(step_m)

            while st.distance_m >= (st.km_tagged + 1) * 1000.0:
                st.km_tagged += 1
                tags.append({
                    "t_ms": t_ms, "game_clock": format_game_clock(t_ms), "player_id": pid,
                    "kind": "distance_km", "value": st.km_tagged,
                    "label": f"{name(pid)} has covered {st.km_tagged} km",
                })

            if len(st.window) < window_len or st.valid_n < _MIN_VALID_SHARE * window_len:
                speed = None
            else:
                speed = min(max_kmh, st.valid_sum / (st.valid_n * dt_s) * 3.6)
            if speed is not None and speed > st.top_kmh:
                st.top_kmh, st.top_t = speed, t_ms

            if speed is not None and speed >= sprint_kmh:
                if not st.in_sprint:
                    st.in_sprint = True
                    st.sprints += 1
                    st.sprint_start = t_ms
                    st.sprint_peak, st.sprint_peak_t = speed, t_ms
                elif speed > st.sprint_peak:
                    st.sprint_peak, st.sprint_peak_t = speed, t_ms
            elif st.in_sprint:
                _close_sprint(st, pid, name(pid), tags, episodes)

    for pid, st in states.items():
        if st.in_sprint:
            _close_sprint(st, pid, name(pid), tags, episodes)

    record = 0.0
    for peak_t, peak, pid in sorted(episodes):
        if peak > record + _RECORD_MIN_GAIN_KMH:
            record = peak
            tags.append({
                "t_ms": peak_t, "game_clock": format_game_clock(peak_t), "player_id": pid,
                "kind": "top_speed", "value": round(peak, 1),
                "label": f"New match top speed: {name(pid)} {peak:.1f} km/h",
            })

    kind_order = {"sprint": 0, "top_speed": 1, "distance_km": 2}
    tags.sort(key=lambda t: (t["t_ms"], kind_order[t["kind"]], t["player_id"]))

    players_out = [
        {
            "player_id": pid, "name": name(pid), "team": _team_for(pid, teams),
            "distance_km": round(st.distance_m / 1000.0, 3),
            "top_speed_kmh": round(st.top_kmh, 1),
            "top_speed_t_ms": st.top_t,
            "sprints": st.sprints,
        }
        for pid, st in states.items()
    ]
    players_out.sort(key=lambda p: (-p["distance_km"], p["player_id"]))

    shots: list[dict] = []
    fastest_pass: dict | None = None
    passes_counted = 0
    for e in events:
        etype = _get(e, "type")
        if etype == "shot" and _get(e, "shot_speed_kmh") is not None:
            pid = str(_get(e, "player_id"))
            t = int(_get(e, "match_clock_ms", 0))
            shots.append({
                "t_ms": t, "game_clock": format_game_clock(t), "player_id": pid, "name": name(pid),
                "team": _team_for(pid, teams), "speed_kmh": round(float(_get(e, "shot_speed_kmh")), 1),
                "xg": _get(e, "xg"), "outcome": _get(e, "outcome"),
            })
        elif etype == "pass" and _get(e, "ball_speed_kmh") is not None:
            passes_counted += 1
            speed = round(float(_get(e, "ball_speed_kmh")), 1)
            if fastest_pass is None or speed > fastest_pass["speed_kmh"]:
                pid = str(_get(e, "player_id"))
                t = int(_get(e, "match_clock_ms", 0))
                fastest_pass = {
                    "t_ms": t, "game_clock": format_game_clock(t), "player_id": pid, "name": name(pid),
                    "team": _team_for(pid, teams), "speed_kmh": speed, "distance_m": _get(e, "distance_m"),
                }
    shots.sort(key=lambda s: s["t_ms"])
    fastest_shot = max(shots, key=lambda s: s["speed_kmh"]) if shots else None

    return {
        "players": players_out,
        "tags": tags,
        "shots": shots,
        "fastest_shot": fastest_shot,
        "fastest_pass": fastest_pass,
        "passes_counted": passes_counted,
        "speed_samples_excluded_pct": round(100.0 * steps_excluded / steps_total, 2) if steps_total else 0.0,
        "thresholds": {
            "sprint_kmh": sprint_kmh, "max_plausible_kmh": max_kmh, "smoothing_window_ms": window_ms,
            "pitch_m": [PITCH_LENGTH_M, PITCH_WIDTH_M],
        },
        "method": METHOD,
    }


def _close_sprint(st: _PlayerState, pid: str, display: str, tags: list[dict], episodes: list) -> None:
    st.in_sprint = False
    tags.append({
        "t_ms": st.sprint_start, "game_clock": format_game_clock(st.sprint_start), "player_id": pid,
        "kind": "sprint", "value": round(st.sprint_peak, 1),
        "label": f"{display} sprint, {st.sprint_peak:.1f} km/h",
    })
    episodes.append((st.sprint_peak_t, st.sprint_peak, pid))
