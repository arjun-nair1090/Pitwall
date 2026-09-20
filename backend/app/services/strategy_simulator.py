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
        compound = str(stint.get("compound", "")).upper()
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
