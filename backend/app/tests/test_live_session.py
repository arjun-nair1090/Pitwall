from datetime import datetime, timezone

import pandas as pd

from app.services import live_session as ls

NOW = datetime(2026, 10, 20, 3, 0, tzinfo=timezone.utc)


def session(key, start, end, name="Race", cancelled=False, meeting=1296):
    return {
        "session_key": key, "meeting_key": meeting, "session_name": name, "year": 2026,
        "date_start": start, "date_end": end, "location": "Marina Bay", "country_name": "Singapore",
        "circuit_short_name": "Singapore", "is_cancelled": cancelled,
    }


SINGAPORE_RACE = session(11388, "2026-10-11T12:00:00+00:00", "2026-10-11T14:00:00+00:00")
SINGAPORE_QUALI = session(11384, "2026-10-10T13:00:00+00:00", "2026-10-10T14:00:00+00:00", "Qualifying")
US_RACE = session(11396, "2026-10-25T20:00:00+00:00", "2026-10-25T22:00:00+00:00", meeting=1297)


def test_pick_session_ignores_sessions_that_have_not_started():
    picked, live = ls.pick_session([SINGAPORE_QUALI, US_RACE, SINGAPORE_RACE], NOW)
    assert picked["session_key"] == 11388
    assert live is False


def test_pick_session_marks_a_running_session_live():
    during = datetime(2026, 10, 25, 21, 0, tzinfo=timezone.utc)
    picked, live = ls.pick_session([SINGAPORE_RACE, US_RACE], during)
    assert picked["session_key"] == 11396
    assert live is True


def test_pick_session_stays_live_briefly_after_the_scheduled_end():
    overrun = datetime(2026, 10, 25, 22, 10, tzinfo=timezone.utc)
    assert ls.pick_session([US_RACE], overrun)[1] is True
    later = datetime(2026, 10, 25, 22, 30, tzinfo=timezone.utc)
    assert ls.pick_session([US_RACE], later)[1] is False


def test_pick_session_skips_cancelled_and_malformed_sessions():
    cancelled = session(11390, "2026-10-12T12:00:00+00:00", "2026-10-12T14:00:00+00:00", cancelled=True)
    broken = {"session_key": 1, "date_start": None}
    picked, _ = ls.pick_session([SINGAPORE_RACE, cancelled, broken], NOW)
    assert picked["session_key"] == 11388


def test_pick_session_returns_none_before_anything_has_run():
    assert ls.pick_session([US_RACE], NOW) is None
    assert ls.pick_session([], NOW) is None


def test_session_metadata_names_the_meeting_and_says_whether_it_is_live():
    meta = ls.session_metadata(SINGAPORE_RACE, {"meeting_name": "Singapore Grand Prix"}, live=False)
    assert meta == {
        "session_key": 11388, "year": 2026, "location": "Marina Bay", "country": "Singapore",
        "circuit_name": "Singapore", "circuit_short_name": "Singapore", "meeting_name": "Singapore Grand Prix",
        "session_name": "Race", "date_start": "2026-10-11T12:00:00+00:00", "date_end": "2026-10-11T14:00:00+00:00",
        "live": False, "source": "openf1",
    }


def test_session_metadata_without_a_meeting_falls_back_to_the_circuit():
    assert ls.session_metadata(SINGAPORE_RACE, None, live=True)["meeting_name"] == "Singapore"


def test_driver_entry_reads_openf1_field_names():
    entry = ls.driver_entry({
        "driver_number": 1, "name_acronym": "NOR", "first_name": "Lando", "last_name": "Norris",
        "full_name": "Lando NORRIS", "team_name": "McLaren", "team_colour": "F47600", "country_code": None,
    })
    assert entry == {
        "driver_number": 1, "code": "NOR", "first_name": "Lando", "last_name": "Norris", "full_name": "Lando NORRIS",
        "team_name": "McLaren", "team_color": "#F47600", "country_code": "",
    }


def test_driver_entry_without_a_colour_is_neutral():
    assert ls.driver_entry({"driver_number": 7, "name_acronym": "DOO", "team_colour": None})["team_color"] == "#7f7f7f"


def lap(num, n, duration, s=(30.0, 40.0, 30.0)):
    return {"driver_number": num, "lap_number": n, "lap_duration": duration,
            "duration_sector_1": s[0], "duration_sector_2": s[1], "duration_sector_3": s[2]}


