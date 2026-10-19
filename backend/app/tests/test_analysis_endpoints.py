import pandas as pd
import fastf1
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import corner_analysis, duel_telemetry, race_battles, race_pace
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

def test_missing_driver_is_a_404_with_a_plain_message(monkeypatch):
    monkeypatch.setattr(duel_telemetry, "head_to_head_payload", _raise("PIA has no laps in this session. Drivers with laps: NOR, VER."))
    response = client.post("/api/v1/telemetry/compare", json=COMPARE)
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


def test_replay_returns_the_lap_payload_and_passes_the_round_and_lap(monkeypatch):
    from app.services import race_replay

    seen = {}

    def fake(year, gp, session, lap, round_number):
        seen.update(year=year, gp=gp, session=session, lap=lap, round_number=round_number)
        return {"lap": lap, "drivers": []}

    monkeypatch.setattr(race_replay, "replay_payload", fake)
    response = client.get("/api/v1/telemetry/replay", params={"year": 2024, "round": 14, "lap_number": 12})
    assert response.status_code == 200 and response.json()["lap"] == 12
    assert seen == {"year": 2024, "gp": "", "session": "R", "lap": 12, "round_number": 14}


def test_replay_defaults_to_the_first_lap(monkeypatch):
    from app.services import race_replay

    monkeypatch.setattr(race_replay, "replay_payload", lambda y, g, s, lap, r: {"lap": lap})
    assert client.get("/api/v1/telemetry/replay", params={"year": 2024, "round": 14}).json()["lap"] == 1


def test_replay_needs_a_race():
    assert client.get("/api/v1/telemetry/replay", params={"year": 2024}).status_code == 422


def test_replay_reports_a_lap_the_race_never_had_as_404(monkeypatch):
    from app.services import race_replay

    monkeypatch.setattr(race_replay, "replay_payload", _raise("That race had only 44 laps."))
    response = client.get("/api/v1/telemetry/replay", params={"year": 2024, "round": 14, "lap_number": 99})
    assert response.status_code == 404
    assert response.json()["detail"] == "That race had only 44 laps."


def test_replay_failures_do_not_leak_internals(monkeypatch):
    from app.services import race_replay

    def boom(*args):
        raise RuntimeError("KeyError: 'internal'")

    monkeypatch.setattr(race_replay, "replay_payload", boom)
    response = client.get("/api/v1/telemetry/replay", params={"year": 2024, "round": 14})
    assert response.status_code == 502 and "internal" not in response.json()["detail"]



# ---- corner consistency ----

CONSISTENCY = {"year": 2024, "gp": "Belgium", "session": "R", "driver": "ver"}


def test_corner_consistency_reports_missing_data_as_404(monkeypatch):
    monkeypatch.setattr(corner_analysis, "corner_consistency_payload", _raise("VER has only 2 clean laps in this session; at least 3 are needed to judge consistency."))
    response = client.post("/api/v1/telemetry/corner-consistency", json=CONSISTENCY)
    assert response.status_code == 404
    assert "at least 3" in response.json()["detail"]


def test_corner_consistency_upper_cases_the_driver(monkeypatch):
    seen = {}

    def fake(year, gp, session, driver, round_number=None):
        seen.update(driver=driver, session=session, round=round_number)
        return {"driver": {"code": driver}}

    monkeypatch.setattr(corner_analysis, "corner_consistency_payload", fake)
    response = client.post("/api/v1/telemetry/corner-consistency", json={**CONSISTENCY, "round": 14})
    assert response.status_code == 200
    assert seen == {"driver": "VER", "session": "R", "round": 14}


def test_corner_consistency_needs_a_race():
    response = client.post("/api/v1/telemetry/corner-consistency", json={"year": 2024, "driver": "VER"})
    assert response.status_code == 422


# ---- race pace ----

PACE = {"year": 2024, "gp": "Belgium", "session": "R"}


