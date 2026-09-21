from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app

ALLOWED_ORIGIN = {"Origin": "http://localhost:3000"}

client = TestClient(app, headers=ALLOWED_ORIGIN)

EVENT = "Belgian Grand Prix"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _authed_client(email):
    c = TestClient(app, headers=ALLOWED_ORIGIN)
    c.post("/api/v1/auth/signup", json={"email": email, "password": "some-password-1", "display_name": email.split("@")[0]})
    return c


def _prediction(year, p1="VER", p2="NOR", p3="LEC", event=EVENT):
    return {"year": year, "event_name": event, "predicted_p1": p1, "predicted_p2": p2, "predicted_p3": p3}


def _submit(c, body):
    return c.post("/api/v1/predictions", json=body, headers={"X-CSRF-Token": c.cookies.get("csrf_token")})


@pytest.fixture
def schedule(monkeypatch):
    """Replace FastF1's event schedule with a fake one. Call ``schedule.race_at(ts)``
    to place the fake event's race start (naive UTC); the schedule also contains a
    testing-style event with no Race session."""
    import fastf1

    state = {"race_start": _now_utc() + timedelta(days=30), "fail": False}

    def fake_get_event_schedule(year):
        if state["fail"]:
            raise ConnectionError("schedule backend down")
        rows = []
        race = {f"Session{i}": None for i in range(1, 6)}
        race.update({f"Session{i}Date": pd.NaT for i in range(1, 6)})
        race.update({f"Session{i}DateUtc": pd.NaT for i in range(1, 6)})
        race.update({"EventName": EVENT, "Session5": "Race", "Session5DateUtc": pd.Timestamp(state["race_start"])})
        rows.append(race)
        testing = {f"Session{i}": None for i in range(1, 6)}
        testing.update({f"Session{i}Date": pd.NaT for i in range(1, 6)})
        testing.update({f"Session{i}DateUtc": pd.NaT for i in range(1, 6)})
        testing.update({"EventName": "Pre-Season Testing", "Session1": "Practice 1"})
        rows.append(testing)
        return pd.DataFrame(rows)

    monkeypatch.setattr(fastf1, "get_event_schedule", fake_get_event_schedule)

    class Control:
        def race_at(self, ts):
            state["race_start"] = ts

        def fail(self, value=True):
            state["fail"] = value

    return Control()


# --- submission: auth / csrf / validation ------------------------------------

def test_submit_prediction_requires_authentication(schedule):
    anon = TestClient(app, headers=ALLOWED_ORIGIN)
    assert anon.post("/api/v1/predictions", json=_prediction(1951)).status_code == 401


def test_submit_prediction_requires_csrf_header(schedule):
    c = _authed_client("predict-csrf@example.com")
    assert c.post("/api/v1/predictions", json=_prediction(1951)).status_code == 403


def test_submit_prediction_rejects_malformed_driver_code(schedule):
    c = _authed_client("predict-invalid@example.com")
    assert _submit(c, _prediction(1951, p3="Z1")).status_code == 400


def test_submit_prediction_rejects_duplicates_differing_only_by_case(schedule):
    c = _authed_client("predict-dupe-case@example.com")
    response = _submit(c, _prediction(1951, p1="VER", p2="ver"))
    assert response.status_code == 400
    assert "distinct" in response.json()["detail"].lower()


@pytest.mark.parametrize("year", [1900, 2200])
def test_submit_prediction_rejects_implausible_years(schedule, year):
    c = _authed_client(f"predict-year-{year}@example.com")
    assert _submit(c, _prediction(year)).status_code == 422


def test_submit_prediction_rejects_overlong_event_name(schedule):
    c = _authed_client("predict-longname@example.com")
    assert _submit(c, _prediction(1951, event="x" * 201)).status_code == 422


# --- submission: schedule integrity / race lock ------------------------------

def test_submit_prediction_succeeds_before_the_race_and_normalizes_codes(schedule):
    c = _authed_client("predict-ok@example.com")
    response = _submit(c, _prediction(1952, p1="ver", p2=" nor ", p3="Lec"))
    assert response.status_code == 200
    body = response.json()
    assert (body["predicted_p1"], body["predicted_p2"], body["predicted_p3"]) == ("VER", "NOR", "LEC")
    assert body["points_awarded"] is None


def test_submit_prediction_is_locked_once_the_race_has_started(schedule):
    schedule.race_at(_now_utc() - timedelta(minutes=1))
    c = _authed_client("predict-locked@example.com")
    response = _submit(c, _prediction(1953))
    assert response.status_code == 400
    assert "locked" in response.json()["detail"].lower()


