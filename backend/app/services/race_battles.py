"""Overtakes, battles and the lap chart of a race or sprint, read from each lap's end position.

FastF1 gives every driver's race position and session time at the end of each lap, and nothing
finer. An overtake is a pair of cars that swap order between two lap ends, so a pass and a re-pass
inside one lap is invisible, and so is the place on track where a pass happened. Passes made through
the pit lane or under a safety car are not counted. A battle is a run of laps spent within the DRS
window of the same car ahead.
"""
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.services.session_info import SessionDataError, driver_profile, load_session

# A chaser this close to the car ahead at the end of a lap is inside the DRS window.
BATTLE_GAP_S = 1.0
# Fewest consecutive laps in the window before it is called a battle.
MIN_BATTLE_LAPS = 3
# Track status digits for a safety car, red flag, VSC and VSC ending (as in corner_analysis.clean_laps).
NEUTRALISED_DIGITS = "4567"

SESSIONS = ("R", "S")

_CACHE_TTL_SECONDS = 600
_cache: Dict[Tuple, Tuple[float, Dict[str, Any]]] = {}


def clear_cache() -> None:
    _cache.clear()


def _pivot(laps: pd.DataFrame, values: Any) -> pd.DataFrame:
    """Lap x driver table of `values` (one per lap row), with every lap from 1 to the last present."""
    frame = pd.DataFrame({
        "lap": laps["LapNumber"].to_numpy(dtype=float).astype(int),
        "driver": laps["Driver"].astype(str).to_numpy(),
        "value": np.asarray(values, dtype=float),
    }).drop_duplicates(["lap", "driver"], keep="last")
    table = frame.pivot(index="lap", columns="driver", values="value")
    table = table.reindex(range(1, int(table.index.max()) + 1)).sort_index(axis=1)
    table.index.name = "LapNumber"
    table.columns.name = None
    return table


def position_table(laps: pd.DataFrame) -> pd.DataFrame:
    """Race position at the end of each lap: index LapNumber, one column per driver, NaN when absent."""
    return _pivot(laps, laps["Position"].to_numpy(dtype=float))


def _flag_table(laps: pd.DataFrame, flag: pd.Series, like: pd.DataFrame) -> np.ndarray:
    """A per-lap boolean as a lap x driver array on the same grid as `like` (False where absent)."""
    table = _pivot(laps, flag.astype(float).to_numpy()).reindex(index=like.index, columns=like.columns)
    return np.nan_to_num(table.to_numpy(dtype=float)) > 0.5


class _Grid:
    """Positions, lap-end times and pit/neutralised flags as lap x driver arrays, built once.
    Row i is lap i + 1."""

    def __init__(self, laps: pd.DataFrame):
        positions = position_table(laps)
        self.codes = [str(c) for c in positions.columns]
        self.pos = positions.to_numpy(dtype=float)
        self.total, drivers = self.pos.shape
        seconds = laps["Time"].dt.total_seconds()
        self.time = _pivot(laps, seconds.to_numpy(dtype=float)).reindex(
            index=positions.index, columns=positions.columns
        ).to_numpy(dtype=float)
        pit = laps["PitInTime"].notna() | laps["PitOutTime"].notna()
        self.pit = _flag_table(laps, pit, positions)
        if "TrackStatus" in laps.columns:
            neutral = laps["TrackStatus"].map(
                lambda s: pd.notna(s) and any(c in str(s) for c in NEUTRALISED_DIGITS)
            ).astype(bool)
        else:
            neutral = pd.Series(False, index=laps.index)
        self.neutral = _flag_table(laps, neutral, positions)
        # the last row each driver has a position on (-1 when none)
        present = ~np.isnan(self.pos)
        self.last = np.where(present.any(axis=0), self.total - 1 - present[::-1].argmax(axis=0), -1)
        self.passes = self._passes(drivers)

    def _passes(self, drivers: int) -> np.ndarray:
        """passes[i, a, b]: a was behind b at the end of row i-1 and is ahead at the end of row i, and
        neither car pitted or ran under a neutralisation on row i."""
        out = np.zeros((self.total, drivers, drivers), dtype=bool)
        quiet = ~(self.pit | self.neutral)
        for i in range(1, self.total):
            before, now = self.pos[i - 1], self.pos[i]
            with np.errstate(invalid="ignore"):  # NaN compares false: a missing position never passes
                behind = before[:, None] > before[None, :]
                ahead = now[:, None] < now[None, :]
            out[i] = behind & ahead & quiet[i][:, None] & quiet[i][None, :]
        return out

    def car_ahead(self) -> np.ndarray:
        """car_ahead[i, d]: the column of the car one place ahead of d at the end of row i, or -1."""
        found = np.full(self.pos.shape, -1, dtype=int)
        for i in range(self.total):
            at = {int(p): d for d, p in enumerate(self.pos[i]) if not np.isnan(p)}
            for d, p in enumerate(self.pos[i]):
                if not np.isnan(p):
                    found[i, d] = at.get(int(p) - 1, -1)
        return found


def find_overtakes(laps: pd.DataFrame) -> List[Dict[str, Any]]:
    """Every on-track pass from lap 2 on, ordered by lap then the passer's position."""
    return _overtakes(_Grid(laps))


