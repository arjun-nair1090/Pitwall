import json
import asyncio
from types import SimpleNamespace

import pytest

from app.services import f1_data_service as m

SINGAPORE_RACE = {
    "session_key": 11388, "meeting_key": 1296, "session_name": "Race", "year": 2026,
    "date_start": "2026-10-11T12:00:00+00:00", "date_end": "2026-10-11T14:00:00+00:00",
    "location": "Marina Bay", "country_name": "Singapore", "circuit_short_name": "Singapore", "is_cancelled": False,
}
US_RACE = dict(SINGAPORE_RACE, session_key=11396, meeting_key=1297, date_start="2099-10-25T20:00:00+00:00",
               date_end="2099-10-25T22:00:00+00:00", country_name="United States")


class FakeResponse:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


class NoFeed:
    """F1's live timing feed with no live session."""

    def active_session(self):
        return None

    def serves(self, session_key):
        return False


@pytest.fixture
def svc(monkeypatch):
    """A fresh service whose OpenF1 requests are answered from `routes` and recorded in `calls`."""
    service = m.F1DataService()
    service.routes, service.calls = {}, []

    def fake_get(url, headers=None, timeout=None):
        service.calls.append(url)
        for prefix, reply in service.routes.items():
            if url.startswith(f"{service.openf1_base_url}/{prefix}"):
                return reply if isinstance(reply, FakeResponse) else FakeResponse(200, reply)
        return FakeResponse(404, {"detail": "No results found."})

    monkeypatch.setattr(m.requests, "get", fake_get)
    monkeypatch.setattr(service, "_fastf1_fallback", lambda: None)
    monkeypatch.setattr(m, "live_timing_feed", NoFeed())
    return service


def run(coro):
    return asyncio.run(coro)


def test_openf1_requests_never_send_a_limit(svc):
    svc.routes = {"laps": [], "stints": [], "intervals": [], "position": [], "drivers": []}
    run(svc.get_live_timing(11388))
    run(svc.get_drivers(11388))
    assert svc.calls and not any("limit" in url for url in svc.calls)


def test_openf1_responses_are_cached(svc):
    svc.routes = {"drivers": [{"driver_number": 1, "name_acronym": "NOR", "team_colour": "F47600"}]}
    first = run(svc.get_drivers(11388))
    second = run(svc.get_drivers(11388))
    assert first == second and first[0]["code"] == "NOR" and first[0]["team_color"] == "#F47600"
    assert len(svc.calls) == 1


def test_a_rate_limit_serves_the_last_good_response(svc, monkeypatch):
    svc.routes = {"drivers": [{"driver_number": 1, "name_acronym": "NOR"}]}
    run(svc.get_drivers(11388))
    svc._cache = {url: (0, data) for url, (_, data) in svc._cache.items()}  # expire everything
    svc.routes = {"drivers": FakeResponse(429, {"detail": "Rate limit exceeded"})}
    assert run(svc.get_drivers(11388))[0]["code"] == "NOR"


def test_a_failed_request_with_nothing_cached_returns_nothing(svc):
    svc.routes = {"drivers": FakeResponse(429, {"detail": "Rate limit exceeded"})}
    assert run(svc.get_drivers(11388)) == []


def test_current_session_is_the_latest_started_session_with_its_meeting_name(svc):
    svc.routes = {"sessions": [US_RACE, SINGAPORE_RACE], "meetings": [{"meeting_name": "Singapore Grand Prix"}]}
    meta = run(svc.current_session())
    assert meta["session_key"] == 11388
    assert meta["meeting_name"] == "Singapore Grand Prix"
    assert meta["live"] is False and meta["source"] == "openf1"
    assert any("sessions?year=" in url for url in svc.calls)


def test_current_session_falls_back_to_fastf1_when_openf1_is_unavailable(svc, monkeypatch):
    svc.routes = {"sessions": FakeResponse(429, {"detail": "Rate limit exceeded"})}
    fallback_meta = {"session_key": m.FASTF1_SESSION_KEY, "meeting_name": "Bahrain Grand Prix", "live": False, "source": "fastf1"}
    monkeypatch.setattr(svc, "_fastf1_fallback", lambda: {"meta": fallback_meta, "session": None})
    assert run(svc.current_session()) == fallback_meta


