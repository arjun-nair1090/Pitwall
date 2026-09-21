import json

import pandas as pd
import pytest

from app.services import whatif
from app.services.whatif import WhatIfError

# Noiseless synthetic race so results can be checked against closed-form arithmetic:
#   MEDIUM lap time = 90 + 0.10 * tyre_life      HARD lap time = 91 + 0.06 * tyre_life
# (tyre_life counted from 0). Both drivers run MEDIUM x8 then HARD x12 (20 laps).
MED_BASE, MED_DEG = 90.0, 0.10
HARD_BASE, HARD_DEG = 91.0, 0.06


def _lap_rows(driver, plan, pit_penalty=20.0):
    rows, lap = [], 0
    for stint_number, (compound, count) in enumerate(plan, start=1):
        base, deg = (MED_BASE, MED_DEG) if compound == "MEDIUM" else (HARD_BASE, HARD_DEG)
        for i in range(count):
            lap += 1
            is_in = i == count - 1 and stint_number < len(plan)
            is_out = i == 0 and stint_number > 1
            rows.append({
                "Driver": driver, "LapNumber": float(lap), "Stint": float(stint_number), "Compound": compound,
                "TyreLife": float(i), "LapTime": pd.Timedelta(seconds=base + deg * i + (pit_penalty if is_in or is_out else 0.0)),
                "PitInTime": pd.Timedelta(seconds=1) if is_in else pd.NaT,
                "PitOutTime": pd.Timedelta(seconds=1) if is_out else pd.NaT,
                "IsAccurate": True,
            })
    return rows


@pytest.fixture
def laps():
    plan = [("MEDIUM", 8), ("HARD", 12)]
    return pd.DataFrame(_lap_rows("VER", plan) + _lap_rows("NOR", plan))


# --- extract_driver_stints -------------------------------------------------------

def test_extract_driver_stints_returns_compound_and_lap_count_per_stint(laps):
    assert whatif.extract_driver_stints(laps, "VER") == [
        {"compound": "MEDIUM", "laps": 8}, {"compound": "HARD", "laps": 12},
    ]


def test_extract_driver_stints_is_empty_for_an_unknown_driver(laps):
    assert whatif.extract_driver_stints(laps, "ZZZ") == []


# --- apply_changes ----------------------------------------------------------------

STINTS = [{"compound": "MEDIUM", "laps": 8}, {"compound": "HARD", "laps": 12}]


def test_shifting_a_stop_later_lengthens_the_earlier_stint_and_shortens_the_next():
    new, _ = whatif.apply_changes(STINTS, [{"type": "shift_stop", "stop": 1, "laps": 2}])
    assert [s["laps"] for s in new] == [10, 10]


def test_shifting_a_stop_earlier_does_the_reverse():
    new, _ = whatif.apply_changes(STINTS, [{"type": "shift_stop", "stop": 1, "laps": -3}])
    assert [s["laps"] for s in new] == [5, 15]


def test_apply_changes_never_mutates_its_input():
    whatif.apply_changes(STINTS, [{"type": "shift_stop", "stop": 1, "laps": 2}])
    assert STINTS == [{"compound": "MEDIUM", "laps": 8}, {"compound": "HARD", "laps": 12}]


def test_shifting_preserves_total_race_laps():
    new, _ = whatif.apply_changes(STINTS, [{"type": "shift_stop", "stop": 1, "laps": 5}])
    assert sum(s["laps"] for s in new) == 20


@pytest.mark.parametrize("laps_shift", [12, 13, -8, -9])
def test_a_shift_that_leaves_a_stint_with_no_laps_is_rejected(laps_shift):
    with pytest.raises(WhatIfError):
        whatif.apply_changes(STINTS, [{"type": "shift_stop", "stop": 1, "laps": laps_shift}])


def test_shifting_a_stop_the_driver_never_made_is_rejected():
    with pytest.raises(WhatIfError, match="1 stop"):
        whatif.apply_changes(STINTS, [{"type": "shift_stop", "stop": 2, "laps": 1}])


def test_a_zero_lap_shift_is_rejected_as_a_no_op():
    with pytest.raises(WhatIfError):
        whatif.apply_changes(STINTS, [{"type": "shift_stop", "stop": 1, "laps": 0}])


