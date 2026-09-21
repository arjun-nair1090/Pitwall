import json
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.services import race_debrief

TOTAL_LAPS = 10


def _td(seconds):
    return pd.Timedelta(seconds=seconds)


def _make_results():
    rows = [
        # code, team, full name, grid, position, status, laps, time(s), points
        ("VER", "Red Bull Racing", "Max Verstappen", 6.0, 1.0, "Finished", 10.0, 5400.0, 25.0),
        ("PER", "Red Bull Racing", "Sergio Perez", 2.0, 2.0, "Finished", 10.0, 22.3, 18.0),
        ("LEC", "Ferrari", "Charles Leclerc", 1.0, 3.0, "Finished", 10.0, 32.3, 15.0),
        ("HAM", "Mercedes", "Lewis Hamilton", 3.0, 4.0, "Finished", 10.0, 49.7, 12.0),
        ("ALO", "Aston Martin", "Fernando Alonso", 9.0, 5.0, "Finished", 10.0, 56.2, 10.0),
        ("NOR", "McLaren", "Lando Norris", 7.0, 6.0, "Retired", 6.0, None, 0.0),
    ]
    return pd.DataFrame(
        [
            {
                "Abbreviation": c, "TeamName": t, "FullName": n, "GridPosition": g, "Position": p,
                "Status": s, "Laps": l, "Time": _td(tm) if tm is not None else pd.NaT, "Points": pts,
            }
            for c, t, n, g, p, s, l, tm, pts in rows
        ]
    )


def _make_laps():
    plans = {
        "VER": [("MEDIUM", 5), ("HARD", 5)],
        "PER": [("SOFT", 4), ("HARD", 6)],
        "LEC": [("MEDIUM", 10)],
        "HAM": [("MEDIUM", 5), ("HARD", 5)],
        "ALO": [("SOFT", 3), ("MEDIUM", 4), ("HARD", 3)],
        "NOR": [("MEDIUM", 6)],
    }
    rows = []
    for driver, stints in plans.items():
        lap = 0
        for stint_number, (compound, count) in enumerate(stints, start=1):
            for _ in range(count):
                lap += 1
                rows.append({
                    "Driver": driver, "Team": "T", "Stint": float(stint_number), "Compound": compound,
                    "LapNumber": float(lap), "LapTime": _td(101.0 + lap * 0.1), "Deleted": False,
                })
    laps = pd.DataFrame(rows)
    # PER's lap 8 is the genuinely fastest lap (HARD).
    laps.loc[(laps["Driver"] == "PER") & (laps["LapNumber"] == 8.0), "LapTime"] = _td(100.0)
    # An even faster lap that was deleted (track limits) must NOT count.
    laps.loc[(laps["Driver"] == "ALO") & (laps["LapNumber"] == 9.0), "LapTime"] = _td(95.0)
    laps.loc[(laps["Driver"] == "ALO") & (laps["LapNumber"] == 9.0), "Deleted"] = True
    return laps


def _make_race_control():
    return pd.DataFrame([
        {"Category": "SafetyCar", "Flag": None, "Message": "SAFETY CAR DEPLOYED", "Lap": 3},
        {"Category": "SafetyCar", "Flag": None, "Message": "SAFETY CAR IN THIS LAP", "Lap": 4},
        {"Category": "SafetyCar", "Flag": None, "Message": "VIRTUAL SAFETY CAR DEPLOYED", "Lap": 7},
        {"Category": "SafetyCar", "Flag": None, "Message": "VIRTUAL SAFETY CAR ENDING", "Lap": 7},
        {"Category": "Flag", "Flag": "RED", "Message": "RED FLAG", "Lap": 8},
        {"Category": "Flag", "Flag": "YELLOW", "Message": "YELLOW IN TRACK SECTOR 4", "Lap": 2},
        {"Category": "Flag", "Flag": "CHEQUERED", "Message": "CHEQUERED FLAG", "Lap": 10},
    ])


@pytest.fixture
def facts():
    return race_debrief.build_race_facts(
        _make_results(), _make_laps(), _make_race_control(), event_name="Belgian Grand Prix", year=2023, session_name="Race"
    )