def test_current_session_is_none_when_nothing_can_be_found(svc):
    svc.routes = {"sessions": FakeResponse(429, {})}
    assert run(svc.current_session()) is None


def test_the_fastf1_session_key_reads_from_the_fallback_race(svc, monkeypatch):
    import pandas as pd
    results = pd.DataFrame([{"DriverNumber": "63", "Abbreviation": "RUS", "Position": 1.0, "Time": pd.Timedelta(seconds=5400),
                             "Status": "Finished", "TeamColor": "27F4D2", "TeamName": "Mercedes"}])
    laps = pd.DataFrame([{"DriverNumber": "63", "LapNumber": 57.0, "LapTime": pd.Timedelta(seconds=95),
                          "Sector1Time": pd.NaT, "Sector2Time": pd.NaT, "Sector3Time": pd.NaT, "Compound": "HARD", "TyreLife": 20.0}])
    session = SimpleNamespace(results=results, laps=laps, race_control_messages=None, weather_data=None)
    monkeypatch.setattr(svc, "_fastf1_fallback", lambda: {"meta": {}, "session": session})
    assert run(svc.get_drivers(m.FASTF1_SESSION_KEY))[0]["code"] == "RUS"
    assert run(svc.get_live_timing(m.FASTF1_SESSION_KEY))["63"]["position"] == 1
    assert run(svc.get_live_race_control(m.FASTF1_SESSION_KEY)) == []
    assert run(svc.get_live_radios(m.FASTF1_SESSION_KEY)) == []
    assert run(svc.get_live_weather(m.FASTF1_SESSION_KEY))["live_signal"] is False
    assert svc.calls == []


def test_live_telemetry_asks_only_for_the_last_few_seconds(svc):
    svc.routes = {"car_data": [], "location": []}
    run(svc.stream_live_telemetry(11396))
    car_url = next(url for url in svc.calls if "/car_data" in url)
    assert "date>" in car_url and "%3E" not in car_url


def test_telemetry_tick_idles_without_polling_car_data_when_nothing_is_live(svc, monkeypatch):
    published = []
    monkeypatch.setattr(m.redis_service, "publish", lambda channel, msg: _record(published, msg))
    svc.routes = {"sessions": [SINGAPORE_RACE], "meetings": []}
    wait = run(svc.telemetry_tick())
    assert wait == m.IDLE_POLL_SECONDS
    assert not any("/car_data" in url or "/location" in url for url in svc.calls)
    assert published == [published[0]] and published[0]["live_signal"] is False


def test_telemetry_tick_streams_a_live_session(svc, monkeypatch):
    monkeypatch.setattr(m.redis_service, "publish", lambda channel, msg: _record([], msg))
    live = dict(SINGAPORE_RACE, date_start="2000-01-01T00:00:00+00:00", date_end="2999-01-01T00:00:00+00:00")
    svc.routes = {"sessions": [live], "meetings": [], "car_data": [], "location": []}
    assert run(svc.telemetry_tick()) == m.LIVE_POLL_SECONDS
    assert any("/car_data" in url for url in svc.calls)


async def _record(sink, msg):
    sink.append(msg)


LAPS = [{"driver_number": 18, "lap_number": 37, "lap_duration": None},
        {"driver_number": 3, "lap_number": 62, "lap_duration": 97.8}]
RESULTS = [{"driver_number": 3, "position": 1, "gap_to_leader": 0},
           {"driver_number": 18, "position": None, "dnf": True}]


def test_a_finished_sessions_board_uses_the_official_result(svc):
    svc.routes = {"laps": LAPS, "stints": [], "intervals": [], "position": [], "session_result": RESULTS}
    board = run(svc.get_live_timing(11388))
    assert board["18"]["gap_to_leader"] == "DNF"


def test_a_live_sessions_board_does_not_ask_for_a_result(svc):
    svc._live_keys.add(11396)
    svc.routes = {"laps": LAPS, "stints": [], "intervals": [], "position": [], "session_result": RESULTS}
    run(svc.get_live_timing(11396))
    assert not any("session_result" in url for url in svc.calls)


