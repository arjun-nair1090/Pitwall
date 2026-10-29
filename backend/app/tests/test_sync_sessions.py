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