# --- build_race_facts ---------------------------------------------------------

def test_facts_identify_the_event_and_race_distance(facts):
    assert facts["event"] == "Belgian Grand Prix"
    assert facts["year"] == 2023
    assert facts["session"] == "Race"
    assert facts["total_laps"] == TOTAL_LAPS


def test_facts_winner(facts):
    winner = facts["winner"]
    assert (winner["code"], winner["name"], winner["team"]) == ("VER", "Max Verstappen", "Red Bull Racing")
    assert winner["grid"] == 6
    assert winner["positions_gained"] == 5
    assert winner["race_time"] == "1:30:00.000"


def test_facts_podium_order_gaps_and_positions_gained(facts):
    podium = facts["podium"]
    assert [p["code"] for p in podium] == ["VER", "PER", "LEC"]
    assert [p["positions_gained"] for p in podium] == [5, 0, -2]
    assert podium[0]["gap"] is None                    # the winner has no gap
    assert podium[1]["gap"] == "+22.300s"
    assert podium[2]["points"] == 15


def test_facts_fastest_lap_ignores_deleted_laps(facts):
    fastest = facts["fastest_lap"]
    assert fastest["code"] == "PER"
    assert fastest["lap"] == 8
    assert fastest["compound"] == "HARD"
    assert fastest["time"] == "1:40.000"


def test_facts_strategies_list_stints_and_stop_counts(facts):
    by_code = {s["code"]: s for s in facts["strategies"]}
    assert by_code["VER"]["stops"] == 1
    assert by_code["VER"]["stints"] == [{"compound": "MEDIUM", "laps": 5}, {"compound": "HARD", "laps": 5}]
    assert by_code["LEC"]["stops"] == 0
    assert by_code["ALO"]["stops"] == 2
    assert [s["code"] for s in facts["strategies"]][:3] == ["VER", "PER", "LEC"]  # finishing order


def test_facts_biggest_gainers_are_finishers_who_moved_up_the_most(facts):
    gainers = facts["biggest_gainers"]
    assert [(g["code"], g["positions_gained"]) for g in gainers] == [("VER", 5), ("ALO", 4)]


def test_facts_retirements_report_how_many_laps_were_completed(facts):
    assert facts["retirements"] == [
        {"code": "NOR", "name": "Lando Norris", "team": "McLaren", "status": "Retired", "laps_completed": 6}
    ]


def test_facts_count_neutralisations_from_race_control(facts):
    # "IN THIS LAP" / "ENDING" messages are the same period ending -- not new ones.
    assert facts["neutralisations"] == {"safety_cars": 1, "virtual_safety_cars": 1, "red_flags": 1}


def test_facts_without_race_control_report_no_neutralisations():
    f = race_debrief.build_race_facts(_make_results(), _make_laps(), None, event_name="X", year=2023, session_name="Race")
    assert f["neutralisations"] == {"safety_cars": 0, "virtual_safety_cars": 0, "red_flags": 0}


def test_facts_treat_a_pit_lane_start_as_last_on_the_grid():
    results = _make_results()
    results.loc[results["Abbreviation"] == "VER", "GridPosition"] = 0.0   # FastF1 reports pit-lane starts as 0
    f = race_debrief.build_race_facts(results, _make_laps(), None, event_name="X", year=2023, session_name="Race")
    assert f["winner"]["grid"] == 6                    # field size (6 cars): last
    assert f["winner"]["positions_gained"] == 5


def test_facts_are_plain_json_serialisable_python(facts):
    # numpy scalars / NaN would make FastAPI's JSON encoder raise.
    encoded = json.dumps(facts)
    assert "NaN" not in encoded
    assert not any(isinstance(v, (np.integer, np.floating)) for v in facts["winner"].values())


def test_facts_raise_a_clear_error_when_there_is_no_classification():
    with pytest.raises(race_debrief.NoResultsError):
        race_debrief.build_race_facts(_make_results().iloc[0:0], _make_laps(), None, event_name="X", year=2023, session_name="Race")


