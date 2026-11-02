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
