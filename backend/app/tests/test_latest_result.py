from datetime import datetime, timedelta
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import latest_result
from app.services.race_debrief import NoResultsError

client = TestClient(app)
NOW = datetime(2026, 9, 21, 12, 0, 0)  # naive UTC, like predictions_service


def _results(rows=None) -> pd.DataFrame:
    rows = rows or [
        ("VER", "Max Verstappen", "Red Bull Racing", 1, 6, "Finished", 5400.0),
        ("NOR", "Lando Norris", "McLaren", 2, 1, "Finished", 3.5),
        ("LEC", "Charles Leclerc", "Ferrari", 3, 0, "Finished", 9.25),  # pit-lane start
        ("HAM", "Lewis Hamilton", "Ferrari", 4, 3, "Lapped", None),
        ("ALO", "Fernando Alonso", "Aston Martin", 5, 4, "Engine", None),
    ]
    return pd.DataFrame(
        [
            {
                "Abbreviation": c, "FullName": n, "TeamName": t, "Position": p, "GridPosition": g,
                "Status": s, "Time": None if tm is None else pd.Timedelta(seconds=tm),
            }
            for c, n, t, p, g, s, tm in rows
        ]
    )


# --- build_classification ---------------------------------------------------------

def test_classification_is_sorted_and_shaped():
    rows = latest_result.build_classification(_results())
    assert [r["code"] for r in rows] == ["VER", "NOR", "LEC", "HAM", "ALO"]
    winner = rows[0]
    assert winner["position"] == 1 and winner["race_time_seconds"] == 5400.0 and winner["gap_seconds"] is None
    assert rows[1]["gap_seconds"] == 3.5 and rows[1]["race_time_seconds"] is None
    assert rows[0]["team"] == "Red Bull Racing" and rows[0]["name"] == "Max Verstappen"


def test_pit_lane_start_is_last_on_the_grid_not_first():
    lec = next(r for r in latest_result.build_classification(_results()) if r["code"] == "LEC")
    assert lec["grid"] == 5  # field size, FastF1 reports pit-lane starts as 0


def test_retirements_are_flagged_and_lapped_cars_are_not():
    rows = {r["code"]: r for r in latest_result.build_classification(_results())}
    assert rows["ALO"]["finished"] is False and rows["ALO"]["status"] == "Engine"
    assert rows["HAM"]["finished"] is True and rows["HAM"]["gap_seconds"] is None
    assert rows["VER"]["finished"] is True


def test_a_lapped_car_has_no_gap_even_when_fastf1_reports_a_time():
    # FastF1's Time for a lapped car is not a gap to the winner (a car one lap down can
    # carry +10s while cars on the lead lap are a minute behind), so it must not be shown.
    frame = _results([
        ("VER", "Max Verstappen", "Red Bull Racing", 1, 1, "Finished", 5400.0),
        ("NOR", "Lando Norris", "McLaren", 2, 2, "Finished", 86.7),
        ("LIN", "Arvid Lindblad", "Racing Bulls", 3, 3, "Lapped", 10.4),
        ("ALO", "Fernando Alonso", "Aston Martin", 4, 4, "+1 Lap", 33.8),
    ])
    rows = {r["code"]: r for r in latest_result.build_classification(frame)}
    assert rows["NOR"]["gap_seconds"] == 86.7
    assert rows["LIN"]["gap_seconds"] is None and rows["LIN"]["finished"] is True
    assert rows["ALO"]["gap_seconds"] is None and rows["ALO"]["finished"] is True


def test_missing_results_raise():
    for bad in (None, pd.DataFrame(), pd.DataFrame({"Abbreviation": ["VER"]})):
        with pytest.raises(NoResultsError):
            latest_result.build_classification(bad)


def test_results_without_a_winner_raise():
    frame = _results([("NOR", "Lando Norris", "McLaren", 2, 1, "Finished", 3.5)])
    with pytest.raises(NoResultsError):
        latest_result.build_classification(frame)


def test_unranked_rows_are_dropped():
    frame = _results()
    frame.loc[4, "Position"] = float("nan")
    assert [r["code"] for r in latest_result.build_classification(frame)] == ["VER", "NOR", "LEC", "HAM"]


# --- finished_races ---------------------------------------------------------------