def test_submit_prediction_lock_uses_utc_not_local_wall_clock(schedule):
    # Lights-out was 1 minute ago. Only the UTC column is populated (as FastF1
    # does), so this passes only if the lock compares real UTC instants.
    schedule.race_at(_now_utc() - timedelta(minutes=1))
    c = _authed_client("predict-utc@example.com")
    assert _submit(c, _prediction(1954)).status_code == 400


@pytest.mark.parametrize("event", ["Belgian Grand Prix ", "belgian grand prix", "Belgium", "Made Up Grand Prix"])
def test_submit_prediction_rejects_event_names_not_in_the_schedule(schedule, event):
    # A near-miss name must be rejected, not silently skip the race-start lock
    # (scoring fuzzy-matches names, so it would otherwise still get scored).
    schedule.race_at(_now_utc() - timedelta(days=1))  # race is over -- would be locked if it matched
    c = _authed_client(f"predict-unknown-{abs(hash(event))}@example.com")
    response = _submit(c, _prediction(1955, event=event))
    assert response.status_code == 400
    assert "unknown event" in response.json()["detail"].lower()


def test_submit_prediction_rejects_events_without_a_race(schedule):
    c = _authed_client("predict-testing@example.com")
    response = _submit(c, _prediction(1956, event="Pre-Season Testing"))
    assert response.status_code == 400
    assert "no scheduled race" in response.json()["detail"].lower()


def test_submit_prediction_fails_closed_when_the_schedule_is_unavailable(schedule):
    schedule.fail()
    c = _authed_client("predict-schedule-down@example.com")
    assert _submit(c, _prediction(1957)).status_code == 503


def test_resubmitting_before_the_race_replaces_the_previous_pick(schedule):
    c = _authed_client("predict-resubmit@example.com")
    assert _submit(c, _prediction(1958, p1="VER", p2="NOR", p3="LEC")).status_code == 200
    assert _submit(c, _prediction(1958, p1="HAM", p2="RUS", p3="ALO")).status_code == 200

    mine = c.get("/api/v1/predictions/me", params={"year": 1958}).json()
    assert len(mine) == 1
    assert (mine[0]["predicted_p1"], mine[0]["predicted_p2"], mine[0]["predicted_p3"]) == ("HAM", "RUS", "ALO")


def test_resubmitting_after_the_race_starts_is_rejected_and_keeps_the_original(schedule):
    c = _authed_client("predict-late-edit@example.com")
    assert _submit(c, _prediction(1959, p1="VER", p2="NOR", p3="LEC")).status_code == 200

    schedule.race_at(_now_utc() - timedelta(minutes=5))
    assert _submit(c, _prediction(1959, p1="HAM", p2="RUS", p3="ALO")).status_code == 400

    mine = c.get("/api/v1/predictions/me", params={"year": 1959}).json()
    assert (mine[0]["predicted_p1"], mine[0]["predicted_p2"], mine[0]["predicted_p3"]) == ("VER", "NOR", "LEC")


def test_my_predictions_only_returns_the_callers_own_picks(schedule):
    a = _authed_client("predict-mine-a@example.com")
    b = _authed_client("predict-mine-b@example.com")
    _submit(a, _prediction(1960, p1="VER"))
    _submit(b, _prediction(1960, p1="HAM", p2="RUS", p3="ALO"))

    mine = a.get("/api/v1/predictions/me", params={"year": 1960}).json()
    assert len(mine) == 1
    assert mine[0]["predicted_p1"] == "VER"


def test_my_predictions_requires_authentication(schedule):
    anon = TestClient(app, headers=ALLOWED_ORIGIN)
    assert anon.get("/api/v1/predictions/me", params={"year": 1960}).status_code == 401


# --- leaderboard --------------------------------------------------------------

def test_leaderboard_is_public_and_returns_empty_list_with_no_predictions():
    response = client.get("/api/v1/leaderboard", params={"year": 1950})
    assert response.status_code == 200
    assert response.json() == []


def test_leaderboard_rejects_implausible_years():
    assert client.get("/api/v1/leaderboard", params={"year": 99999}).status_code == 422


# --- scoring -------------------------------------------------------------------

def _score(year, event=EVENT):
    return client.post("/api/v1/predictions/score", json={"year": year, "event_name": event})


def test_score_rejects_a_race_that_has_not_started(schedule):
    with patch("app.services.predictions_service.fetch_actual_top3") as fetch:
        response = _score(1970)
    assert response.status_code == 400
    fetch.assert_not_called()


