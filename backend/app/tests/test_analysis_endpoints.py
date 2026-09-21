import fastf1
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import duel_telemetry
from app.services import session_info as si
from app.tests.test_session_info import FakeSession

client = TestClient(app)

COMPARE = {"year": 2024, "gp": "Belgium", "session": "R", "driver1": "VER", "driver2": "NOR"}


@pytest.fixture(autouse=True)
def _clear_memo():
    si.clear_cache()


def _raise(message):
    def boom(*args, **kwargs):
        raise si.SessionDataError(message)
    return boom


# ---- errors are reported honestly ----

@pytest.mark.parametrize("path", ["/api/v1/telemetry/compare", "/api/v1/telemetry/dominance"])
def test_missing_driver_is_a_404_with_a_plain_message(monkeypatch, path):
    monkeypatch.setattr(duel_telemetry, "head_to_head_payload", _raise("PIA has no laps in this session. Drivers with laps: NOR, VER."))
    monkeypatch.setattr(duel_telemetry, "dominance_payload", _raise("PIA has no laps in this session. Drivers with laps: NOR, VER."))
    response = client.post(path, json=COMPARE)
    assert response.status_code == 404
    assert response.json()["detail"] == "PIA has no laps in this session. Drivers with laps: NOR, VER."  # no "400: " prefix


def test_pedal_behaviour_reports_missing_data_as_404(monkeypatch):
    monkeypatch.setattr(duel_telemetry, "pedal_behavior_payload", _raise("There's no data for Abu Dhabi 2026 yet."))
    response = client.post("/api/v1/telemetry/pedal-behavior", json={"year": 2026, "gp": "Abu Dhabi", "session": "R"})
    assert response.status_code == 404
    assert "no data" in response.json()["detail"]


