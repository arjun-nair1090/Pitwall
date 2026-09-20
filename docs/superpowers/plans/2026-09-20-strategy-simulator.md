# Strategy Simulator (Roadmap Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick a hypothetical tire strategy (a sequence of {compound, lap count} stints) for a real past session and get a predicted race time, built from a degradation model fit to that session's *actual* FastF1 lap data — not the static hardcoded rates `ai_strategist.py` uses for live sessions.

**Architecture:** A pure-function prediction core (`strategy_simulator.py`) fits a per-compound `base_pace + deg_rate * tyre_life` linear model from every clean lap in the real session (all drivers pooled, using FastF1's own `TyreLife` column), estimates real pit-lane time loss from the session's actual pit stops, and projects a hypothetical stint plan's total time from that model. A thin FastAPI endpoint loads the session and calls the pure functions. A new `/strategy` frontend page lets a user build a stint plan and see the prediction, optionally compared against a real driver's actual total race time from that same session.

**Tech Stack:** Python (pandas, numpy — both already dependencies), FastAPI, Next.js/React/Recharts (existing frontend stack).

**Spec:** This plan's own Architecture section (no separate spec doc for this phase — the design is compact enough to travel with the plan; see rationale in the conversation this plan was authored in).

## Global Constraints

- Prediction math (`compute_compound_stats`, `estimate_pit_loss_seconds`, `simulate_stint_plan`, `validate_stint_plan`, `get_actual_driver_total_seconds`) must be pure functions taking already-loaded pandas DataFrames — no FastF1/network I/O — so they're directly unit-testable, matching the pattern established in `history_summarizer.py`.
- Valid compound names: `SOFT`, `MEDIUM`, `HARD`, `INTERMEDIATE`, `WET` (same vocabulary as `ai_strategist.py`'s `degradation_rates` dict).
- A compound with fewer than 5 pooled clean laps in the session falls back to `ai_strategist.py`'s static degradation rate for `deg_rate`, and the session's overall fastest lap time for `base_pace` — never crash on sparse data.
- `simulate_stint_plan` must reject a stint plan whose total laps don't match the session's actual race distance, with a clear error message (not a silently-meaningless number).
- No new pip dependencies — `pandas`/`numpy` already in `requirements.txt`.

---

### Task 1: Pure prediction functions

**Files:**
- Create: `backend/app/services/strategy_simulator.py`
- Test: `backend/app/tests/test_strategy_simulator.py`

**Interfaces:**
- Produces:
  - `FALLBACK_DEGRADATION_RATES: Dict[str, float]` (module constant, same values as `ai_strategist.py`'s `degradation_rates`)
  - `compute_compound_stats(laps: pandas.DataFrame) -> Dict[str, Dict[str, float]]` — per compound: `{"base_pace": float, "deg_rate": float, "sample_size": int}`
  - `estimate_pit_loss_seconds(laps: pandas.DataFrame, compound_stats: Dict[str, Dict[str, float]]) -> float`
  - `validate_stint_plan(stints: List[Dict[str, Any]], expected_total_laps: int) -> Optional[str]` — error message or `None`
  - `simulate_stint_plan(compound_stats: Dict[str, Dict[str, float]], stints: List[Dict[str, Any]], pit_loss_seconds: float) -> Dict[str, Any]` — `{"predicted_total_seconds": float, "predicted_avg_lap_seconds": float, "num_pit_stops": int}`
  - `get_actual_driver_total_seconds(laps: pandas.DataFrame, driver_code: str) -> Optional[float]`

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_strategy_simulator.py
import numpy as np
import pandas as pd
import pytest

from app.services.strategy_simulator import (
    FALLBACK_DEGRADATION_RATES,
    compute_compound_stats,
    estimate_pit_loss_seconds,
    get_actual_driver_total_seconds,
    simulate_stint_plan,
    validate_stint_plan,
)


def _lap(driver, lap_number, compound, tyre_life, lap_time_s, pit_in=False, pit_out=False):
    return {
        "Driver": driver,
        "LapNumber": lap_number,
        "Compound": compound,
        "TyreLife": tyre_life,
        "LapTime": pd.Timedelta(seconds=lap_time_s),
        "PitInTime": pd.Timedelta(seconds=1) if pit_in else pd.NaT,
        "PitOutTime": pd.Timedelta(seconds=1) if pit_out else pd.NaT,
    }


def test_compute_compound_stats_fits_base_pace_and_degradation():
    # Perfectly linear synthetic data: MEDIUM starts at 90.0s, degrades 0.1s per lap of age.
    laps = pd.DataFrame([
        _lap("VER", 1, "MEDIUM", 0, 90.0),
        _lap("VER", 2, "MEDIUM", 1, 90.1),
        _lap("VER", 3, "MEDIUM", 2, 90.2),
        _lap("HAM", 1, "MEDIUM", 0, 90.0),
        _lap("HAM", 2, "MEDIUM", 1, 90.1),
        _lap("HAM", 3, "MEDIUM", 2, 90.2),
    ])
    stats = compute_compound_stats(laps)
    assert stats["MEDIUM"]["sample_size"] == 6
    assert stats["MEDIUM"]["base_pace"] == pytest.approx(90.0, abs=0.01)
    assert stats["MEDIUM"]["deg_rate"] == pytest.approx(0.1, abs=0.01)


def test_compute_compound_stats_excludes_pit_in_out_laps():
    laps = pd.DataFrame([
        _lap("VER", 1, "MEDIUM", 0, 90.0),
        _lap("VER", 2, "MEDIUM", 1, 90.1),
        _lap("VER", 3, "MEDIUM", 2, 90.2),
        _lap("VER", 4, "MEDIUM", 3, 130.0, pit_in=True),  # inflated in-lap, must be excluded
    ])
    stats = compute_compound_stats(laps)
    assert stats["MEDIUM"]["sample_size"] == 3
    assert stats["MEDIUM"]["base_pace"] == pytest.approx(90.0, abs=0.01)


def test_compute_compound_stats_falls_back_to_static_rate_when_sparse():
    laps = pd.DataFrame([_lap("VER", 1, "HARD", 0, 91.0)])
    stats = compute_compound_stats(laps)
    assert stats["HARD"]["deg_rate"] == FALLBACK_DEGRADATION_RATES["HARD"]
    assert stats["HARD"]["base_pace"] == pytest.approx(91.0, abs=0.01)


def test_estimate_pit_loss_seconds_from_real_pit_stops():
    compound_stats = {"MEDIUM": {"base_pace": 90.0, "deg_rate": 0.1, "sample_size": 10}, "HARD": {"base_pace": 91.0, "deg_rate": 0.05, "sample_size": 10}}
    laps = pd.DataFrame([
        _lap("VER", 10, "MEDIUM", 9, 91.0, pit_in=True),   # in-lap: 1s over baseline
        _lap("VER", 11, "HARD", 0, 101.0, pit_out=True),   # out-lap: 10s over baseline
    ])
    loss = estimate_pit_loss_seconds(laps, compound_stats)
    assert loss == pytest.approx(11.0, abs=0.1)


def test_estimate_pit_loss_seconds_falls_back_when_no_pit_stops_in_data():
    compound_stats = {"MEDIUM": {"base_pace": 90.0, "deg_rate": 0.1, "sample_size": 10}}
    laps = pd.DataFrame([_lap("VER", 1, "MEDIUM", 0, 90.0)])
    assert estimate_pit_loss_seconds(laps, compound_stats) == 22.0


def test_validate_stint_plan_rejects_lap_count_mismatch():
    error = validate_stint_plan([{"compound": "MEDIUM", "laps": 20}], expected_total_laps=44)
    assert error is not None
    assert "44" in error


def test_validate_stint_plan_rejects_unknown_compound():
    error = validate_stint_plan([{"compound": "SLICK", "laps": 44}], expected_total_laps=44)
    assert error is not None


def test_validate_stint_plan_accepts_matching_plan():
    error = validate_stint_plan([{"compound": "MEDIUM", "laps": 20}, {"compound": "HARD", "laps": 24}], expected_total_laps=44)
    assert error is None


def test_simulate_stint_plan_computes_total_time_and_pit_stops():
    compound_stats = {"MEDIUM": {"base_pace": 90.0, "deg_rate": 0.1, "sample_size": 10}}
    result = simulate_stint_plan(compound_stats, [{"compound": "MEDIUM", "laps": 3}], pit_loss_seconds=22.0)
    # laps at tyre_life 0,1,2 -> 90.0 + 90.1 + 90.2 = 270.3, zero stops (single stint)
    assert result["predicted_total_seconds"] == pytest.approx(270.3, abs=0.01)
    assert result["num_pit_stops"] == 0
    assert result["predicted_avg_lap_seconds"] == pytest.approx(90.1, abs=0.01)


def test_simulate_stint_plan_adds_pit_loss_per_stop():
    compound_stats = {
        "MEDIUM": {"base_pace": 90.0, "deg_rate": 0.0, "sample_size": 10},
        "HARD": {"base_pace": 91.0, "deg_rate": 0.0, "sample_size": 10},
    }
    result = simulate_stint_plan(
        compound_stats,
        [{"compound": "MEDIUM", "laps": 2}, {"compound": "HARD", "laps": 2}],
        pit_loss_seconds=20.0,
    )
    # 2*90 + 2*91 + 1 stop * 20s = 180 + 182 + 20 = 382
    assert result["predicted_total_seconds"] == pytest.approx(382.0, abs=0.01)
    assert result["num_pit_stops"] == 1


def test_get_actual_driver_total_seconds_sums_real_laps():
    laps = pd.DataFrame([
        _lap("VER", 1, "MEDIUM", 0, 90.0),
        _lap("VER", 2, "MEDIUM", 1, 90.1),
        _lap("HAM", 1, "MEDIUM", 0, 89.0),
    ])
    assert get_actual_driver_total_seconds(laps, "VER") == pytest.approx(180.1, abs=0.01)


def test_get_actual_driver_total_seconds_returns_none_for_unknown_driver():
    laps = pd.DataFrame([_lap("VER", 1, "MEDIUM", 0, 90.0)])
    assert get_actual_driver_total_seconds(laps, "XXX") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest app/tests/test_strategy_simulator.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.strategy_simulator'`

- [ ] **Step 3: Implement the module**

```python
# backend/app/services/strategy_simulator.py
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

# Same default assumptions as ai_strategist.py's live-session model -- used only
# as a fallback when a session has too few real laps of a compound to fit from.
FALLBACK_DEGRADATION_RATES = {
    "SOFT": 0.25,
    "MEDIUM": 0.14,
    "HARD": 0.07,
    "WET": 0.40,
    "INTERMEDIATE": 0.30,
}

VALID_COMPOUNDS = set(FALLBACK_DEGRADATION_RATES.keys())
MIN_SAMPLES_FOR_FIT = 5
DEFAULT_PIT_LOSS_SECONDS = 22.0


def _clean_laps(laps: pd.DataFrame) -> pd.DataFrame:
    mask = laps["PitInTime"].isna() & laps["PitOutTime"].isna()
    if "IsAccurate" in laps.columns:
        mask &= laps["IsAccurate"].fillna(True)
    return laps[mask]


def compute_compound_stats(laps: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    clean = _clean_laps(laps)
    overall_fastest = laps["LapTime"].dropna().dt.total_seconds().min() if laps["LapTime"].notna().any() else 90.0

    stats: Dict[str, Dict[str, float]] = {}
    for compound in laps["Compound"].dropna().unique():
        compound_laps = clean[clean["Compound"] == compound]
        sample_size = len(compound_laps)

        if sample_size < MIN_SAMPLES_FOR_FIT:
            stats[compound] = {
                "base_pace": float(overall_fastest),
                "deg_rate": FALLBACK_DEGRADATION_RATES.get(compound, 0.15),
                "sample_size": sample_size,
            }
            continue

        tyre_life = compound_laps["TyreLife"].astype(float).values
        lap_times = compound_laps["LapTime"].dt.total_seconds().values
        deg_rate, base_pace = np.polyfit(tyre_life, lap_times, 1)
        stats[compound] = {
            "base_pace": float(base_pace),
            "deg_rate": float(deg_rate),
            "sample_size": sample_size,
        }
    return stats


def estimate_pit_loss_seconds(laps: pd.DataFrame, compound_stats: Dict[str, Dict[str, float]]) -> float:
    losses = []
    for _, driver_laps in laps.groupby("Driver"):
        driver_laps = driver_laps.sort_values("LapNumber")
        in_laps = driver_laps[driver_laps["PitInTime"].notna()]
        for _, in_lap in in_laps.iterrows():
            out_candidates = driver_laps[driver_laps["LapNumber"] == in_lap["LapNumber"] + 1]
            if out_candidates.empty:
                continue
            out_lap = out_candidates.iloc[0]
            if pd.isna(in_lap["LapTime"]) or pd.isna(out_lap["LapTime"]):
                continue

            in_baseline = compound_stats.get(in_lap["Compound"], {}).get("base_pace")
            out_baseline = compound_stats.get(out_lap["Compound"], {}).get("base_pace")
            if in_baseline is None or out_baseline is None:
                continue

            loss = (in_lap["LapTime"].total_seconds() - in_baseline) + (out_lap["LapTime"].total_seconds() - out_baseline)
            if loss > 0:
                losses.append(loss)

    if not losses:
        return DEFAULT_PIT_LOSS_SECONDS
    return float(np.median(losses))


def validate_stint_plan(stints: List[Dict[str, Any]], expected_total_laps: int) -> Optional[str]:
    if not stints:
        return "Stint plan must include at least one stint."

    for stint in stints:
        compound = stint.get("compound", "").upper()
        if compound not in VALID_COMPOUNDS:
            return f"Unknown compound '{stint.get('compound')}'. Valid compounds: {sorted(VALID_COMPOUNDS)}"
        if not isinstance(stint.get("laps"), int) or stint["laps"] <= 0:
            return f"Stint lap count must be a positive integer, got {stint.get('laps')!r}"

    total_laps = sum(stint["laps"] for stint in stints)
    if total_laps != expected_total_laps:
        return f"Stint plan totals {total_laps} laps but this session's race distance is {expected_total_laps} laps."

    return None


def simulate_stint_plan(
    compound_stats: Dict[str, Dict[str, float]],
    stints: List[Dict[str, Any]],
    pit_loss_seconds: float,
) -> Dict[str, Any]:
    total_seconds = 0.0
    total_laps = 0

    for stint in stints:
        compound = stint["compound"].upper()
        stats = compound_stats.get(compound, {"base_pace": 90.0, "deg_rate": FALLBACK_DEGRADATION_RATES.get(compound, 0.15)})
        for tyre_life in range(stint["laps"]):
            total_seconds += stats["base_pace"] + stats["deg_rate"] * tyre_life
        total_laps += stint["laps"]

    num_pit_stops = max(0, len(stints) - 1)
    total_seconds += num_pit_stops * pit_loss_seconds

    return {
        "predicted_total_seconds": total_seconds,
        "predicted_avg_lap_seconds": total_seconds / total_laps if total_laps else 0.0,
        "num_pit_stops": num_pit_stops,
    }


def get_actual_driver_total_seconds(laps: pd.DataFrame, driver_code: str) -> Optional[float]:
    driver_laps = laps[laps["Driver"] == driver_code]
    if driver_laps.empty:
        return None
    valid_times = driver_laps["LapTime"].dropna()
    if valid_times.empty:
        return None
    return float(valid_times.dt.total_seconds().sum())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest app/tests/test_strategy_simulator.py -v`
Expected: PASS (12 tests). If `estimate_pit_loss_seconds`'s exact numbers don't match (float rounding), adjust the implementation, not the test's documented arithmetic.

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (25 + 12 = 37)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/strategy_simulator.py backend/app/tests/test_strategy_simulator.py
git commit -m "feat: add pure tire-degradation strategy prediction model"
```

---

### Task 2: FastAPI endpoint

**Files:**
- Modify: `backend/app/api/v1/endpoints.py`
- Test: `backend/app/tests/test_endpoints.py`

**Interfaces:**
- Consumes: all of Task 1's functions
- Produces: `POST /api/v1/strategy/simulate`

- [ ] **Step 1: Write the failing test**

```python
# Append to backend/app/tests/test_endpoints.py
from unittest.mock import MagicMock, patch


def test_strategy_simulate_invalid_stint_plan_does_not_crash():
    response = client.post("/api/v1/strategy/simulate", json={
        "year": 2023, "gp": "Belgian Grand Prix", "session": "Race",
        "stints": [{"compound": "MEDIUM", "laps": 5}],
    })
    # FastF1 will actually try to load a real session here; a wildly-wrong lap
    # count should still surface as a 400 validation error, not a 500 crash,
    # once the session loads. If FastF1 itself can't reach network in CI, this
    # comes back as 500 with a network error -- assert it's one or the other,
    # never an unhandled exception (which TestClient would raise, not return).
    assert response.status_code in (400, 500)


def test_strategy_simulate_rejects_malformed_request_body():
    response = client.post("/api/v1/strategy/simulate", json={"year": 2023})
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest app/tests/test_endpoints.py -v -k strategy_simulate`
Expected: FAIL — 404 (route doesn't exist yet), or `test_strategy_simulate_rejects_malformed_request_body` fails on a 404 vs 422 mismatch.

- [ ] **Step 3: Implement the endpoint**

Add near the other strategy-related routes in `backend/app/api/v1/endpoints.py`:

```python
class StintPlan(BaseModel):
    compound: str
    laps: int

class StrategySimulationRequest(BaseModel):
    year: int
    gp: str
    session: Optional[str] = "Race"
    stints: List[StintPlan]
    driver_code: Optional[str] = None

@router.post("/strategy/simulate")
async def simulate_strategy(req: StrategySimulationRequest):
    """Predict a hypothetical tire strategy's race time using a degradation model
    fit to the real session's own lap data."""
    try:
        import asyncio
        from app.services import strategy_simulator

        def _run():
            import fastf1
            session = fastf1.get_session(req.year, req.gp, req.session)
            session.load(laps=True, weather=False, telemetry=False)
            laps = session.laps
            if laps.empty:
                return {"error": "No lap data available for this session."}

            expected_total_laps = int(laps["LapNumber"].max())
            stints = [s.model_dump() for s in req.stints]
            validation_error = strategy_simulator.validate_stint_plan(stints, expected_total_laps)
            if validation_error:
                return {"error": validation_error}

            compound_stats = strategy_simulator.compute_compound_stats(laps)
            pit_loss = strategy_simulator.estimate_pit_loss_seconds(laps, compound_stats)
            prediction = strategy_simulator.simulate_stint_plan(compound_stats, stints, pit_loss)
            prediction["pit_loss_seconds_used"] = pit_loss
            prediction["compound_stats"] = compound_stats

            if req.driver_code:
                actual = strategy_simulator.get_actual_driver_total_seconds(laps, req.driver_code.upper())
                if actual is not None:
                    prediction["actual_driver_total_seconds"] = actual
                    prediction["delta_seconds"] = prediction["predicted_total_seconds"] - actual

            return prediction

        result = await asyncio.to_thread(_run)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest app/tests/test_endpoints.py -v -k strategy_simulate`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full backend suite and compile-check**

Run:
```bash
cd backend
python -m pytest -q
python -m py_compile app/api/v1/endpoints.py app/services/strategy_simulator.py
SECRET_KEY=test RUNNING_LOCALLY=true python -c "from app.main import app; print('OK')"
```
Expected: all tests pass (37 + 2 = 39), no compile errors, `OK` printed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/endpoints.py backend/app/tests/test_endpoints.py
git commit -m "feat: add /strategy/simulate endpoint"
```

---

### Task 3: Frontend strategy simulator page

**Files:**
- Create: `frontend/src/app/strategy/page.tsx`
- Modify: `frontend/src/components/NavigationBar.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/strategy/simulate`, `GET /api/v1/races/historical?year=`, `GET /api/v1/drivers/known-codes` (all existing)
- No automated test for this task (matches the precedent set in Phase 2: frontend UI wiring is verified via `tsc --noEmit`, `next build`, and a manual browser check, not unit tests — there's no existing frontend test harness in this repo to extend).

- [ ] **Step 1: Add the nav link**

In `frontend/src/components/NavigationBar.tsx`, add an icon import and a nav entry:

```tsx
import { Activity, Map, Archive, Home, FlaskConical } from "lucide-react";
```

```tsx
    { name: "Strategy", path: "/strategy", icon: <FlaskConical className="h-4 w-4" /> },
```
(inserted after the "Advanced" entry, before "Archives")

- [ ] **Step 2: Build the page**

```tsx
// frontend/src/app/strategy/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { FlaskConical, Loader2, AlertTriangle, Plus, Trash2 } from "lucide-react";

interface Stint {
  compound: string;
  laps: number;
}

interface SimulationResult {
  predicted_total_seconds: number;
  predicted_avg_lap_seconds: number;
  num_pit_stops: number;
  pit_loss_seconds_used: number;
  actual_driver_total_seconds?: number;
  delta_seconds?: number;
}

const COMPOUNDS = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(3);
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.padStart(6, "0")}` : `${m}:${s.padStart(6, "0")}`;
}

export default function StrategySimulatorPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [gp, setGp] = useState("");
  const [availableGPs, setAvailableGPs] = useState<string[]>([]);
  const [driverCode, setDriverCode] = useState("");
  const [availableDrivers, setAvailableDrivers] = useState<string[]>([]);
  const [stints, setStints] = useState<Stint[]>([{ compound: "MEDIUM", laps: 20 }]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`/api/v1/races/historical?year=${year}`).then((res) => {
      const gps = res.data.map((r: any) => r.country);
      setAvailableGPs(gps);
      if (!gps.includes(gp)) setGp(gps[0] || "");
    }).catch(() => {});

    axios.get("/api/v1/drivers/known-codes").then((res) => {
      setAvailableDrivers(res.data.driver_standings.map((d: any) => d.driver_code));
    }).catch(() => {});
  }, [year]);

  const totalLaps = stints.reduce((sum, s) => sum + (s.laps || 0), 0);

  const updateStint = (index: number, patch: Partial<Stint>) => {
    setStints((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addStint = () => setStints((prev) => [...prev, { compound: "HARD", laps: 15 }]);
  const removeStint = (index: number) => setStints((prev) => prev.filter((_, i) => i !== index));

  const runSimulation = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await axios.post<SimulationResult>("/api/v1/strategy/simulate", {
        year,
        gp,
        session: "Race",
        stints,
        ...(driverCode && { driver_code: driverCode.toUpperCase() }),
      });
      setResult(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Simulation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-fade-in flex flex-col">
      <div className="border-b border-white/10 pb-6">
        <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
          <FlaskConical className="w-8 h-8 text-f1-red" />
          Strategy Simulator
        </h1>
        <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
          Predict a hypothetical tire strategy using a degradation model fit to the real session
        </p>
      </div>

      <div className="glass-panel p-6 rounded-xl border border-white/5 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">YEAR</label>
            <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">GRAND PRIX</label>
            <select value={gp} onChange={(e) => setGp(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
              {availableGPs.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">COMPARE TO DRIVER (OPTIONAL)</label>
            <select value={driverCode} onChange={(e) => setDriverCode(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
              <option value="">None</option>
              {availableDrivers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-titillium font-bold text-white/60">STINT PLAN ({totalLaps} laps total)</label>
            <button onClick={addStint} className="flex items-center gap-1 text-xs text-f1-red hover:text-red-400 font-bold">
              <Plus className="w-3.5 h-3.5" /> ADD STINT
            </button>
          </div>
          <div className="space-y-2">
            {stints.map((stint, i) => (
              <div key={i} className="flex items-center gap-3 bg-black/30 p-3 rounded-md border border-white/5">
                <span className="text-xs text-white/40 font-bold w-16">STINT {i + 1}</span>
                <select value={stint.compound} onChange={(e) => updateStint(i, { compound: e.target.value })} className="bg-black/50 border border-white/10 text-white rounded-md px-3 py-1.5 text-sm font-titillium">
                  {COMPOUNDS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="number"
                  value={stint.laps}
                  onChange={(e) => updateStint(i, { laps: parseInt(e.target.value) || 0 })}
                  className="w-20 bg-black/50 border border-white/10 text-white rounded-md px-3 py-1.5 text-sm font-titillium"
                />
                <span className="text-xs text-white/40">laps</span>
                {stints.length > 1 && (
                  <button onClick={() => removeStint(i)} className="ml-auto text-white/30 hover:text-f1-red">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={runSimulation}
          disabled={loading || !gp}
          className="bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2.5 px-8 rounded-md transition-colors flex items-center gap-2 disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          RUN SIMULATION
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg font-titillium flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      {result && (
        <div className="glass-panel p-6 rounded-xl border border-f1-red/30 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-[10px] text-white/40 uppercase">Predicted Total Time</div>
            <div className="text-2xl font-bold text-white font-titillium mt-1">{formatTime(result.predicted_total_seconds)}</div>
          </div>
          <div>
            <div className="text-[10px] text-white/40 uppercase">Avg Lap</div>
            <div className="text-2xl font-bold text-white font-titillium mt-1">{result.predicted_avg_lap_seconds.toFixed(3)}s</div>
          </div>
          <div>
            <div className="text-[10px] text-white/40 uppercase">Pit Stops</div>
            <div className="text-2xl font-bold text-white font-titillium mt-1">{result.num_pit_stops} <span className="text-xs text-white/40">(~{result.pit_loss_seconds_used.toFixed(1)}s each)</span></div>
          </div>
          {result.delta_seconds !== undefined && (
            <div>
              <div className="text-[10px] text-white/40 uppercase">vs Actual Race</div>
              <div className={`text-2xl font-bold font-titillium mt-1 ${result.delta_seconds < 0 ? "text-f1-green" : "text-f1-red"}`}>
                {result.delta_seconds < 0 ? "-" : "+"}{Math.abs(result.delta_seconds).toFixed(1)}s
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check and build**

Run:
```bash
cd frontend
npx tsc --noEmit
npx next build
```
Expected: both clean, `/strategy` listed in the build's route table.

- [ ] **Step 4: Manual browser check**

Start the dev server, navigate to `/strategy`, confirm: the page renders, the nav bar shows "Strategy" and highlights it as active, adding/removing stint rows works, and the total-laps counter updates live. A live backend isn't required for this check (form interaction is pure client state); submitting without a backend should show the error banner via the caught `axios` rejection, not a crash.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/strategy/ frontend/src/components/NavigationBar.tsx
git commit -m "feat: add strategy simulator frontend page"
```