def _schedule(events):
    rows = []
    for name, country, race_start, fmt in events:
        row = {f"Session{i}": None for i in range(1, 6)}
        row.update({f"Session{i}Date": pd.NaT for i in range(1, 6)})
        row.update({f"Session{i}DateUtc": pd.NaT for i in range(1, 6)})
        row.update({"EventName": name, "Country": country, "EventFormat": fmt})
        if race_start is not None:
            row.update({"Session5": "Race", "Session5DateUtc": pd.Timestamp(race_start)})
        rows.append(row)
    return pd.DataFrame(rows)


def test_finished_races_are_newest_first_and_skip_future_testing_and_unscheduled():
    schedule = _schedule([
        ("Pre-Season Testing", "Bahrain", None, "testing"),
        ("Italian Grand Prix", "Italy", NOW - timedelta(days=15), "conventional"),
        ("Dutch Grand Prix", "Netherlands", NOW - timedelta(days=22), "conventional"),
        ("Singapore Grand Prix", "Singapore", NOW + timedelta(days=13), "conventional"),
        ("TBC Grand Prix", "X", None, "conventional"),
    ])
    races = latest_result.finished_races(2026, NOW, get_schedule=lambda year: schedule)
    assert [r["event_name"] for r in races] == ["Italian Grand Prix", "Dutch Grand Prix"]
    assert races[0]["country"] == "Italy" and races[0]["year"] == 2026


def test_a_race_that_started_an_hour_ago_is_not_finished_yet():
    schedule = _schedule([("Live Grand Prix", "X", NOW - timedelta(hours=1), "conventional")])
    assert latest_result.finished_races(2026, NOW, get_schedule=lambda year: schedule) == []


# --- latest_classification --------------------------------------------------------

@pytest.fixture(autouse=True)
def fresh_caches():
    latest_result.reset_caches()


def _races(*names, year=2026):
    return [{"year": year, "event_name": n, "country": "X"} for n in names]


def test_uses_the_most_recent_race_with_results():
    calls = []

    def load(year, name):
        calls.append(name)
        return _results()

    out = latest_result.latest_classification(
        NOW, list_races=lambda y, n: _races("Italian Grand Prix", "Dutch Grand Prix") if y == 2026 else [], load_results=load
    )
    assert out["event"] == "Italian Grand Prix" and out["year"] == 2026
    assert out["classification"][0]["code"] == "VER"
    assert calls == ["Italian Grand Prix"]


def test_walks_back_when_the_newest_results_are_not_published_yet():
    def load(year, name):
        if name == "Italian Grand Prix":
            return pd.DataFrame()
        return _results()

    out = latest_result.latest_classification(
        NOW, list_races=lambda y, n: _races("Italian Grand Prix", "Dutch Grand Prix") if y == 2026 else [], load_results=load
    )
    assert out["event"] == "Dutch Grand Prix"


def test_falls_back_to_last_season_early_in_the_year():
    out = latest_result.latest_classification(
        NOW,
        list_races=lambda y, n: _races("Abu Dhabi Grand Prix", year=2025) if y == 2025 else [],
        load_results=lambda y, n: _results(),
    )
    assert out["year"] == 2025 and out["event"] == "Abu Dhabi Grand Prix"


def test_no_results_anywhere_raises_no_results():
    with pytest.raises(NoResultsError):
        latest_result.latest_classification(NOW, list_races=lambda y, n: _races("A", "B"), load_results=lambda y, n: pd.DataFrame())


def test_an_outage_is_not_reported_as_no_results():
    def boom(year, name):
        raise ConnectionError("f1 timing down")

    with pytest.raises(ConnectionError):
        latest_result.latest_classification(NOW, list_races=lambda y, n: _races("A", "B"), load_results=boom)


def test_results_are_cached_and_the_answer_is_memoised():
    loads = []

    def load(year, name):
        loads.append(name)
        return _results()

    kwargs = dict(list_races=lambda y, n: _races("Italian Grand Prix"), load_results=load)
    first = latest_result.latest_classification(NOW, **kwargs)
    second = latest_result.latest_classification(NOW, **kwargs)
    assert first == second and loads == ["Italian Grand Prix"]


def test_memo_expires_after_its_ttl():
    # Clock reads: 1) memo write after the first call, 2) memo check on the second call
    # (expired), 3) memo write after the recompute.
    ticks = iter([0.0, latest_result.LATEST_TTL_SECONDS + 1, latest_result.LATEST_TTL_SECONDS + 1])
    listings = []

    def list_races(y, n):
        listings.append(y)
        return _races("Italian Grand Prix")

    kwargs = dict(list_races=list_races, load_results=lambda y, n: _results(), clock=lambda: next(ticks))
    latest_result.latest_classification(NOW, **kwargs)
    assert listings == [2026, 2025]  # one candidate < MAX_CANDIDATES, so last season is listed too
    latest_result.latest_classification(NOW, **kwargs)
    assert listings == [2026, 2025, 2026, 2025]  # the expired memo forced a fresh listing