def test_race_pace_passes_the_round_and_session_through(monkeypatch):
    seen = {}

    def fake(year, gp, session, round_number=None):
        seen["args"] = (year, gp, session, round_number)
        return {"drivers": []}

    monkeypatch.setattr(race_pace, "race_pace_payload", fake)
    response = client.post("/api/v1/telemetry/race-pace", json={"year": 2024, "round": 14, "session": "s"})
    assert response.status_code == 200
    assert seen["args"] == (2024, "", "S", 14)
    assert response.json() == {"drivers": []}


def test_race_pace_rejects_qualifying():
    response = client.post("/api/v1/telemetry/race-pace", json={**PACE, "session": "Q"})
    assert response.status_code == 422
    assert "Race pace needs a race or a sprint." in response.text


def test_race_pace_needs_a_race_or_a_round():
    response = client.post("/api/v1/telemetry/race-pace", json={"year": 2024, "session": "R"})
    assert response.status_code == 422


def test_race_pace_reports_missing_data_as_404(monkeypatch):
    monkeypatch.setattr(race_pace, "race_pace_payload", _raise("nope"))
    response = client.post("/api/v1/telemetry/race-pace", json=PACE)
    assert response.status_code == 404
    assert response.json()["detail"] == "nope"


# ---- overtakes and battles ----

BATTLES = {"year": 2024, "gp": "Belgium", "session": "R"}


def test_race_battles_passes_the_round_and_session_through(monkeypatch):
    seen = {}

    def fake(year, gp, session, round_number=None):
        seen["args"] = (year, gp, session, round_number)
        return {"total_laps": 0, "drivers": [], "overtakes": [], "battles": []}

    monkeypatch.setattr(race_battles, "race_battles_payload", fake)
    response = client.post("/api/v1/telemetry/race-battles", json={"year": 2024, "round": 14, "session": "s"})
    assert response.status_code == 200
    assert seen["args"] == (2024, "", "S", 14)
    assert response.json() == {"total_laps": 0, "drivers": [], "overtakes": [], "battles": []}


def test_race_battles_defaults_to_the_race(monkeypatch):
    seen = {}

    def fake(year, gp, session, round_number=None):
        seen["session"] = session
        return {"total_laps": 0, "drivers": [], "overtakes": [], "battles": []}

    monkeypatch.setattr(race_battles, "race_battles_payload", fake)
    response = client.post("/api/v1/telemetry/race-battles", json={"year": 2024, "gp": "Belgium"})
    assert response.status_code == 200
    assert seen["session"] == "R"


def test_race_battles_rejects_qualifying():
    response = client.post("/api/v1/telemetry/race-battles", json={**BATTLES, "session": "Q"})
    assert response.status_code == 422
    assert "Overtakes need a race or a sprint." in response.text


def test_race_battles_needs_a_race_or_a_round():
    response = client.post("/api/v1/telemetry/race-battles", json={"year": 2024, "session": "R"})
    assert response.status_code == 422


def test_race_battles_reports_missing_data_as_404(monkeypatch):
    monkeypatch.setattr(race_battles, "race_battles_payload", _raise("nope"))
    response = client.post("/api/v1/telemetry/race-battles", json=BATTLES)
    assert response.status_code == 404
    assert response.json()["detail"] == "nope"