def test_unexpected_failures_do_not_leak_internals(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("KeyError: 'secret internal column'")
    monkeypatch.setattr(duel_telemetry, "head_to_head_payload", boom)
    response = client.post("/api/v1/telemetry/compare", json=COMPARE)
    assert response.status_code == 502
    assert "secret" not in response.json()["detail"]
    assert "try again" in response.json()["detail"].lower()


def test_comparing_a_driver_with_themselves_on_the_same_lap_is_rejected():
    response = client.post("/api/v1/telemetry/compare", json={**COMPARE, "driver2": "VER"})
    assert response.status_code == 422


def test_comparing_a_driver_with_themselves_on_different_laps_is_allowed(monkeypatch):
    monkeypatch.setattr(duel_telemetry, "head_to_head_payload", lambda *a, **k: {"driver1": {}, "driver2": {}})
    response = client.post("/api/v1/telemetry/compare", json={**COMPARE, "driver2": "ver", "driver1_lap": 3, "driver2_lap": 9})
    assert response.status_code == 200


def test_driver_codes_are_normalised_and_the_round_and_laps_are_passed_through(monkeypatch):
    seen = {}

    def fake(year, gp, session, d1, d2, l1, l2, round_number):
        seen.update(locals())
        return {"driver1": {}, "driver2": {}}

    monkeypatch.setattr(duel_telemetry, "head_to_head_payload", fake)
    client.post("/api/v1/telemetry/compare", json={**COMPARE, "driver1": " ver ", "round": 14, "driver1_lap": 5})
    assert (seen["d1"], seen["d2"], seen["round_number"], seen["l1"], seen["l2"]) == ("VER", "NOR", 14, 5, None)


def test_dominance_uses_the_same_laps_as_the_comparison(monkeypatch):
    seen = {}

    def fake(year, gp, session, d1, d2, l1, l2, round_number):
        seen.update(l1=l1, l2=l2)
        return {"driver1": {}, "driver2": {}, "dominance": []}

    monkeypatch.setattr(duel_telemetry, "dominance_payload", fake)
    client.post("/api/v1/telemetry/dominance", json={**COMPARE, "driver1_lap": 5, "driver2_lap": 7})
    assert (seen["l1"], seen["l2"]) == (5, 7)


# ---- session info ----

def test_session_info_endpoint_lists_the_real_drivers_and_race_distance(monkeypatch):
    monkeypatch.setattr(fastf1, "get_session", lambda *a: FakeSession())
    response = client.get("/api/v1/races/session-info", params={"year": 2024, "gp": "Belgium", "session": "R"})
    assert response.status_code == 200
    body = response.json()
    assert body["total_laps"] == 5
    assert [d["code"] for d in body["drivers"]] == ["VER", "NOR"]


def test_session_info_endpoint_prefers_the_round(monkeypatch):
    seen = []
    monkeypatch.setattr(fastf1, "get_session", lambda year, event, name: seen.append(event) or FakeSession())
    client.get("/api/v1/races/session-info", params={"year": 2024, "round": 14, "session": "R"})
    assert seen == [14]


def test_session_info_endpoint_needs_a_race_or_a_round():
    response = client.get("/api/v1/races/session-info", params={"year": 2024})
    assert response.status_code == 422


def test_session_info_endpoint_reports_missing_data_as_404(monkeypatch):
    monkeypatch.setattr(fastf1, "get_session", lambda *a: FakeSession(loaded=False))
    response = client.get("/api/v1/races/session-info", params={"year": 2026, "gp": "Abu Dhabi", "session": "R"})
    assert response.status_code == 404


# ---- calendar ----

def test_calendar_reports_round_numbers(monkeypatch):
    from app.tests.test_endpoints import _fake_calendar

    df = _fake_calendar()
    df["RoundNumber"] = [0, 1, 2]
    monkeypatch.setattr(fastf1, "get_event_schedule", lambda year: df)
    races = client.get("/api/v1/races/historical", params={"year": 2026}).json()
    assert [r["round"] for r in races] == [1, 2]


def test_calendar_lists_the_sessions_each_weekend_actually_has(monkeypatch):
    from app.tests.test_endpoints import _fake_calendar

    df = _fake_calendar()
    df["RoundNumber"] = [0, 1, 2]
    names = ["Practice 1", "Practice 2", "Practice 3", "Qualifying", "Race"]
    sprint = ["Practice 1", "Sprint Qualifying", "Sprint", "Qualifying", "Race"]
    for i in range(5):
        df[f"Session{i + 1}"] = [None, names[i], sprint[i]]
    monkeypatch.setattr(fastf1, "get_event_schedule", lambda year: df)
    races = client.get("/api/v1/races/historical", params={"year": 2026}).json()
    assert races[0]["sessions"] == ["FP1", "FP2", "FP3", "Q", "R"]
    assert races[1]["sessions"] == ["FP1", "SQ", "S", "Q", "R"]


def test_calendar_skips_session_names_it_does_not_know(monkeypatch):
    from app.tests.test_endpoints import _fake_calendar

    df = _fake_calendar()
    df["RoundNumber"] = [0, 1, 2]
    df["Session1"] = [None, "Mystery Session", "Practice 1"]
    monkeypatch.setattr(fastf1, "get_event_schedule", lambda year: df)
    races = client.get("/api/v1/races/historical", params={"year": 2026}).json()
    assert "Mystery Session" not in str(races[0]["sessions"])
    assert races[0]["sessions"] == ["R"]  # only the fake calendar's Race slot is recognised


# ---- our own 4xx answers are not turned into 500s ----

def _async_returning(value):
    async def fn(*args, **kwargs):
        return value
    return fn


def test_no_live_session_is_a_404_not_a_500(monkeypatch):
    from app.services.f1_data_service import f1_service

    monkeypatch.setattr(f1_service, "get_latest_session_key", _async_returning(9999))
    monkeypatch.setattr(f1_service, "sync_session_metadata", _async_returning(None))
    response = client.get("/api/v1/sessions/active")
    assert response.status_code == 404
    assert response.json()["detail"] == "Active session not found"


def test_missing_weather_is_a_404_not_a_500(monkeypatch):
    from app.services.f1_data_service import f1_service

    monkeypatch.setattr(f1_service, "get_live_weather", _async_returning(None))
    response = client.get("/api/v1/sessions/9999/weather")
    assert response.status_code == 404
    assert response.json()["detail"] == "Weather data not available"


def test_standings_for_a_season_without_data_is_a_400_with_a_plain_message(monkeypatch):
    from app.services.f1_data_service import f1_service

    monkeypatch.setattr(f1_service, "get_season_standings", _async_returning({"error": "No standings data available for this year."}))
    response = client.get("/api/v1/stats/standings", params={"year": 2999})
    assert response.status_code == 400
    assert response.json()["detail"] == "No standings data available for this year."


def test_circuit_layout_error_is_a_400_with_a_plain_message(monkeypatch):
    from app.services.f1_data_service import f1_service

    monkeypatch.setattr(f1_service, "get_circuit_layout", lambda *a: {"error": "No layout for that race."})
    response = client.get("/api/v1/circuits/0/layout", params={"year": 2999, "gp": "Nowhere"})
    assert response.status_code == 400
    assert response.json()["detail"] == "No layout for that race."


def test_replay_error_is_a_400_with_a_plain_message(monkeypatch):
    from app.services.f1_data_service import f1_service

    monkeypatch.setattr(f1_service, "get_historical_replay", _async_returning({"error": "No replay for that race."}))
    response = client.get("/api/v1/telemetry/replay", params={"year": 2999, "gp": "Nowhere"})
    assert response.status_code == 400
    assert response.json()["detail"] == "No replay for that race."