# --- endpoint ---------------------------------------------------------------------

def test_endpoint_returns_the_classification():
    payload = {"event": "Italian Grand Prix", "year": 2026, "country": "Italy", "classification": []}
    with patch("app.api.v1.endpoints.latest_result.latest_classification", return_value=payload):
        res = client.get("/api/v1/races/latest-result")
    assert res.status_code == 200 and res.json() == payload


def test_endpoint_404_when_there_are_no_results():
    with patch("app.api.v1.endpoints.latest_result.latest_classification", side_effect=NoResultsError("No completed race results are available yet.")):
        res = client.get("/api/v1/races/latest-result")
    assert res.status_code == 404 and "No completed race results" in res.json()["detail"]


def test_endpoint_502_with_a_generic_message_on_failure():
    with patch("app.api.v1.endpoints.latest_result.latest_classification", side_effect=ConnectionError("secret internal detail")):
        res = client.get("/api/v1/races/latest-result")
    assert res.status_code == 502
    assert "secret internal detail" not in res.json()["detail"]
    assert "Try again" in res.json()["detail"]


@pytest.fixture(autouse=True)
def _fresh_result_caches():
    latest_result.reset_caches()
    yield
    latest_result.reset_caches()


# --- any race's results (archive) ---------------------------------------------------

def _archive_results() -> pd.DataFrame:
    frame = _results()
    frame["Points"] = [25.0, 18.0, 15.0, 12.0, 0.0]
    frame["TeamColor"] = ["3671C6", "FF8000", "E8002D", "E8002D", None]
    return frame


def test_race_results_adds_points_and_team_colours_to_the_classification():
    result = latest_result.race_results(2024, 14, load_results=lambda year, event: _archive_results())
    assert result["year"] == 2024 and result["round"] == 14
    first, _, _, _, last = result["classification"]
    assert (first["code"], first["points"], first["color"]) == ("VER", 25.0, "#3671C6")
    assert (last["code"], last["points"], last["color"]) == ("ALO", 0.0, "#9AA3B2")  # no colour recorded


def test_race_results_handles_a_missing_points_column():
    result = latest_result.race_results(2024, 14, load_results=lambda year, event: _results())
    assert all(row["points"] is None for row in result["classification"])


def test_race_results_asks_for_the_round_and_is_cached():
    calls = []

    def load(year, event):
        calls.append((year, event))
        return _archive_results()

    latest_result.race_results(2023, 5, load_results=load)
    latest_result.race_results(2023, 5, load_results=load)
    assert calls == [(2023, 5)]


def test_race_results_raises_when_unpublished():
    with pytest.raises(NoResultsError):
        latest_result.race_results(2026, 24, load_results=lambda year, event: pd.DataFrame())


def test_results_endpoint_returns_the_classification():
    payload = {"year": 2024, "round": 14, "classification": []}
    with patch("app.api.v1.endpoints.latest_result.race_results", return_value=payload):
        res = client.get("/api/v1/races/results", params={"year": 2024, "round": 14})
    assert res.status_code == 200 and res.json() == payload


def test_results_endpoint_404_when_unpublished():
    with patch("app.api.v1.endpoints.latest_result.race_results", side_effect=NoResultsError("This race has no final classification yet.")):
        res = client.get("/api/v1/races/results", params={"year": 2026, "round": 24})
    assert res.status_code == 404 and "no final classification" in res.json()["detail"]


def test_results_endpoint_502_hides_internals():
    with patch("app.api.v1.endpoints.latest_result.race_results", side_effect=ConnectionError("secret")):
        res = client.get("/api/v1/races/results", params={"year": 2024, "round": 14})
    assert res.status_code == 502 and "secret" not in res.json()["detail"]


def test_results_endpoint_needs_year_and_round():
    assert client.get("/api/v1/races/results", params={"year": 2024}).status_code == 422


def test_race_results_reports_an_unknown_round_as_missing_not_as_an_outage():
    def load(year, event):
        raise ValueError("Invalid round: 24")

    with pytest.raises(NoResultsError, match="round 24"):
        latest_result.race_results(2026, 24, load_results=load)


def test_race_results_lets_real_failures_through():
    def load(year, event):
        raise ConnectionError("network down")

    with pytest.raises(ConnectionError):
        latest_result.race_results(2026, 3, load_results=load)