def test_race_battles_failures_do_not_leak_internals(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("KeyError: 'internal'")

    monkeypatch.setattr(race_battles, "race_battles_payload", boom)
    response = client.post("/api/v1/telemetry/race-battles", json=BATTLES)
    assert response.status_code == 502 and "internal" not in response.json()["detail"]


# ---- championship odds ----

from app.services import championship_data, championship_sim  # noqa: E402


def test_championship_odds_returns_the_bare_payload(monkeypatch):
    seen = {}

    def fake(year, after_round):
        seen["args"] = (year, after_round)
        return {"year": year, "drivers": []}

    monkeypatch.setattr(championship_data, "championship_odds", fake)
    response = client.post("/api/v1/championship/odds", json={"year": 2024, "after_round": 19})
    assert response.status_code == 200
    assert response.json() == {"year": 2024, "drivers": []}
    assert seen["args"] == (2024, 19)


def test_championship_odds_after_round_is_optional(monkeypatch):
    monkeypatch.setattr(championship_data, "championship_odds", lambda y, r: {"after_round": r})
    response = client.post("/api/v1/championship/odds", json={"year": 2024})
    assert response.status_code == 200
    assert response.json() == {"after_round": None}


def test_championship_error_keeps_its_status_and_message(monkeypatch):
    def boom(year, after_round):
        raise championship_sim.ChampionshipError("No races have been run in 2026 yet.", 404)

    monkeypatch.setattr(championship_data, "championship_odds", boom)
    response = client.post("/api/v1/championship/odds", json={"year": 2026})
    assert response.status_code == 404
    assert response.json()["detail"] == "No races have been run in 2026 yet."


def test_championship_other_errors_are_a_502(monkeypatch):
    def boom(year, after_round):
        raise RuntimeError("mirror down")

    monkeypatch.setattr(championship_data, "championship_odds", boom)
    response = client.post("/api/v1/championship/odds", json={"year": 2024})
    assert response.status_code == 502
    assert "the championship odds" in response.json()["detail"]
    assert "mirror down" not in response.text


def test_championship_year_out_of_range_is_a_422(monkeypatch):
    monkeypatch.setattr(championship_data, "championship_odds", lambda y, r: {})
    response = client.post("/api/v1/championship/odds", json={"year": 2017})
    assert response.status_code == 422
    assert f"Championship odds cover 2018 to {championship_sim._current_year()}." in response.text


def test_championship_odds_memoises_the_season_and_the_result(monkeypatch):
    championship_data.clear_cache()
    calls = {"load": 0}

    def fake_load(year, ergast=None):
        calls["load"] += 1
        races = pd.DataFrame({"round": [1, 2]})
        return races, pd.DataFrame(), pd.DataFrame()

    seen = []
    monkeypatch.setattr(championship_data, "load_season", fake_load)
    monkeypatch.setattr(championship_data.championship_sim, "championship_payload",
                        lambda y, r, s, sc, cut: seen.append(cut) or {"after_round": cut})
    assert championship_data.championship_odds(2024, None) == {"after_round": 2}
    assert championship_data.championship_odds(2024, 2) == {"after_round": 2}
    assert championship_data.championship_odds(2024, 1) == {"after_round": 1}
    assert calls["load"] == 1
    assert seen == [2, 1]
    championship_data.clear_cache()


# ---- POST /ask ----

def _ask_client(monkeypatch, *scripted):
    from app.services import data_assistant
    from app.tests.test_data_assistant import FakeClient
    fake = FakeClient(*scripted)
    monkeypatch.setattr(data_assistant, "make_client", lambda: fake)
    return fake


def _says(value):
    from app.tests.test_data_assistant import reply, text
    return reply(text(value))


def test_ask_without_a_key_is_a_503(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    response = client.post("/api/v1/ask", json={"question": "Who won?"})
    assert response.status_code == 503
    assert response.json()["detail"] == "The assistant isn't set up on this server (no Anthropic API key)."


def test_ask_treats_the_placeholder_key_as_unset(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "your_anthropic_api_key_here")
    assert client.post("/api/v1/ask", json={"question": "Who won?"}).status_code == 503


@pytest.mark.parametrize("body", [
    {"question": ""}, {"question": "   "}, {"question": "x" * 501}, {},
    {"question": "ok", "history": [{"role": "user", "text": "a"}] * 7},
    {"question": "ok", "history": [{"role": "system", "text": "a"}]},
    {"question": "ok", "history": [{"role": "user", "text": ""}]},
])
def test_ask_rejects_bad_requests_with_a_422(monkeypatch, body):
    fake = _ask_client(monkeypatch, _says("never reached"))
    assert client.post("/api/v1/ask", json=body).status_code == 422
    assert fake.calls == []


def test_ask_answers_with_sources(monkeypatch):
    from app.services import data_assistant
    from app.tests.test_data_assistant import reply, text, tool_use
    monkeypatch.setitem(data_assistant._IMPLEMENTATIONS, "race_pace", lambda **k: {"drivers": []})
    fake = _ask_client(
        monkeypatch,
        reply(tool_use("t1", "race_pace", {"year": 2024, "round": 14}), stop="tool_use"),
        reply(text("Norris.")),
    )
    response = client.post("/api/v1/ask", json={
        "question": "  Who had the best pace?  ",
        "history": [{"role": "user", "text": "Hi"}, {"role": "assistant", "text": "Hello."}],
    })
    assert response.status_code == 200
    assert response.json() == {
        "answer": "Norris.",
        "sources": [{"tool": "race_pace", "input": {"year": 2024, "round": 14, "session": "R"}, "ok": True}],
    }
    assert fake.calls[0]["messages"][-1] == {"role": "user", "content": "Who had the best pace?"}


def test_ask_trims_a_long_history_turn_instead_of_refusing(monkeypatch):
    fake = _ask_client(monkeypatch, _says("ok"))
    response = client.post("/api/v1/ask", json={
        "question": "And then?",
        "history": [{"role": "user", "text": "Tell me all"}, {"role": "assistant", "text": "x" * 2500}],
    })
    assert response.status_code == 200
    assert fake.calls[0]["messages"][1] == {"role": "assistant", "content": "x" * 2000}


def test_ask_strips_the_question_before_measuring_it(monkeypatch):
    fake = _ask_client(monkeypatch, _says("ok"))
    response = client.post("/api/v1/ask", json={"question": "   " + "q" * 500 + "   "})
    assert response.status_code == 200
    assert fake.calls[0]["messages"][-1]["content"] == "q" * 500


def test_ask_closes_the_client_after_answering(monkeypatch):
    fake = _ask_client(monkeypatch, _says("ok"))
    assert client.post("/api/v1/ask", json={"question": "Who won?"}).status_code == 200
    assert fake.closed is True


def test_ask_closes_the_client_after_a_failure(monkeypatch):
    boom = _raising(monkeypatch, RuntimeError("down"))
    assert client.post("/api/v1/ask", json={"question": "Who won?"}).status_code == 502
    assert boom.closed is True


def _status_error(cls, status):
    import httpx
    request = httpx.Request("POST", "https://api.example.invalid/v1/messages")
    return cls("secret upstream detail: key sk-123", response=httpx.Response(status, request=request), body=None)


def _raising(monkeypatch, error):
    from app.services import data_assistant

    class Boom:
        messages = None
        closed = False

        async def create(self, **kwargs):
            raise error

        async def close(self):
            self.closed = True

    boom = Boom()
    boom.messages = boom
    monkeypatch.setattr(data_assistant, "make_client", lambda: boom)
    return boom


def test_ask_maps_a_rate_limit_to_429(monkeypatch):
    import anthropic
    _raising(monkeypatch, _status_error(anthropic.RateLimitError, 429))
    response = client.post("/api/v1/ask", json={"question": "Who won?"})
    assert response.status_code == 429
    assert response.json()["detail"] == "The assistant is busy. Try again in a minute."
    assert "secret" not in response.text and "sk-123" not in response.text


def test_ask_maps_an_api_error_to_502(monkeypatch):
    import anthropic
    import httpx
    _raising(monkeypatch, anthropic.APIError(
        "secret upstream detail: key sk-123", httpx.Request("POST", "https://api.example.invalid"), body=None))
    response = client.post("/api/v1/ask", json={"question": "Who won?"})
    assert response.status_code == 502
    assert response.json()["detail"] == "The assistant couldn't be reached. Try again shortly."
    assert "secret" not in response.text


def test_ask_maps_a_server_error_to_502(monkeypatch):
    import anthropic
    _raising(monkeypatch, _status_error(anthropic.InternalServerError, 500))
    assert client.post("/api/v1/ask", json={"question": "Who won?"}).status_code == 502


def test_ask_does_not_leak_an_unexpected_failure(monkeypatch):
    _raising(monkeypatch, RuntimeError("secret traceback /srv/app"))
    response = client.post("/api/v1/ask", json={"question": "Who won?"})
    assert response.status_code == 502
    assert "secret" not in response.text