def test_changing_a_stints_compound():
    new, _ = whatif.apply_changes(STINTS, [{"type": "change_compound", "stint": 1, "compound": "hard"}])
    assert new[0] == {"compound": "HARD", "laps": 8}


def test_changing_to_an_unknown_compound_or_missing_stint_is_rejected():
    with pytest.raises(WhatIfError):
        whatif.apply_changes(STINTS, [{"type": "change_compound", "stint": 1, "compound": "PURPLE"}])
    with pytest.raises(WhatIfError):
        whatif.apply_changes(STINTS, [{"type": "change_compound", "stint": 3, "compound": "SOFT"}])


def test_apply_changes_rejects_an_unknown_change_type():
    with pytest.raises(WhatIfError):
        whatif.apply_changes(STINTS, [{"type": "teleport"}])


def test_changes_apply_in_order_and_are_described_in_words():
    new, described = whatif.apply_changes(STINTS, [
        {"type": "shift_stop", "stop": 1, "laps": 2},
        {"type": "change_compound", "stint": 2, "compound": "MEDIUM"},
    ])
    assert new == [{"compound": "MEDIUM", "laps": 10}, {"compound": "MEDIUM", "laps": 10}]
    assert any("2 laps later" in d and "lap 8" in d and "lap 10" in d for d in described)
    assert any("MEDIUM" in d and "HARD" in d for d in described)


# --- compute_whatif ------------------------------------------------------------------

def test_pitting_two_laps_later_matches_the_closed_form_delta(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 2}])
    # MEDIUM laps 8,9 replace HARD laps 10,11:  (90.8 + 90.9) - (91.6 + 91.66) = -1.56
    assert result["delta_seconds"] == pytest.approx(-1.56, abs=1e-6)
    assert result["modified_seconds"] == pytest.approx(result["baseline_seconds"] - 1.56, abs=1e-6)


def test_switching_a_stint_to_a_slower_compound_matches_the_closed_form_delta(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "change_compound", "stint": 1, "compound": "HARD"}])
    # 8 laps on HARD instead of MEDIUM: 8*(91-90) + (0.06-0.10)*(0+1+...+7) = 8 - 1.12 = +6.88
    assert result["delta_seconds"] == pytest.approx(6.88, abs=1e-6)


def test_result_reports_actual_and_modified_plans_and_pit_laps(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 2}])
    assert result["driver"] == "VER"
    assert result["actual_stints"] == [{"compound": "MEDIUM", "laps": 8}, {"compound": "HARD", "laps": 12}]
    assert result["modified_stints"] == [{"compound": "MEDIUM", "laps": 10}, {"compound": "HARD", "laps": 10}]
    assert result["actual_pit_laps"] == [8]
    assert result["modified_pit_laps"] == [10]


def test_result_compares_the_model_against_the_drivers_real_race_time(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 2}])
    assert result["actual_seconds"] == pytest.approx(laps[laps["Driver"] == "VER"]["LapTime"].dt.total_seconds().sum())
    assert result["model_error_seconds"] == pytest.approx(result["baseline_seconds"] - result["actual_seconds"])


def test_a_compound_with_no_laps_in_the_session_lowers_confidence_and_says_so(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "change_compound", "stint": 2, "compound": "SOFT"}])
    assert result["confidence"] == "low"
    assert any("SOFT" in note for note in result["notes"])


def test_confidence_is_medium_when_every_compound_has_real_data(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 1}])
    assert result["confidence"] == "medium"


def test_notes_always_include_the_model_limitations(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 1}])
    assert any("traffic" in note.lower() for note in result["notes"])


def test_compute_whatif_rejects_a_driver_with_no_lap_data(laps):
    with pytest.raises(WhatIfError, match="ZZZ"):
        whatif.compute_whatif(laps, "ZZZ", [{"type": "shift_stop", "stop": 1, "laps": 1}])


def test_compute_whatif_requires_at_least_one_change(laps):
    with pytest.raises(WhatIfError):
        whatif.compute_whatif(laps, "VER", [])


def test_compute_whatif_propagates_invalid_changes(laps):
    with pytest.raises(WhatIfError):
        whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 99}])


def test_result_is_json_serialisable(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 2}])
    json.dumps(result)


# --- explanation ---------------------------------------------------------------------

@pytest.fixture
def faster(laps):
    return whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 2}])


