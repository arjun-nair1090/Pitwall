import pandas as pd

from app.scripts.sync_sessions import due_sessions


def _schedule():
    sprint_weekend = {"RoundNumber": 19, "EventName": "United States Grand Prix"}
    names = ["Practice 1", "Sprint Qualifying", "Sprint", "Qualifying", "Race"]
    starts = pd.to_datetime(["2026-10-23 17:30", "2026-10-23 21:30", "2026-10-24 17:00",
                             "2026-10-24 21:00", "2026-10-25 19:00"])
    for i, (name, start) in enumerate(zip(names, starts), 1):
        sprint_weekend[f"Session{i}"] = name
        sprint_weekend[f"Session{i}DateUtc"] = start
    return pd.DataFrame([sprint_weekend])


def test_due_sessions_skips_practice_synced_and_just_finished_sessions():
    now = pd.Timestamp("2026-10-25 21:00")  # two hours after the race started: too soon to be published
    done = {"2026 19 United States Grand Prix | Sprint"}

    due = [key for _, _, key in due_sessions(2026, _schedule(), now, done)]

    assert due == ["2026 19 United States Grand Prix | Sprint Qualifying",
                   "2026 19 United States Grand Prix | Qualifying"]


def test_due_sessions_picks_up_the_race_once_it_has_settled():
    due = list(due_sessions(2026, _schedule(), pd.Timestamp("2026-10-26 01:00"), set()))

    assert (19, "Race", "2026 19 United States Grand Prix | Race") in due


# ---- an expired F1 TV sign-in opens the sign-in page, and the sync carries on once it's done ----

import time

import pytest
from fastf1.internals.f1account import browser
from fastf1.internals.f1account.tokens import SubscriptionToken, TokenManager

from app.scripts import sync_sessions


@pytest.fixture
def opened(monkeypatch, tmp_path):
    """A throwaway token store, and the pages the sync opens; FastF1's sign-in is faked."""
    pages = []
    monkeypatch.setattr(sync_sessions, "token_manager", TokenManager(auth_func=None, path=tmp_path / "token.json"))
    monkeypatch.setattr(sync_sessions.webbrowser, "open", pages.append)
    return pages


def _signs_in(monkeypatch):
    def login_browser():
        browser.print("Please open the following URL in your browser:\nhttps://f1login.fastf1.dev?port=5123\n")
        return SubscriptionToken(value="fresh", expires_at=time.time() + 86400)
    monkeypatch.setattr(browser, "login_browser", login_browser)


def test_an_expired_sign_in_opens_the_sign_in_page_and_stores_the_new_token(monkeypatch, tmp_path, opened):
    _signs_in(monkeypatch)
    assert sync_sessions.sign_in_in_browser(tmp_path, waiting=2) is True
    assert opened == ["https://f1login.fastf1.dev?port=5123"]
    assert sync_sessions.token_manager.get_stored().value == "fresh"


def test_the_sign_in_page_opens_at_most_every_few_hours(monkeypatch, tmp_path, opened):
    _signs_in(monkeypatch)
    sync_sessions.sign_in_in_browser(tmp_path, waiting=2)
    sync_sessions.token_manager.clear()
    assert sync_sessions.sign_in_in_browser(tmp_path, waiting=2) is False
    assert len(opened) == 1


def test_nobody_signing_in_gives_up_after_the_wait(monkeypatch, tmp_path, opened):
    import threading
    never = threading.Event()
    monkeypatch.setattr(browser, "login_browser", lambda: never.wait())
    monkeypatch.setattr(sync_sessions, "SIGN_IN_WAIT_S", 0.1)
    assert sync_sessions.sign_in_in_browser(tmp_path, waiting=2) is False


