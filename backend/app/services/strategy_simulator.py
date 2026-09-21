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
FUEL_MIN_LAPS = 30  # fewer clean laps than this can't separate fuel burn from tyre wear
FUEL_MAX_CONDITION = 1e5  # design-matrix conditioning above this means wear and fuel are entangled
DEFAULT_PIT_LOSS_SECONDS = 22.0


def _clean_laps(laps: pd.DataFrame) -> pd.DataFrame:
    mask = laps["PitInTime"].isna() & laps["PitOutTime"].isna()
    if "IsAccurate" in laps.columns:
        mask &= laps["IsAccurate"].fillna(True)
    return laps[mask]


def _fit_laps(laps: pd.DataFrame) -> pd.DataFrame:
    """Representative racing laps to fit from: no pit laps, no inaccurate laps, and nothing slower
    than 107% of the typical lap (safety cars, spins)."""
    clean = _clean_laps(laps).dropna(subset=["LapTime", "TyreLife", "LapNumber", "Compound"])
    if clean.empty:
        return clean
    seconds = clean["LapTime"].dt.total_seconds()
    return clean[seconds <= seconds.median() * 1.07]


def _estimate_fuel_rate(fit: pd.DataFrame) -> float:
    """Seconds gained per lap as the car burns fuel (<= 0), separated from tyre wear.

    Tyre age and lap number only come apart once drivers pit at different times, so this fits every
    compound's pace and wear together with one shared lap-number slope, and only trusts it when the
    data can actually tell the two apart. Otherwise there is no correction (0.0)."""
    if len(fit) < FUEL_MIN_LAPS:
        return 0.0
    counts = fit["Compound"].value_counts()
    usable = [c for c, n in counts.items() if n >= MIN_SAMPLES_FOR_FIT]
    if not usable:
        return 0.0
    sub = fit[fit["Compound"].isin(usable)]
    tyre_life = sub["TyreLife"].astype(float).to_numpy()
    lap_number = sub["LapNumber"].astype(float).to_numpy()
    seconds = sub["LapTime"].dt.total_seconds().to_numpy()

    columns = []
    for compound in usable:
        mask = (sub["Compound"] == compound).to_numpy().astype(float)
        columns.extend([mask, mask * tyre_life])
    columns.append(lap_number)
    design = np.column_stack(columns)
    if np.linalg.matrix_rank(design) < design.shape[1] or np.linalg.cond(design) > FUEL_MAX_CONDITION:
        return 0.0
    coefficients, *_ = np.linalg.lstsq(design, seconds, rcond=None)
    return float(min(coefficients[-1], 0.0))