def test_template_explanation_states_direction_magnitude_and_the_caveat(faster):
    text = whatif.render_template_explanation(faster)
    assert "VER" in text and "1.6" in text and "faster" in text.lower()
    assert "estimate" in text.lower()
    # The full limitations text is returned once, as a note -- not repeated in the explanation.
    assert whatif.MODEL_LIMITATIONS not in text


def test_template_explanation_says_slower_for_a_positive_delta(laps):
    slower = whatif.compute_whatif(laps, "VER", [{"type": "change_compound", "stint": 1, "compound": "HARD"}])
    assert "slower" in whatif.render_template_explanation(slower).lower()


def test_template_explanation_handles_a_negligible_difference(laps):
    result = whatif.compute_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 1}])
    result = {**result, "delta_seconds": 0.01}
    assert "no meaningful difference" in whatif.render_template_explanation(result).lower()


def test_prompt_supplies_the_numbers_and_forbids_inventing_others(faster):
    system, user = whatif.build_whatif_prompt(faster)
    assert "only" in system.lower() and "invent" in system.lower()
    assert "delta_seconds" in user and "VER" in user


@pytest.mark.parametrize("text, expected", [
    ("Pitting later would have saved about 1.6 seconds.", True),
    ("It would have been quicker.", False),                # cites no number from the model
    ("", False),
    ("It would save 99.9 seconds.", False),               # a number the model did not produce
    ("x " * 1000 + "1.6", False),                          # runaway
])
def test_explanation_grounding_requires_the_models_own_number(faster, text, expected):
    assert whatif.explanation_is_grounded(text, faster) is expected


class _Engineer:
    def __init__(self, text=None, error=None):
        self._text, self._error = text, error

    async def generate_text(self, system_prompt, user_prompt, **kwargs):
        if self._error:
            raise self._error
        return self._text


@pytest.mark.asyncio
async def test_explain_uses_grounded_ai_text(faster):
    out = await whatif.explain(faster, _Engineer("An extra two laps on mediums saves roughly 1.6 seconds."))
    assert out["source"] == "ai" and "1.6" in out["explanation"]


@pytest.mark.asyncio
@pytest.mark.parametrize("engineer", [_Engineer(None), _Engineer("Much faster!"), _Engineer(error=RuntimeError("x"))])
async def test_explain_falls_back_to_the_template(faster, engineer):
    out = await whatif.explain(faster, engineer)
    assert out["source"] == "template"
    assert "1.6" in out["explanation"]


# --- LangGraph flow --------------------------------------------------------------------

from unittest.mock import patch  # noqa: E402

from app.services import whatif_graph  # noqa: E402


@pytest.mark.asyncio
async def test_graph_simulates_then_explains(laps):
    with patch.object(whatif_graph, "ai_engineer", _Engineer("Pitting later saves about 1.6 seconds.")):
        out = await whatif_graph.run_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 2}])
    assert out["result"]["delta_seconds"] == pytest.approx(-1.56, abs=1e-6)
    assert out["explanation"] == "Pitting later saves about 1.6 seconds."
    assert out["explanation_source"] == "ai"


@pytest.mark.asyncio
async def test_graph_falls_back_to_the_template_when_no_llm_is_available(laps):
    with patch.object(whatif_graph, "ai_engineer", _Engineer(None)):
        out = await whatif_graph.run_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 2}])
    assert out["explanation_source"] == "template"
    assert "1.6" in out["explanation"]


@pytest.mark.asyncio
async def test_graph_surfaces_an_invalid_hypothetical_as_whatif_error(laps):
    with patch.object(whatif_graph, "ai_engineer", _Engineer(None)):
        with pytest.raises(WhatIfError):
            await whatif_graph.run_whatif(laps, "VER", [{"type": "shift_stop", "stop": 1, "laps": 500}])


@pytest.mark.asyncio
async def test_graph_never_calls_the_llm_when_the_simulation_fails(laps):
    class _Exploding(_Engineer):
        async def generate_text(self, *a, **k):
            raise AssertionError("LLM must not be called for an invalid hypothetical")

    with patch.object(whatif_graph, "ai_engineer", _Exploding()):
        with pytest.raises(WhatIfError):
            await whatif_graph.run_whatif(laps, "ZZZ", [{"type": "shift_stop", "stop": 1, "laps": 1}])
