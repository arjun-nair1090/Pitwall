"""Live race forecasts from F1's timing feed: battles about to start, where each car would rejoin
from a stop now, and the undercut and overcut odds between close cars.

Battles: for each car and the one ahead, the live interval and how fast it is closing, the median
of their lap-time difference over the last CLOSING_LAPS laps both ran clean (no pit laps, nothing
behind a safety car or VSC, not lap 1). A chaser inside DRS_GAP_S is battling now; one gaining at
least MIN_CLOSING_S a lap is forecast to get there in ceil((interval - DRS_GAP_S) / closing) laps,
if that is within FORECAST_LAPS and before the flag. Behind a safety car the gaps say nothing about
pace, so none are forecast.

Pit stops: a stop now puts a car the pit loss further behind the leader than it is (half of it
behind a safety car or VSC, as `pit_strategy` costs a cheap stop). Its rejoin place is among the
cars on the lead lap, from their current gaps, so cars behind keep the pace they have; a lapped car
can't be passed by a stop and has no gap to rejoin from. Cars staying out on worn tyres also give
up their out-lap deficit to the fresh set, read off the tyre model. Each stop carries its pit
window and `early`, true while that window rests on tyres with no fit of their own yet.

The pit loss is this race's own once MIN_MEASURED_STOPS stops are measured (as on the Pit Window
page); before that the circuit's from last year's race, else the default.

Undercut and overcut: `pit_strategy` on the tyre model fitted to the laps seen so far, the same
model the Pit Window page fits to a replay.
"""
import math
import threading
from statistics import median
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from app.services import pit_strategy
from app.services.pit_strategy import DRY_COMPOUNDS, DriverState, TyreModel
from app.services.race_battles import BATTLE_GAP_S
from app.services.session_info import NEUTRALISED_DIGITS
from app.services.strategy_simulator import DEFAULT_PIT_LOSS_SECONDS

# Inside this interval the chaser has DRS: the battle is on.
DRS_GAP_S = BATTLE_GAP_S
# The pace comparison reads the most recent laps both cars ran clean, at least the minimum.
CLOSING_LAPS = 5
MIN_CLOSING_LAPS = 2
# Gaining less than this a lap is holding station, not closing.
MIN_CLOSING_S = 0.05
# How many laps ahead a battle is forecast; further out, the pace will have changed.
FORECAST_LAPS = 10
# Rejoining closer than this behind a car is rejoining in its dirty air.
TRAFFIC_GAP_S = 1.5


