"""What-if counterfactuals on a real driver's race strategy.

"What if Verstappen had pitted 5 laps later?" is answered by simulating both the
driver's *actual* stint plan and the modified one with the same tyre-degradation
model (fit to that session's own laps -- see strategy_simulator), then reporting the
difference. Comparing model-to-model cancels out most of the model's bias, which
makes the delta far more trustworthy than the model's absolute race time.

As with the debrief, the numbers come from deterministic code; an LLM is only
asked to explain them, and its output is discarded unless it cites the real result."""
import json
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from app.services import strategy_simulator as sim

NEGLIGIBLE_DELTA_SECONDS = 0.05
MODEL_ERROR_WARN_FRACTION = 0.02
MAX_EXPLANATION_CHARS = 1500

MODEL_LIMITATIONS = (
    "This is a model estimate built from this race's own tyre data. It ignores traffic, "
    "safety cars, fuel load, track evolution and how a different strategy would have changed "
    "the race around the driver."
)


class WhatIfError(ValueError):
    """The hypothetical can't be evaluated (invalid change, or no data for the driver)."""


# --- stints ------------------------------------------------------------------------

def extract_driver_stints(laps: pd.DataFrame, driver_code: str) -> List[Dict[str, Any]]:
    driver_laps = laps[(laps["Driver"] == driver_code) & laps["Stint"].notna()]
    stints = []
    for _, stint_laps in driver_laps.groupby("Stint", sort=True):
        compounds = stint_laps["Compound"].dropna()
        compound = str(Counter(compounds).most_common(1)[0][0]).upper() if len(compounds) else "UNKNOWN"
        stints.append({"compound": compound, "laps": int(len(stint_laps))})
    return stints


def _pit_laps(stints: List[Dict[str, Any]]) -> List[int]:
    laps, total = [], 0
    for stint in stints[:-1]:
        total += stint["laps"]
        laps.append(total)
    return laps


def _plural(n: int, noun: str) -> str:
    return f"{n} {noun}{'' if n == 1 else 's'}"