def test_leaderboard_uses_each_drivers_latest_records():
    laps = [lap(1, 61, 101.0), lap(1, 62, 100.5), lap(63, 62, 100.9), lap(63, 61, 101.2)]
    stints = [
        {"driver_number": 1, "stint_number": 1, "lap_start": 1, "lap_end": 30, "compound": "MEDIUM", "tyre_age_at_start": 0},
        {"driver_number": 1, "stint_number": 2, "lap_start": 31, "lap_end": 62, "compound": "HARD", "tyre_age_at_start": 0},
        {"driver_number": 63, "stint_number": 2, "lap_start": 40, "lap_end": 62, "compound": "SOFT", "tyre_age_at_start": 3},
    ]
    intervals = [
        {"date": "2026-10-11T13:40:00", "driver_number": 63, "gap_to_leader": 9.0, "interval": 9.0},
        {"date": "2026-10-11T13:47:00", "driver_number": 63, "gap_to_leader": 4.25, "interval": 4.25},
        {"date": "2026-10-11T13:47:00", "driver_number": 1, "gap_to_leader": 0.0, "interval": 0.0},
    ]
    positions = [
        {"date": "2026-10-11T12:00:00", "driver_number": 63, "position": 1},
        {"date": "2026-10-11T13:00:00", "driver_number": 63, "position": 2},
        {"date": "2026-10-11T13:00:00", "driver_number": 1, "position": 1},
    ]
    board = ls.build_leaderboard(laps, stints, intervals, positions)
    assert board["1"] == {
        "position": 1, "lap_number": 62, "last_lap_time": 100.5, "s1": 30.0, "s2": 40.0, "s3": 30.0,
        "compound": "HARD", "tyre_age": 32, "gap_to_leader": 0.0, "gap_to_next": None, "is_pit": False,
    }
    assert board["63"]["position"] == 2
    assert board["63"]["tyre_age"] == 26
    assert board["63"]["gap_to_leader"] == 4.25
    assert board["63"]["gap_to_next"] == 4.25


def test_leaderboard_sorts_records_by_date_rather_than_trusting_the_order():
    laps = [lap(63, 62, 100.9)]
    intervals = [
        {"date": "2026-10-11T13:47:00", "driver_number": 63, "gap_to_leader": 4.25, "interval": 4.25},
        {"date": "2026-10-11T13:40:00", "driver_number": 63, "gap_to_leader": 9.0, "interval": 9.0},
    ]
    assert ls.build_leaderboard(laps, [], intervals, [])["63"]["gap_to_leader"] == 4.25


def test_leaderboard_keeps_lapped_gaps_as_text():
    laps = [lap(43, 61, 103.0)]
    intervals = [{"date": "2026-10-11T13:47:00", "driver_number": 43, "gap_to_leader": "+1 LAP", "interval": 2.1}]
    row = ls.build_leaderboard(laps, [], intervals, [])["43"]
    assert row["gap_to_leader"] == "+1 LAP"
    assert row["gap_to_next"] == 2.1


def test_leaderboard_marks_a_lap_without_a_time_as_a_pit_lap():
    row = ls.build_leaderboard([lap(4, 20, None)], [], [], [])["4"]
    assert row["is_pit"] is True
    assert row["last_lap_time"] is None
    assert row["position"] is None and row["compound"] is None


def test_fastf1_leaderboard_classifies_from_the_official_results():
    results = pd.DataFrame([
        {"DriverNumber": "63", "Position": 1.0, "Time": pd.Timedelta(seconds=5400), "Status": "Finished"},
        {"DriverNumber": "1", "Position": 2.0, "Time": pd.Timedelta(seconds=3.5), "Status": "Finished"},
        {"DriverNumber": "16", "Position": 3.0, "Time": pd.Timedelta(seconds=10.0), "Status": "Finished"},
        {"DriverNumber": "43", "Position": 4.0, "Time": pd.NaT, "Status": "+1 Lap"},
        {"DriverNumber": "7", "Position": 5.0, "Time": pd.NaT, "Status": "Retired"},
    ])
    rows = []
    for num, n in (("63", 57), ("1", 57), ("16", 57), ("43", 56), ("7", 20)):
        rows.append({"DriverNumber": num, "LapNumber": float(n), "LapTime": pd.Timedelta(seconds=95),
                     "Sector1Time": pd.Timedelta(seconds=30), "Sector2Time": pd.Timedelta(seconds=40),
                     "Sector3Time": pd.Timedelta(seconds=25), "Compound": "HARD", "TyreLife": 20.0})
    board = ls.fastf1_leaderboard(results, pd.DataFrame(rows))
    assert board["63"]["gap_to_leader"] == 0.0 and board["63"]["gap_to_next"] is None
    assert board["1"]["gap_to_leader"] == 3.5 and board["1"]["gap_to_next"] == 3.5
    assert board["16"]["gap_to_next"] == 6.5
    assert board["43"]["gap_to_leader"] == "+1 LAP" and board["43"]["gap_to_next"] is None
    assert board["7"]["gap_to_leader"] is None
    assert board["1"]["position"] == 2 and board["1"]["lap_number"] == 57
    assert board["1"]["last_lap_time"] == 95.0 and board["1"]["tyre_age"] == 20 and board["1"]["compound"] == "HARD"