def _number(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _neutralised(track: Optional[str]) -> bool:
    return any(c in str(track or "") for c in NEUTRALISED_DIGITS)


def _driver(number: str, codes: Dict[str, str]) -> Dict[str, Any]:
    return {"number": int(number), "code": codes.get(number, f"#{number}")}


def _codes(snapshot: Dict[str, Any]) -> Dict[str, str]:
    return {str(d["driver_number"]): d.get("code") or f"#{d['driver_number']}" for d in snapshot.get("drivers") or []}


def _running(timing: Dict[str, Dict[str, Any]]) -> List[Tuple[str, Dict[str, Any]]]:
    """Cars still in the race with a place, in order."""
    cars = [(n, r) for n, r in timing.items() if isinstance(r.get("position"), int) and not r.get("retired")]
    return sorted(cars, key=lambda car: car[1]["position"])


def _laps_remaining(lap_count: Dict[str, Any]) -> Optional[int]:
    """Laps left, counting the one the leader is on."""
    current, total = lap_count.get("current"), lap_count.get("total")
    if not current or not total:
        return None
    return max(total - current + 1, 0)


def _clean_laps(rows: List[Dict[str, Any]]) -> Dict[int, float]:
    return {r["lap"]: r["lap_time"] for r in rows
            if r["lap"] > 1 and r.get("lap_time") and not r["pit_in"] and not r["pit_out"]
            and not _neutralised(r.get("track"))}


def closing_rate(ahead: List[Dict[str, Any]], behind: List[Dict[str, Any]]) -> Tuple[Optional[float], int]:
    """(seconds a lap the car behind is gaining, laps compared), from their recent clean laps."""
    a, b = _clean_laps(ahead), _clean_laps(behind)
    common = sorted(set(a) & set(b))[-CLOSING_LAPS:]
    if len(common) < MIN_CLOSING_LAPS:
        return None, len(common)
    return round(median(a[lap] - b[lap] for lap in common), 3), len(common)


def battles(snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Cars battling now (inside DRS range) and those forecast to be, soonest first."""
    if _neutralised(snapshot.get("track_status")):
        return []
    codes, history = _codes(snapshot), snapshot.get("history") or {}
    remaining = _laps_remaining(snapshot.get("lap_count") or {})
    horizon = FORECAST_LAPS if remaining is None else min(FORECAST_LAPS, remaining)
    cars = _running(snapshot.get("timing") or {})
    found = []
    for (ahead, a), (behind, b) in zip(cars, cars[1:]):
        gap = _number(b.get("gap_to_next"))
        if gap is None or a.get("is_pit") or b.get("is_pit"):
            continue
        closing, compared = closing_rate(history.get(ahead, []), history.get(behind, []))
        in_drs = gap <= DRS_GAP_S
        laps_to_drs = None
        if not in_drs:
            if closing is None or closing < MIN_CLOSING_S:
                continue
            laps_to_drs = max(1, math.ceil(round((gap - DRS_GAP_S) / closing, 6)))
            if laps_to_drs > horizon:
                continue
        found.append({"ahead": _driver(ahead, codes), "behind": _driver(behind, codes), "gap": round(gap, 3),
                      "closing": closing, "laps_compared": compared, "in_drs": in_drs, "laps_to_drs": laps_to_drs})
    return sorted(found, key=lambda f: (not f["in_drs"], f["laps_to_drs"] or 0, f["gap"]))


def _out_lap_gain(model: Optional[TyreModel], fresh: str, car: Dict[str, Any]) -> float:
    """How much slower a car staying out laps than a fresh set of `fresh` tyres, over the out-lap."""
    compound, age = str(car.get("compound") or "").upper(), _number(car.get("tyre_age"))
    if model is None or age is None or fresh not in DRY_COMPOUNDS or compound not in DRY_COMPOUNDS:
        return 0.0
    return model.lap_time(compound, age + 2) - model.lap_time(fresh, 1)


def pit_stops(snapshot: Dict[str, Any], pit_loss: float, model: Optional[TyreModel] = None,
              fresh: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    """Where each car on the lead lap would be at the end of its out-lap if it stopped now, and who
    would be around it.

    The pit loss is measured against a car's own fresh-tyre pace, but the cars it races stay out on
    worn tyres, so with a tyre model each of them also gives up its out-lap deficit to the fresh set
    (`fresh` maps a car to the compound it would fit, its current one by default). On the Singapore
    2026 replay, with that race's measured loss, 21 of 23 stops ended up within a place of the
    forecast among the cars that stayed out, and the forecast leaned about half a place pessimistic."""
    if _neutralised(snapshot.get("track_status")):
        pit_loss *= pit_strategy.SC_PIT_LOSS_FACTOR
    codes = _codes(snapshot)
    cars = [(n, r, _number(r.get("gap_to_leader"))) for n, r in _running(snapshot.get("timing") or {})]
    cars = [(n, r, g) for n, r, g in cars if g is not None]
    out = []
    for number, car, gap in cars:
        if car.get("is_pit"):
            continue
        rejoin = gap + pit_loss
        tyre = (fresh or {}).get(number) or str(car.get("compound") or "").upper()
        others = [(n, g + _out_lap_gain(model, tyre, r)) for n, r, g in cars if n != number]
        ahead = max(((n, g) for n, g in others if g < rejoin), key=lambda o: o[1], default=None)
        behind = min(((n, g) for n, g in others if g >= rejoin), key=lambda o: o[1], default=None)
        position = 1 + sum(1 for _, g in others if g < rejoin)
        out.append({
            **_driver(number, codes), "position": car["position"], "rejoin_position": position,
            "positions_lost": max(position - car["position"], 0),
            "ahead": {"code": codes.get(ahead[0], f"#{ahead[0]}"), "gap": round(rejoin - ahead[1], 3)} if ahead else None,
            "behind": {"code": codes.get(behind[0], f"#{behind[0]}"), "gap": round(behind[1] - rejoin, 3)} if behind else None,
            "early": None,
            "traffic": bool(ahead and rejoin - ahead[1] < TRAFFIC_GAP_S),
        })
    return out


def laps_frame(history: Dict[str, List[Dict[str, Any]]], codes: Dict[str, str]) -> pd.DataFrame:
    """The laps seen so far as the FastF1 lap table the tyre model is fitted on."""
    rows = []
    for number, laps in history.items():
        for r in laps:
            rows.append({
                "Driver": codes.get(number, f"#{number}"), "LapNumber": float(r["lap"]),
                "LapTime": pd.Timedelta(seconds=r["lap_time"]) if r.get("lap_time") else pd.NaT,
                "Compound": r.get("compound"),
                "TyreLife": float(r["tyre_age"]) if r.get("tyre_age") is not None else float("nan"),
                "Stint": float(r["stint"]) if r.get("stint") is not None else float("nan"),
                "PitInTime": pd.Timedelta(0) if r["pit_in"] else pd.NaT,
                "PitOutTime": pd.Timedelta(0) if r["pit_out"] else pd.NaT,
                "TrackStatus": r.get("track") or "1",
                "Position": float(r["position"]) if r.get("position") is not None else float("nan"),
                "IsAccurate": bool(r.get("lap_time")) and r["lap"] > 1 and not r["pit_in"] and not r["pit_out"],
            })
    columns = ["Driver", "LapNumber", "LapTime", "Compound", "TyreLife", "Stint", "PitInTime", "PitOutTime",
               "TrackStatus", "Position", "IsAccurate"]
    return pd.DataFrame(rows, columns=columns)


def _states(snapshot: Dict[str, Any], codes: Dict[str, str], neutralised: bool) -> Dict[str, DriverState]:
    history, used = snapshot.get("history") or {}, snapshot.get("used") or {}
    states = {}
    for number, car in _running(snapshot.get("timing") or {}):
        compound = str(car.get("compound") or "UNKNOWN").upper()
        last = (history.get(number) or [None])[-1]
        age = last["tyre_age"] if last and last.get("tyre_age") is not None and not last["pit_in"] else car.get("tyre_age")
        if age is None or not car.get("lap_number"):
            continue
        states[number] = DriverState(
            code=codes.get(number, f"#{number}"), position=car["position"], lap=int(car["lap_number"]),
            compound=compound, tyre_age=int(age), used={str(c).upper() for c in used.get(number, [])} | {compound},
            gap_ahead=_number(car.get("gap_to_next")), neutralised=neutralised,
        )
    return states


def race_strategy(snapshot: Dict[str, Any], prior_pit_loss: Optional[float] = None) -> Dict[str, Any]:
    """Everything the live page's battles and pit-stop panel shows."""
    session = snapshot.get("session") or {}
    if session.get("session_type") != "Race":
        return {"applicable": False, "session_name": session.get("session_name")}
    from app.services.pit_window import _early, tyre_model  # imported here: pit_window pulls in FastF1 loading

    codes = _codes(snapshot)
    neutralised = _neutralised(snapshot.get("track_status"))
    lap_count = snapshot.get("lap_count") or {}
    remaining = _laps_remaining(lap_count)
    sprint = session.get("session_name") == "Sprint"

    frame = laps_frame(snapshot.get("history") or {}, codes)
    default = prior_pit_loss if prior_pit_loss else DEFAULT_PIT_LOSS_SECONDS
    model, pit_loss, measured = tyre_model(frame, default) if not frame.empty else (None, default, False)
    source = "measured" if measured else "last_year" if prior_pit_loss else "default"

    windows: Dict[str, Dict[str, Any]] = {}
    duels = []
    states = _states(snapshot, codes, neutralised) if model is not None and remaining else {}
    for number, state in states.items():
        windows[number] = pit_strategy.pit_window(state, model, remaining, sprint=sprint)
    fresh = {n: w["best"]["stops"][0]["compound"] for n, w in windows.items()
             if (w.get("best") or {}).get("stops")}
    stops = pit_stops(snapshot, pit_loss, model, fresh)
    if states:
        for stop in stops:
            number = str(stop["number"])
            if number in windows:
                window = windows[number]
                stop.update(status=window["status"], window=window["window"],
                            early=_early(states[number].compound, window, model))
        cars = [n for n, _ in _running(snapshot.get("timing") or {})]
        for ahead, behind in zip(cars, cars[1:]):
            leader, chaser = states.get(ahead), states.get(behind)
            if leader is None or chaser is None:
                continue
            under = pit_strategy.undercut(chaser, leader, model, remaining, sprint=sprint)
            over = pit_strategy.overcut(chaser, leader, model, remaining, sprint=sprint)
            if under or over:
                keep = ("gain", "margin", "verdict", "compound")
                duels.append({
                    "chaser": _driver(behind, codes), "leader": _driver(ahead, codes),
                    "gap": round(chaser.gap_ahead, 3),
                    "undercut": {k: under[k] for k in keep} if under else None,
                    "overcut": {k: over[k] for k in keep} if over else None,
                })

    return {
        "applicable": True, "lap": lap_count.get("current"), "total_laps": lap_count.get("total"),
        "laps_remaining": remaining, "neutralised": neutralised,
        "pit_loss": round(pit_loss, 3), "pit_loss_source": source,
        "battles": battles(snapshot), "pit_stops": stops, "pit_duels": duels,
    }


# --- Last year's pit loss at this circuit ---------------------------------------------------------

_prior: Dict[Tuple[int, str], Optional[float]] = {}
_prior_loading: set = set()
_prior_lock = threading.Lock()


def _load_prior(year: int, location: str) -> Optional[float]:
    """The pit loss measured in last year's race at this circuit, or None."""
    from app.services.pit_window import _loaded, tyre_model

    try:
        session = _loaded(year - 1, location, "R", None)
        _, loss, measured = tyre_model(session.laps)
        return round(loss, 3) if measured else None
    except Exception as e:
        print(f"No pit loss from {year - 1} {location}: {e}")
        return None


def prior_pit_loss(year: Optional[int], location: Optional[str], background: bool = True) -> Optional[float]:
    """Last year's pit loss at this circuit. Loading that race takes a while, so it happens in the
    background and None stands in until it's done."""
    if not year or not location:
        return None
    key = (int(year), str(location))
    with _prior_lock:
        if key in _prior:
            return _prior[key]
        if key in _prior_loading:
            return None
        _prior_loading.add(key)

    def load():
        value = _load_prior(*key)
        with _prior_lock:
            _prior[key] = value
            _prior_loading.discard(key)

    if not background:
        load()
        return _prior[key]
    threading.Thread(target=load, name=f"prior-pit-loss-{key[0]}-{key[1]}", daemon=True).start()
    return None