class FakeFeed:
    """F1's live timing feed covering one live session."""

    def __init__(self, session_key=11396):
        self.session = {"session_key": session_key, "meeting_name": "United States Grand Prix", "live": True,
                        "source": "f1-live"}

    def active_session(self):
        return self.session

    def serves(self, session_key):
        return session_key == self.session["session_key"]

    def drivers(self):
        return [{"driver_number": 1, "code": "NOR"}]

    def timing(self):
        return {"1": {"position": 1}}

    def weather(self):
        return {"air_temperature": 25.0, "live_signal": True}

    def race_control(self):
        return [{"message": "GREEN LIGHT - PIT EXIT OPEN"}]

    def radios(self):
        return [{"driver_number": 1}]

    def session_status(self):
        return {"stopped": True, "red_flag": True, "announcement": None, "resumes_at": None}

    def car_frames(self):
        return [{"driver_number": 1, "x": 1.0, "live_signal": True}]


def test_a_session_on_f1s_live_feed_is_the_current_session(svc, monkeypatch):
    monkeypatch.setattr(m, "live_timing_feed", FakeFeed())
    assert run(svc.current_session())["meeting_name"] == "United States Grand Prix"
    assert svc.calls == []  # OpenF1 is closed during a live session, so it isn't asked


def test_the_live_feed_answers_for_its_own_session(svc, monkeypatch):
    monkeypatch.setattr(m, "live_timing_feed", FakeFeed())
    assert run(svc.get_drivers(11396))[0]["code"] == "NOR"
    assert run(svc.get_live_timing(11396)) == {"1": {"position": 1}}
    assert run(svc.get_live_weather(11396))["air_temperature"] == 25.0
    assert run(svc.get_live_race_control(11396))[0]["message"] == "GREEN LIGHT - PIT EXIT OPEN"
    assert run(svc.get_live_radios(11396)) == [{"driver_number": 1}]
    assert run(svc.get_session_status(11396))["red_flag"] is True
    assert svc.calls == []


def test_other_sessions_still_come_from_openf1(svc, monkeypatch):
    monkeypatch.setattr(m, "live_timing_feed", FakeFeed())
    svc.routes = {"drivers": [{"driver_number": 16, "name_acronym": "LEC"}]}
    assert run(svc.get_drivers(11388))[0]["code"] == "LEC"
    assert run(svc.get_session_status(11388)) == {"stopped": False, "red_flag": False, "announcement": None, "resumes_at": None}


def test_telemetry_tick_sends_the_live_feeds_car_frames_to_the_browsers(svc, monkeypatch):
    sent = []

    async def broadcast(message):
        sent.append(message)

    monkeypatch.setattr(m, "live_timing_feed", FakeFeed())
    monkeypatch.setattr(m.manager, "broadcast", broadcast)
    assert run(svc.telemetry_tick()) == m.FEED_POLL_SECONDS
    assert [json.loads(s)["driver_number"] for s in sent] == [1]
    assert not any("/car_data" in url for url in svc.calls)


def test_race_strategy_comes_from_the_live_feeds_snapshot(svc, monkeypatch):
    from app.services import live_strategy

    feed = FakeFeed()
    feed.race_snapshot = lambda: {"session": {"session_type": "Race", "session_name": "Race", "year": 2026,
                                              "location": "Austin"},
                                  "timing": {}, "drivers": [], "history": {}, "lap_count": {"current": 5, "total": 56},
                                  "track_status": "1", "used": {}}
    asked = []
    monkeypatch.setattr(m, "live_timing_feed", feed)
    monkeypatch.setattr(live_strategy, "prior_pit_loss", lambda year, location: asked.append((year, location)) or 26.0)
    out = run(svc.get_race_strategy(11396))
    assert out["live"] is True and out["applicable"] is True and out["lap"] == 5
    assert (out["pit_loss"], out["pit_loss_source"]) == (26.0, "last_year")
    assert asked == [(2026, "Austin")]


def test_race_strategy_is_only_live(svc, monkeypatch):
    monkeypatch.setattr(m, "live_timing_feed", FakeFeed())
    assert run(svc.get_race_strategy(11388)) == {"live": False}