def compute_compound_stats(laps: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    """Per-compound pace (on fresh tyres, full fuel) and wear, plus one shared fuel-burn slope.

    Lap times are first corrected for fuel burn-off. Without that, cars simply getting lighter
    hides real tyre wear and every compound appears to improve with age."""
    fit = _fit_laps(laps)
    fuel_rate = _estimate_fuel_rate(fit)
    overall_fastest = laps["LapTime"].dropna().dt.total_seconds().min() if laps["LapTime"].notna().any() else 90.0

    stats: Dict[str, Dict[str, float]] = {}
    for compound in laps["Compound"].dropna().unique():
        compound_laps = fit[fit["Compound"] == compound]
        sample_size = len(compound_laps)

        if sample_size < MIN_SAMPLES_FOR_FIT:
            stats[compound] = {
                "base_pace": float(overall_fastest),
                "deg_rate": FALLBACK_DEGRADATION_RATES.get(compound, 0.15),
                "fuel_rate": fuel_rate,
                "sample_size": sample_size,
            }
            continue

        tyre_life = compound_laps["TyreLife"].astype(float).to_numpy()
        lap_number = compound_laps["LapNumber"].astype(float).to_numpy()
        # Put every lap back at full-fuel pace so what remains is wear.
        lap_times = compound_laps["LapTime"].dt.total_seconds().to_numpy() - fuel_rate * (lap_number - 1)
        raw_rate, base_pace = np.polyfit(tyre_life, lap_times, 1)
        deg_rate = max(float(raw_rate), 0.0)  # tyres don't get faster with age; the rest is track evolution
        if raw_rate < 0:
            base_pace = float(np.mean(lap_times))
        stats[compound] = {
            "base_pace": float(base_pace),
            "deg_rate": deg_rate,
            "deg_rate_raw": float(raw_rate),
            "fuel_rate": fuel_rate,
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
        compound = str(stint.get("compound", "")).upper()
        if compound not in VALID_COMPOUNDS:
            return f"Unknown compound '{stint.get('compound')}'. Valid compounds: {sorted(VALID_COMPOUNDS)}"
        if not isinstance(stint.get("laps"), int) or stint["laps"] <= 0:
            return f"Stint lap count must be a positive integer, got {stint.get('laps')!r}"

    total_laps = sum(stint["laps"] for stint in stints)
    if total_laps != expected_total_laps:
        gap = abs(expected_total_laps - total_laps)
        direction = "short" if total_laps < expected_total_laps else "over"
        return (
            f"Your plan covers {total_laps} laps but this race is {expected_total_laps} laps long: "
            f"{gap} lap{'s' if gap != 1 else ''} {direction}."
        )

    return None


def simulate_stint_plan(
    compound_stats: Dict[str, Dict[str, float]],
    stints: List[Dict[str, Any]],
    pit_loss_seconds: float,
) -> Dict[str, Any]:
    total_seconds = 0.0
    race_lap = 0  # 0-based lap of the race, so fuel burn-off accumulates across stints
    stint_results = []

    for stint in stints:
        compound = stint["compound"].upper()
        stats = compound_stats.get(compound, {"base_pace": 90.0, "deg_rate": FALLBACK_DEGRADATION_RATES.get(compound, 0.15)})
        fuel_rate = stats.get("fuel_rate", 0.0)
        start_lap = race_lap + 1
        stint_seconds = 0.0
        for tyre_life in range(stint["laps"]):
            stint_seconds += stats["base_pace"] + stats["deg_rate"] * tyre_life + fuel_rate * race_lap
            race_lap += 1
        total_seconds += stint_seconds
        stint_results.append({
            "compound": compound,
            "laps": stint["laps"],
            "start_lap": start_lap,
            "end_lap": race_lap,
            "seconds": stint_seconds,
            "avg_lap_seconds": stint_seconds / stint["laps"],
        })

    num_pit_stops = max(0, len(stints) - 1)
    total_seconds += num_pit_stops * pit_loss_seconds

    return {
        "predicted_total_seconds": total_seconds,
        "predicted_avg_lap_seconds": total_seconds / race_lap if race_lap else 0.0,
        "num_pit_stops": num_pit_stops,
        "stints": stint_results,
    }


def get_actual_driver_total_seconds(
    laps: pd.DataFrame, driver_code: str, expected_laps: Optional[int] = None
) -> Optional[float]:
    """The driver's real race time, or None if it can't be compared like for like.

    A driver who stopped short of the race distance has no comparable total. Prefer the clock
    (end of the last lap minus the start of the first) since lap 1 often has no lap time."""
    driver_laps = laps[laps["Driver"] == driver_code]
    if driver_laps.empty:
        return None
    if expected_laps is not None and driver_laps["LapNumber"].max() < expected_laps:
        return None

    if {"LapStartTime", "Time"} <= set(driver_laps.columns):
        ordered = driver_laps.sort_values("LapNumber")
        start, end = ordered["LapStartTime"].iloc[0], ordered["Time"].iloc[-1]
        if pd.notna(start) and pd.notna(end):
            return float((end - start).total_seconds())

    valid_times = driver_laps["LapTime"].dropna()
    if valid_times.empty:
        return None
    return float(valid_times.dt.total_seconds().sum())