def test_score_rejects_unknown_events(schedule):
    schedule.race_at(_now_utc() - timedelta(days=1))
    assert _score(1970, event="Belgian Grand Prix ").status_code == 400


def test_score_fails_closed_when_the_schedule_is_unavailable(schedule):
    schedule.fail()
    assert _score(1970).status_code == 503


def test_score_rejects_when_no_final_result_exists_and_leaves_points_untouched(schedule):
    c = _authed_client("score-noresult@example.com")
    assert _submit(c, _prediction(1971)).status_code == 200
    schedule.race_at(_now_utc() - timedelta(hours=2))

    with patch("app.services.predictions_service.fetch_actual_top3", return_value=None):
        response = _score(1971)
    assert response.status_code == 400
    assert c.get("/api/v1/predictions/me", params={"year": 1971}).json()[0]["points_awarded"] is None


def test_score_reports_a_result_fetch_failure_as_unavailable(schedule):
    schedule.race_at(_now_utc() - timedelta(hours=2))
    with patch("app.services.predictions_service.fetch_actual_top3", side_effect=ConnectionError("down")):
        assert _score(1971).status_code == 503


def test_score_awards_points_builds_the_leaderboard_and_is_idempotent(schedule):
    year = 1972
    exact = _authed_client("score-exact@example.com")
    partial = _authed_client("score-partial@example.com")
    miss = _authed_client("score-miss@example.com")
    _submit(exact, _prediction(year, "VER", "PER", "LEC"))     # exact podium       -> 25
    _submit(partial, _prediction(year, "PER", "VER", "HAM"))   # 2 right drivers    -> 20
    _submit(miss, _prediction(year, "HAM", "RUS", "ALO"))      # none               -> 0

    schedule.race_at(_now_utc() - timedelta(hours=3))
    with patch("app.services.predictions_service.fetch_actual_top3", return_value=("VER", "PER", "LEC")):
        first = _score(year)
        second = _score(year)  # recompute, must not double count
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["scored_predictions"] == 3

    board = client.get("/api/v1/leaderboard", params={"year": year}).json()
    assert board == [
        {"display_name": "score-exact", "total_points": 25},
        {"display_name": "score-partial", "total_points": 20},
        {"display_name": "score-miss", "total_points": 0},
    ]


def test_score_only_touches_the_requested_year_and_event(schedule):
    c = _authed_client("score-isolation@example.com")
    _submit(c, _prediction(1973))
    _submit(c, _prediction(1974))

    schedule.race_at(_now_utc() - timedelta(hours=1))
    with patch("app.services.predictions_service.fetch_actual_top3", return_value=("VER", "NOR", "LEC")):
        _score(1973)

    assert c.get("/api/v1/predictions/me", params={"year": 1973}).json()[0]["points_awarded"] == 25
    assert c.get("/api/v1/predictions/me", params={"year": 1974}).json()[0]["points_awarded"] is None


def test_leaderboard_orders_ties_deterministically_by_name(schedule):
    year = 1975
    b = _authed_client("tie-bravo@example.com")
    a = _authed_client("tie-alpha@example.com")
    _submit(b, _prediction(year))
    _submit(a, _prediction(year))
    schedule.race_at(_now_utc() - timedelta(hours=1))
    with patch("app.services.predictions_service.fetch_actual_top3", return_value=("VER", "NOR", "LEC")):
        _score(year)
    names = [row["display_name"] for row in client.get("/api/v1/leaderboard", params={"year": year}).json()]
    assert names == ["tie-alpha", "tie-bravo"]


def test_score_uses_real_official_results_for_a_real_race(schedule):
    """Integration check against real FastF1 data (2023 Belgian GP: VER/PER/LEC).
    Uses the on-disk FastF1 cache; performs one network fetch on a cold cache."""
    c = _authed_client("score-real@example.com")
    schedule.race_at(_now_utc() + timedelta(days=1))
    assert _submit(c, _prediction(2023, "VER", "PER", "HAM")).status_code == 200

    schedule.race_at(_now_utc() - timedelta(days=1))
    response = _score(2023)
    if response.status_code == 503:
        pytest.skip("Official results unavailable (no network to FastF1/Ergast in this environment)")
    assert response.status_code == 200

    # VER and PER are on the real podium, HAM is not: 2 x 10 = 20.
    assert c.get("/api/v1/predictions/me", params={"year": 2023}).json()[0]["points_awarded"] == 20