def _overtakes(grid: _Grid) -> List[Dict[str, Any]]:
    found = [
        {"lap": int(i) + 1, "driver": grid.codes[a], "passed": grid.codes[b], "position": int(grid.pos[i, a])}
        for i, a, b in np.argwhere(grid.passes)
    ]
    found.sort(key=lambda o: (o["lap"], o["position"], o["driver"], o["passed"]))
    return found


def find_battles(laps: pd.DataFrame) -> List[Dict[str, Any]]:
    """Runs of at least MIN_BATTLE_LAPS laps within BATTLE_GAP_S of the same car ahead."""
    return _battles(_Grid(laps))


def _battles(grid: _Grid) -> List[Dict[str, Any]]:
    ahead = grid.car_ahead()
    has_car = ahead >= 0
    rows = np.arange(grid.total)[:, None]
    lead = np.where(has_car, ahead, 0)
    gap = np.where(has_car, grid.time - grid.time[rows, lead], np.nan)  # NaN when either time is missing
    quiet = ~(grid.pit | grid.neutral)
    with np.errstate(invalid="ignore"):
        battle = has_car & quiet & quiet[rows, lead] & (gap >= 0) & (gap < BATTLE_GAP_S)

    found: List[Dict[str, Any]] = []
    for chaser in range(len(grid.codes)):
        i = 0
        while i < grid.total:
            if not battle[i, chaser]:
                i += 1
                continue
            j = i
            while j + 1 < grid.total and battle[j + 1, chaser] and ahead[j + 1, chaser] == ahead[i, chaser]:
                j += 1
            if j - i + 1 >= MIN_BATTLE_LAPS:
                found.append(_battle(grid, chaser, int(ahead[i, chaser]), i, j, float(gap[i:j + 1, chaser].min())))
            i = j + 1
    found.sort(key=lambda b: (-b["laps"], b["start_lap"], b["chaser"]))
    return found


def _battle(grid: _Grid, chaser: int, leader: int, first: int, last: int, min_gap: float) -> Dict[str, Any]:
    """The battle on rows first..last, with how it ended judged on the row after."""
    after = last + 1
    outcome, outcome_lap = "dropped", None
    if last >= min(grid.last[chaser], grid.last[leader]):
        outcome, outcome_lap = "flag", last + 1
    elif grid.pit[after, chaser] or grid.pit[after, leader]:
        outcome, outcome_lap = "pits", after + 1
    elif grid.passes[after, chaser, leader]:
        outcome, outcome_lap = "passed", after + 1
    elif grid.neutral[after, chaser] or grid.neutral[after, leader]:
        outcome, outcome_lap = "neutralised", after + 1
    return {
        "chaser": grid.codes[chaser], "leader": grid.codes[leader],
        "start_lap": first + 1, "end_lap": last + 1, "laps": last - first + 1,
        "min_gap": round(min_gap, 3), "outcome": outcome, "outcome_lap": outcome_lap,
    }


def _whole(value: Any) -> Optional[int]:
    return int(value) if pd.notna(value) else None


def _results_by_code(session: Any) -> Dict[str, Tuple[Optional[int], Optional[int]]]:
    """(grid, finish) per driver code. A missing or zero grid slot (a pit-lane start) is None."""
    results = getattr(session, "results", None)
    if results is None or results.empty or "Abbreviation" not in results.columns:
        return {}
    out: Dict[str, Tuple[Optional[int], Optional[int]]] = {}
    for _, row in results.iterrows():
        grid = _whole(row["GridPosition"]) if "GridPosition" in row.index else None
        finish = _whole(row["Position"]) if "Position" in row.index else None
        out[str(row["Abbreviation"])] = (grid or None, finish)
    return out


def race_battles_payload(year: int, gp: str, session_name: str, round_number: Optional[int] = None) -> Dict[str, Any]:
    """The lap chart, every on-track pass and every battle of a race or sprint."""
    if session_name not in SESSIONS:
        raise SessionDataError("Overtakes need a race or a sprint.")
    key = (year, round_number or gp, session_name)
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    session = load_session(year, gp, session_name, round_number)
    laps = session.laps
    grid = _Grid(laps)
    overtakes = _overtakes(grid)
    made: Dict[str, int] = {}
    lost: Dict[str, int] = {}
    for o in overtakes:
        made[o["driver"]] = made.get(o["driver"], 0) + 1
        lost[o["passed"]] = lost.get(o["passed"], 0) + 1

    results = _results_by_code(session)
    drivers: List[Dict[str, Any]] = []
    for d, code in enumerate(grid.codes):
        start, finish = results.get(code, (None, None))
        lap_one = grid.pos[0, d]
        drivers.append({
            "code": code, **driver_profile(session, code),
            "grid": start, "finish": finish,
            "start_gain": start - int(lap_one) if start is not None and not np.isnan(lap_one) else None,
            "made": made.get(code, 0), "lost": lost.get(code, 0),
            "positions": [None if np.isnan(p) else int(p) for p in grid.pos[:, d]],
        })
    drivers.sort(key=lambda r: (r["finish"] is None, r["finish"] if r["finish"] is not None else 0, r["code"]))

    payload = {
        "total_laps": int(laps["LapNumber"].max()),
        "drivers": drivers, "overtakes": overtakes, "battles": _battles(grid),
    }
    _cache[key] = (time.time(), payload)
    return payload