def test_facts_tolerate_missing_lap_data():
    f = race_debrief.build_race_facts(_make_results(), _make_laps().iloc[0:0], None, event_name="X", year=2023, session_name="Race")
    assert f["fastest_lap"] is None
    assert f["strategies"] == []
    assert f["winner"]["code"] == "VER"


# --- template + prompt --------------------------------------------------------

def test_template_debrief_covers_the_key_facts(facts):
    text = race_debrief.render_template_debrief(facts)
    assert "Max Verstappen" in text and "Red Bull Racing" in text
    assert "P6" in text or "sixth" in text.lower()          # started sixth
    assert "Sergio Perez" in text and "Charles Leclerc" in text
    assert "fastest lap" in text.lower() and "Perez" in text
    assert "Norris" in text and "after 6 laps" in text
    assert "safety car" in text.lower() and "red flag" in text.lower()


def test_template_debrief_is_deterministic(facts):
    assert race_debrief.render_template_debrief(facts) == race_debrief.render_template_debrief(facts)


def test_template_debrief_omits_neutralisations_when_there_were_none(facts):
    facts = {**facts, "neutralisations": {"safety_cars": 0, "virtual_safety_cars": 0, "red_flags": 0}}
    assert "safety car" not in race_debrief.render_template_debrief(facts).lower()


def test_prompt_contains_the_facts_and_forbids_invention(facts):
    system, user = race_debrief.build_debrief_prompt(facts)
    assert "only" in system.lower() and "invent" in system.lower()
    assert "Max Verstappen" in user and "22.300" in user and "Belgian Grand Prix" in user


@pytest.mark.parametrize("text, expected", [
    ("Verstappen dominated at Spa.", True),
    ("VER took a comfortable win.", True),
    ("Leclerc won the race.", False),                 # wrong winner: not grounded
    ("", False),
    ("   ", False),
    ("Verstappen won. " * 400, False),                # runaway output
])
def test_grounding_check_rejects_ungrounded_or_runaway_text(facts, text, expected):
    assert race_debrief.is_grounded(text, facts) is expected


# --- generate_debrief ---------------------------------------------------------

class _Engineer:
    def __init__(self, text=None, error=None):
        self._text, self._error, self.calls = text, error, []

    async def generate_text(self, system_prompt, user_prompt, **kwargs):
        self.calls.append((system_prompt, user_prompt, kwargs))
        if self._error:
            raise self._error
        return self._text


@pytest.mark.asyncio
async def test_generate_debrief_uses_the_ai_text_when_it_is_grounded(facts):
    result = await race_debrief.generate_debrief(facts, _Engineer("Verstappen won from sixth on the grid."))
    assert result == {"summary": "Verstappen won from sixth on the grid.", "source": "ai"}


@pytest.mark.asyncio
async def test_generate_debrief_falls_back_to_the_template_when_ai_is_unavailable(facts):
    result = await race_debrief.generate_debrief(facts, _Engineer(None))
    assert result["source"] == "template"
    assert "Max Verstappen" in result["summary"]


@pytest.mark.asyncio
async def test_generate_debrief_falls_back_when_the_ai_text_is_ungrounded(facts):
    result = await race_debrief.generate_debrief(facts, _Engineer("Leclerc won the race."))
    assert result["source"] == "template"


@pytest.mark.asyncio
async def test_generate_debrief_never_raises_if_the_engineer_does(facts):
    result = await race_debrief.generate_debrief(facts, _Engineer(error=RuntimeError("boom")))
    assert result["source"] == "template"


def test_template_says_a_driver_who_never_completed_a_lap_went_out_on_the_opening_lap(facts):
    facts = {**facts, "retirements": [{"code": "PIA", "name": "Oscar Piastri", "team": "McLaren", "status": "Retired", "laps_completed": 0}]}
    text = race_debrief.render_template_debrief(facts)
    assert "Oscar Piastri (McLaren) retired on the opening lap" in text


def test_template_omits_the_lap_when_it_is_unknown(facts):
    facts = {**facts, "retirements": [{"code": "PIA", "name": "Oscar Piastri", "team": "McLaren", "status": "Retired", "laps_completed": None}]}
    assert "Oscar Piastri (McLaren) retired." in race_debrief.render_template_debrief(facts)