def apply_changes(stints: List[Dict[str, Any]], changes: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Apply hypothetical changes in order. Returns (new stints, descriptions). Never mutates ``stints``."""
    current = [dict(s) for s in stints]
    described: List[str] = []

    for change in changes:
        kind = change.get("type")

        if kind == "shift_stop":
            stop, shift = change.get("stop"), change.get("laps")
            if not isinstance(stop, int) or not isinstance(shift, int) or isinstance(shift, bool):
                raise WhatIfError("A pit-stop change needs a stop number and a whole number of laps.")
            stops_made = len(current) - 1
            if stop < 1 or stop > stops_made:
                raise WhatIfError(f"This driver made {_plural(stops_made, 'stop')}, so there is no stop {stop}.")
            if shift == 0:
                raise WhatIfError("Shifting a stop by 0 laps changes nothing.")
            before, after = _pit_laps(current)[stop - 1], None
            earlier, later = current[stop - 1], current[stop]
            if earlier["laps"] + shift < 1 or later["laps"] - shift < 1:
                raise WhatIfError(
                    f"Moving stop {stop} by {shift:+d} laps would leave a stint with no laps "
                    f"(stint {stop} has {earlier['laps']}, stint {stop + 1} has {later['laps']})."
                )
            earlier["laps"] += shift
            later["laps"] -= shift
            after = before + shift
            direction = "later" if shift > 0 else "earlier"
            described.append(
                f"moved pit stop {stop} from lap {before} to lap {after} ({_plural(abs(shift), 'lap')} {direction})"
            )

        elif kind == "change_compound":
            stint_number, compound = change.get("stint"), str(change.get("compound", "")).upper()
            if not isinstance(stint_number, int) or stint_number < 1 or stint_number > len(current):
                raise WhatIfError(f"This driver ran {_plural(len(current), 'stint')}, so there is no stint {stint_number}.")
            if compound not in sim.VALID_COMPOUNDS:
                raise WhatIfError(f"Unknown compound '{change.get('compound')}'. Valid compounds: {sorted(sim.VALID_COMPOUNDS)}")
            old = current[stint_number - 1]["compound"]
            current[stint_number - 1]["compound"] = compound
            described.append(f"used {compound} instead of {old} in stint {stint_number}")

        else:
            raise WhatIfError(f"Unknown change type {kind!r}.")

    return current, described


# --- simulation ---------------------------------------------------------------------

def compute_whatif(laps: pd.DataFrame, driver_code: str, changes: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not changes:
        raise WhatIfError("Describe at least one change to evaluate.")

    actual_stints = extract_driver_stints(laps, driver_code)
    if not actual_stints:
        raise WhatIfError(f"No lap data found for driver {driver_code} in this session.")
    if any(s["compound"] not in sim.VALID_COMPOUNDS for s in actual_stints):
        raise WhatIfError(f"The tyre data for {driver_code} in this session is incomplete, so a what-if can't be modelled.")

    modified_stints, described = apply_changes(actual_stints, changes)

    stats = sim.compute_compound_stats(laps)
    pit_loss = sim.estimate_pit_loss_seconds(laps, stats)

    # A hypothetical compound nobody ran in this session has no data at all. Give it
    # the session's fastest measured pace and a default degradation rate, and say so.
    used = {s["compound"] for s in actual_stints} | {s["compound"] for s in modified_stints}
    fallback_pace = min((v["base_pace"] for v in stats.values()), default=90.0)
    stats = dict(stats)
    for compound in used - set(stats):
        stats[compound] = {
            "base_pace": fallback_pace,
            "deg_rate": sim.FALLBACK_DEGRADATION_RATES.get(compound, 0.15),
            "sample_size": 0,
        }

    baseline = sim.simulate_stint_plan(stats, actual_stints, pit_loss)
    modified = sim.simulate_stint_plan(stats, modified_stints, pit_loss)
    delta = float(modified["predicted_total_seconds"] - baseline["predicted_total_seconds"])
    baseline_seconds = float(baseline["predicted_total_seconds"])

    actual_seconds = sim.get_actual_driver_total_seconds(laps, driver_code)
    model_error = float(baseline_seconds - actual_seconds) if actual_seconds is not None else None

    notes: List[str] = []
    confidence = "medium"
    for compound in sorted(used):
        samples = int(stats[compound]["sample_size"])
        if samples == 0:
            confidence = "low"
            notes.append(
                f"No {compound} laps were run in this session, so its pace is assumed from the session's fastest "
                f"compound and its degradation from a default rate."
            )
        elif samples < sim.MIN_SAMPLES_FOR_FIT:
            confidence = "low"
            notes.append(f"Only {samples} clean {compound} laps in this session, so its degradation is a rough estimate.")

    race_laps = int(laps["LapNumber"].max())
    driver_laps = sum(s["laps"] for s in actual_stints)
    if driver_laps < race_laps:
        notes.append(f"{driver_code} ran {driver_laps} of {race_laps} laps, so this covers only the laps they completed.")
    if model_error is not None and actual_seconds and abs(model_error) > MODEL_ERROR_WARN_FRACTION * actual_seconds:
        notes.append(
            f"The model's baseline differs from {driver_code}'s real race time by {abs(model_error):.0f}s, "
            f"so treat the delta as directional."
        )
    notes.append(MODEL_LIMITATIONS)

    return {
        "driver": driver_code,
        "changes": described,
        "actual_stints": actual_stints,
        "modified_stints": modified_stints,
        "actual_pit_laps": _pit_laps(actual_stints),
        "modified_pit_laps": _pit_laps(modified_stints),
        "baseline_seconds": baseline_seconds,
        "modified_seconds": float(modified["predicted_total_seconds"]),
        "delta_seconds": delta,
        "actual_seconds": float(actual_seconds) if actual_seconds is not None else None,
        "model_error_seconds": model_error,
        "pit_loss_seconds": float(pit_loss),
        "confidence": confidence,
        "notes": notes,
    }


# --- explanation --------------------------------------------------------------------

def _direction(delta: float) -> Optional[str]:
    if abs(delta) < NEGLIGIBLE_DELTA_SECONDS:
        return None
    return "faster" if delta < 0 else "slower"


def render_template_explanation(result: Dict[str, Any]) -> str:
    driver = result["driver"]
    what = " and ".join(result["changes"])
    direction = _direction(result["delta_seconds"])

    if direction is None:
        outcome = "the model finds no meaningful difference in race time"
    else:
        outcome = f"the model estimates a race time about {abs(result['delta_seconds']):.1f} seconds {direction}"
    text = f"If {driver} had {what}, {outcome}."

    if result["model_error_seconds"] is not None:
        text += f" (The same model reproduces {driver}'s actual race time to within {abs(result['model_error_seconds']):.0f} seconds.)"
    if result["confidence"] == "low":
        text += " Confidence is low: " + next((n for n in result["notes"] if n != MODEL_LIMITATIONS), "the underlying tyre data is thin.")
    return text


_SYSTEM_PROMPT = (
    "You are an F1 strategy analyst explaining a what-if result to a fan.\n"
    "Use ONLY the numbers and facts in the JSON data block. Do not invent lap times, positions, weather, "
    "incidents or causes. The delta_seconds field is modified minus baseline: negative means the modified "
    "strategy is FASTER, positive means SLOWER. State the size of the difference in seconds exactly as given "
    "(one decimal place), say what changed, note the confidence, and mention that it is a model estimate. "
    "Write 2-4 plain sentences. No headings or bullet points."
)


def build_whatif_prompt(result: Dict[str, Any]) -> Tuple[str, str]:
    user = "Explain this what-if result.\n\n```json\n" + json.dumps(result, indent=2) + "\n```"
    return _SYSTEM_PROMPT, user


def explanation_is_grounded(text: Optional[str], result: Dict[str, Any]) -> bool:
    """The text must cite the real delta (to one decimal) and stay a reasonable length. A model that
    hand-waves ("much faster!") or quotes a number it made up is discarded in favour of the template."""
    if not text or not text.strip() or len(text) > MAX_EXPLANATION_CHARS:
        return False
    return f"{abs(result['delta_seconds']):.1f}" in text


async def explain(result: Dict[str, Any], engineer: Any) -> Dict[str, str]:
    system, user = build_whatif_prompt(result)
    try:
        text = await engineer.generate_text(system, user, max_tokens=2048)
    except Exception:
        text = None
    if explanation_is_grounded(text, result):
        return {"explanation": text.strip(), "source": "ai"}
    return {"explanation": render_template_explanation(result), "source": "template"}