def test_telemetry_analyses_share_one_load_and_are_saved_for_every_driver(monkeypatch, tmp_path):
    from app.services import corner_analysis, duel_telemetry, saved_analyses, session_info
    from app.services.session_info import SessionDataError

    monkeypatch.setattr(saved_analyses.settings, "SAVED_ANALYSES_DIR", str(tmp_path))
    loads = []
    monkeypatch.setattr(session_info, "load_session", lambda *a, **k: loads.append(a) or object())
    monkeypatch.setattr(session_info, "session_info", lambda *a: {"drivers": [{"code": "VER"}, {"code": "NOR"}]})

    @saved_analyses.saved_analysis
    def pedal_behavior_payload(year, gp, session, rnd):
        duel_telemetry.load_session(year, gp, session, rnd, telemetry=True)
        return {"data": []}

    @saved_analyses.saved_analysis
    def corner_consistency_payload(year, gp, session, driver, rnd):
        corner_analysis.load_session(year, gp, session, rnd, telemetry=True)
        if driver == "NOR":
            raise SessionDataError("NOR has only 2 clean laps")
        return {"driver": driver}

    monkeypatch.setattr(duel_telemetry, "pedal_behavior_payload", pedal_behavior_payload)
    monkeypatch.setattr(corner_analysis, "corner_consistency_payload", corner_consistency_payload)
    from app.services.f1_data_service import f1_service
    outlines = []
    monkeypatch.setattr(f1_service, "get_circuit_layout", lambda *a: outlines.append(a))
    sync_sessions.save_telemetry_analyses(2026, 20, "Race")
    assert outlines == [(2026, 20, "Race")]  # a race also refreshes its circuit's outline
    assert len(loads) == 1  # one telemetry load for pedals and every driver
    names = sorted(p.name.split("-")[0] for p in tmp_path.rglob("*.pkl"))
    assert names == ["corner_consistency_payload", "pedal_behavior_payload"]  # NOR's failure isn't saved
    # saved under exactly what the page asks for: session code "R" and the round
    assert saved_analyses.peek("pedal_behavior_payload", 2026, (("R", 20), [])) == {"data": []}


def test_only_telemetry_analyses_for_the_servers_code_are_uploaded(tmp_path):
    for rel in ["v1/2026/pedal_behavior_payload-a.pkl", "v1/2026/corner_consistency_payload-b.pkl",
                "v1/2025/circuit_layout-e.pkl", "v1/2026/session-c.pkl", "v0/2026/pedal_behavior_payload-d.pkl"]:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(b"x")
    picked = sync_sessions.staged_for_upload(tmp_path, "v1")
    assert sorted(p.name for p in picked) == [
        "circuit_layout-e.pkl", "corner_consistency_payload-b.pkl", "pedal_behavior_payload-a.pkl"]
    assert sync_sessions.staged_for_upload(tmp_path, None) == []  # server's version unknown: send nothing


def test_a_synced_key_reads_back_as_year_round_and_session():
    assert sync_sessions.parse_key("2026 20 São Paulo Grand Prix | Race") == (2026, 20, "Race")
    assert sync_sessions.parse_key("2023 04 Azerbaijan Grand Prix | Sprint Shootout") == (2023, 4, "Sprint Shootout")


def test_refreshing_a_season_keeps_its_circuit_outlines():
    # Outlines are worked out once per circuit; clearing a season after each race mustn't lose them.
    command = sync_sessions.server_refresh_command([2026])
    assert "2026" in command and "! -name 'circuit_layout*'" in command
    assert "warm_saved 2026" in command


def test_uploading_outlines_alone_clears_and_warms_nothing():
    command = sync_sessions.server_refresh_command([])
    assert "rm " not in command and "-delete" not in command and "warm_saved" not in command
    assert "tar -xf -" in command


def test_outlines_are_asked_for_the_way_the_live_map_asks(monkeypatch):
    schedule = pd.DataFrame({"Location": ["Melbourne", "Las Vegas"], "EventFormat": ["conventional", "conventional"]})
    monkeypatch.setattr(sync_sessions.fastf1, "get_event_schedule", lambda year, include_testing=False: schedule)
    asked = []
    from app.services.f1_data_service import f1_service
    monkeypatch.setattr(f1_service, "get_circuit_layout", lambda *a: asked.append(a) or {"x": [1]})
    sync_sessions.save_outlines(2026)
    assert asked == [(2026, "Melbourne", "Race"), (2026, "Las Vegas", "Race")]