def test_fastf1_driver_entries_come_from_the_race_results():
    results = pd.DataFrame([{
        "DriverNumber": "63", "Abbreviation": "RUS", "FirstName": "George", "LastName": "Russell",
        "FullName": "George Russell", "TeamName": "Mercedes", "TeamColor": "27F4D2", "CountryCode": "GBR",
    }, {
        "DriverNumber": "12", "Abbreviation": "ANT", "FirstName": "Andrea Kimi", "LastName": "Antonelli",
        "FullName": "Andrea Kimi Antonelli", "TeamName": "Mercedes", "TeamColor": None, "CountryCode": None,
    }])
    entries = ls.fastf1_driver_entries(results)
    assert entries[0] == {
        "driver_number": 63, "code": "RUS", "first_name": "George", "last_name": "Russell", "full_name": "George Russell",
        "team_name": "Mercedes", "team_color": "#27F4D2", "country_code": "GBR",
    }
    assert entries[1]["team_color"] == "#7f7f7f" and entries[1]["country_code"] == ""


def test_fastf1_race_control_is_newest_first_and_capped():
    messages = pd.DataFrame([
        {"Time": pd.Timestamp("2026-10-04T07:00:00"), "Category": "Flag", "Message": "GREEN LIGHT", "Flag": "GREEN"},
        {"Time": pd.Timestamp("2026-10-04T08:40:00"), "Category": "Flag", "Message": "CHEQUERED FLAG", "Flag": "CHEQUERED"},
        {"Time": pd.Timestamp("2026-10-04T07:30:00"), "Category": "Other", "Message": "TRACK LIMITS", "Flag": None},
    ])
    out = ls.fastf1_race_control(messages, limit=2)
    assert [m["message"] for m in out] == ["CHEQUERED FLAG", "TRACK LIMITS"]
    assert out[0] == {"timestamp": "2026-10-04T08:40:00+00:00", "category": "Flag", "message": "CHEQUERED FLAG", "flag": "CHEQUERED"}
    assert out[1]["flag"] is None


def test_fastf1_race_control_without_messages_is_empty():
    assert ls.fastf1_race_control(None) == []


def _row(position, gap, interval, lap_number=62):
    return {"position": position, "lap_number": lap_number, "last_lap_time": 98.0, "s1": None, "s2": None, "s3": None,
            "compound": "SOFT", "tyre_age": 10, "gap_to_leader": gap, "gap_to_next": interval, "is_pit": False}


def test_a_finished_session_takes_the_official_classification():
    board = {"3": _row(1, 0.0, None), "16": _row(2, 7.0, 7.0), "77": _row(19, "+1 LAP", 3.0, 59),
             "18": _row(20, "+1 LAP", 15.2, 37), "5": _row(22, 40.5, 0.8, 8)}
    results = [
        {"driver_number": 3, "position": 1, "gap_to_leader": 0, "dnf": False, "dns": False, "dsq": False},
        {"driver_number": 16, "position": 2, "gap_to_leader": 7.335, "dnf": False, "dns": False, "dsq": False},
        {"driver_number": 77, "position": 19, "gap_to_leader": "+3 LAPS", "dnf": False, "dns": False, "dsq": False},
        {"driver_number": 18, "position": None, "gap_to_leader": None, "dnf": True, "dns": False, "dsq": False},
        {"driver_number": 5, "position": None, "gap_to_leader": None, "dnf": False, "dns": False, "dsq": True},
    ]
    out = ls.apply_classification(board, results)
    assert (out["3"]["position"], out["3"]["gap_to_leader"], out["3"]["gap_to_next"]) == (1, 0, None)
    assert (out["16"]["gap_to_leader"], out["16"]["gap_to_next"]) == (7.335, 7.335)
    assert (out["77"]["gap_to_leader"], out["77"]["gap_to_next"]) == ("+3 LAPS", None)
    assert (out["18"]["position"], out["18"]["gap_to_leader"], out["18"]["gap_to_next"]) == (None, "DNF", None)
    assert out["5"]["gap_to_leader"] == "DSQ"
    assert out["18"]["last_lap_time"] == 98.0  # the rest of the row is kept


def test_classification_ignores_drivers_without_a_timing_row():
    out = ls.apply_classification({"3": _row(1, 0.0, None)}, [
        {"driver_number": 3, "position": 1, "gap_to_leader": 0},
        {"driver_number": 99, "position": None, "dns": True},
    ])
    assert list(out) == ["3"]


def test_a_retired_car_that_was_still_classified_keeps_its_place():
    # Singapore 2026: car 23 retired on lap 59 of 62 but is officially 18th
    board = {"11": _row(17, "+2 LAPS", None, 60), "23": _row(18, "+3 LAPS", None, 59), "77": _row(19, "+3 LAPS", None, 59)}
    out = ls.apply_classification(board, [
        {"driver_number": 11, "position": 17, "gap_to_leader": "+2 LAPS"},
        {"driver_number": 23, "position": 18, "gap_to_leader": None, "dnf": True},
        {"driver_number": 77, "position": 19, "gap_to_leader": "+3 LAPS"},
    ])
    assert (out["23"]["position"], out["23"]["gap_to_leader"]) == (18, "DNF")
    assert out["77"]["position"] == 19


def test_a_disqualified_car_loses_its_place():
    out = ls.apply_classification({"5": _row(4, 30.0, 2.0)}, [{"driver_number": 5, "position": 4, "dsq": True}])
    assert (out["5"]["position"], out["5"]["gap_to_leader"]) == (None, "DSQ")
