from app.services.live_timing import (
    apply_message,
    car_frames_from_state,
    drivers_from_state,
    is_session_active,
    race_control_from_state,
    radios_from_state,
    session_status_from_state,
    session_from_state,
    timing_from_state,
    weather_from_state,
)

# A trimmed snapshot in the shape F1's live timing feed sends (captured from 2026 Singapore Sprint Qualifying).
SNAPSHOT = {
    "SessionInfo": {
        "Meeting": {
            "Name": "Singapore Grand Prix",
            "Location": "Marina Bay",
            "Country": {"Code": "SGP", "Name": "Singapore"},
            "Circuit": {"Key": 61, "ShortName": "Singapore"},
        },
        "Key": 11379,
        "Type": "Qualifying",
        "Name": "Sprint Qualifying",
        "StartDate": "2026-10-09T20:30:00",
        "EndDate": "2026-10-09T21:14:00",
        "GmtOffset": "08:00:00",
        "Path": "2026/2026-10-11_Singapore_Grand_Prix/2026-10-09_Sprint_Qualifying/",
        "_kf": True,
    },
    "SessionStatus": {"Status": "Started", "_kf": True},
    "DriverList": {
        "63": {"RacingNumber": "63", "Tla": "RUS", "FirstName": "George", "LastName": "Russell",
               "FullName": "George RUSSELL", "TeamName": "Mercedes", "TeamColour": "00D7B6"},
        "16": {"RacingNumber": "16", "Tla": "LEC", "FirstName": "Charles", "LastName": "Leclerc",
               "FullName": "Charles LECLERC", "TeamName": "Ferrari", "TeamColour": "ED1131"},
        "_kf": True,
    },
    "TimingData": {
        "Lines": {
            "63": {
                "Position": "1", "InPit": False, "PitOut": False, "NumberOfLaps": 3,
                "Stats": [{"TimeDiffToFastest": "", "TimeDifftoPositionAhead": ""}, {}, {}],
                "Sectors": [{"Value": "28.101"}, {"Value": "36.502"}, {"Value": "26.003"}],
                "LastLapTime": {"Value": "1:30.606"},
            },
            "16": {
                "Position": "2", "InPit": False, "PitOut": True, "NumberOfLaps": 1,
                "Stats": [{"TimeDiffToFastest": "+0.214", "TimeDifftoPositionAhead": "+0.214"}, {}, {}],
                "Sectors": [{"Value": ""}, {"Value": ""}, {"Value": ""}],
                "LastLapTime": {"Value": ""},
            },
        },
        "_kf": True,
    },
    "TimingAppData": {
        "Lines": {
            "63": {"Stints": [{"Compound": "MEDIUM", "New": "true", "TotalLaps": 3}]},
            "16": {"Stints": []},
        },
        "_kf": True,
    },
    "WeatherData": {"AirTemp": "30.3", "Humidity": "77.8", "Rainfall": "0", "TrackTemp": "43.7",
                    "WindDirection": "224", "WindSpeed": "1.0", "_kf": True},
    "RaceControlMessages": {
        "Messages": [{"Utc": "2026-10-09T12:30:00", "Category": "Flag", "Flag": "GREEN",
                      "Message": "GREEN LIGHT - PIT EXIT OPEN"}],
        "_kf": True,
    },
    "TeamRadio": {
        "Captures": [{"Utc": "2026-10-09T12:26:37.5696012Z", "RacingNumber": "23",
                      "Path": "TeamRadio/ALB_23_20261009_202622.mp3"}],
        "_kf": True,
    },
}


def snapshot_state():
    state = {}
    for topic, data in SNAPSHOT.items():
        apply_message(state, topic, data)
    return state


def test_session_uses_the_feed_key_and_converts_local_times_to_utc():
    session = session_from_state(snapshot_state())
    assert session["session_key"] == 11379
    assert session["year"] == 2026
    assert session["location"] == "Marina Bay"
    assert session["country"] == "Singapore"
    assert session["circuit_short_name"] == "Singapore"
    assert session["session_name"] == "Sprint Qualifying"
    assert session["meeting_name"] == "Singapore Grand Prix"  # what the top bar names the weekend by
    assert session["date_start"] == "2026-10-09T12:30:00+00:00"
    assert session["date_end"] == "2026-10-09T13:14:00+00:00"


def test_session_is_active_until_it_is_finalised():
    state = snapshot_state()
    assert is_session_active(state)
    apply_message(state, "SessionStatus", {"Status": "Finished"})
    assert is_session_active(state)
    apply_message(state, "SessionStatus", {"Status": "Finalised"})
    assert not is_session_active(state)
    assert not is_session_active({})


def test_drivers_are_in_the_app_shape():
    drivers = drivers_from_state(snapshot_state())
    russell = next(d for d in drivers if d["driver_number"] == 63)
    assert russell == {
        "driver_number": 63, "code": "RUS", "first_name": "George", "last_name": "Russell",
        "full_name": "George RUSSELL", "team_name": "Mercedes", "team_color": "#00D7B6", "country_code": "",
    }
    assert len(drivers) == 2


def test_timing_parses_times_gaps_and_tyres():
    timing = timing_from_state(snapshot_state())
    assert timing["63"] == {
        "position": 1, "lap_number": 3, "last_lap_time": 90.606,
        "s1": 28.101, "s2": 36.502, "s3": 26.003,
        "gap_to_leader": 0.0, "gap_to_next": None,
        "compound": "MEDIUM", "tyre_age": 3, "is_pit": False,
    }
    leclerc = timing["16"]
    assert leclerc["position"] == 2
    assert leclerc["gap_to_leader"] == 0.214
    assert leclerc["gap_to_next"] == 0.214
    assert leclerc["last_lap_time"] is None
    assert leclerc["s1"] is None
    assert leclerc["compound"] is None
    assert leclerc["is_pit"] is True  # on an out lap


def test_race_gaps_come_from_gap_to_leader_and_interval():
    state = snapshot_state()
    apply_message(state, "TimingData", {"Lines": {
        "63": {"GapToLeader": "LAP 12", "IntervalToPositionAhead": {"Value": "LAP 12"}},
        "16": {"GapToLeader": "+3.456", "IntervalToPositionAhead": {"Value": "+3.456"}},
    }})
    timing = timing_from_state(state)
    assert timing["63"]["gap_to_leader"] == 0.0
    assert timing["16"]["gap_to_leader"] == 3.456
    assert timing["16"]["gap_to_next"] == 3.456


def test_a_lapped_gap_is_not_a_number():
    state = snapshot_state()
    apply_message(state, "TimingData", {"Lines": {"16": {"GapToLeader": "1L", "IntervalToPositionAhead": {"Value": "+0.8"}}}})
    assert timing_from_state(state)["16"]["gap_to_leader"] is None


def test_patches_merge_into_lists_by_index():
    state = snapshot_state()
    apply_message(state, "SessionInfo", {"Type": "Race", "Name": "Race"})
    apply_message(state, "TimingData", {"Lines": {"16": {
        "Sectors": {"0": {"Value": "28.333"}},
        "LastLapTime": {"Value": "1:31.002"},
        "NumberOfLaps": 2,
    }}})
    apply_message(state, "TimingAppData", {"Lines": {"16": {"Stints": {"0": {"Compound": "SOFT", "TotalLaps": 2}}}}})
    timing = timing_from_state(state)["16"]
    assert timing["s1"] == 28.333
    assert timing["s2"] is None
    assert timing["last_lap_time"] == 91.002
    assert timing["lap_number"] == 2
    assert timing["compound"] == "SOFT"
    assert timing["tyre_age"] == 2


def test_new_race_control_messages_arrive_as_indexed_patches():
    state = snapshot_state()
    apply_message(state, "RaceControlMessages", {"Messages": {"1": {
        "Utc": "2026-10-09T12:40:00", "Category": "Flag", "Flag": "YELLOW", "Message": "YELLOW IN TRACK SECTOR 4",
    }}})
    messages = race_control_from_state(state)
    assert [m["flag"] for m in messages] == ["YELLOW", "GREEN"]  # newest first
    assert messages[0] == {
        "timestamp": "2026-10-09T12:40:00", "category": "Flag",
        "message": "YELLOW IN TRACK SECTOR 4", "flag": "YELLOW",
    }


def test_weather_is_numeric():
    weather = weather_from_state(snapshot_state())
    assert weather["air_temperature"] == 30.3
    assert weather["track_temperature"] == 43.7
    assert weather["humidity"] == 77.8
    assert weather["rainfall"] == 0.0
    assert weather["wind_direction"] == 224.0
    assert weather["live_signal"] is True
    assert weather_from_state({}) is None


def test_radio_urls_point_at_the_session_archive():
    radios = radios_from_state(snapshot_state())
    assert radios == [{
        "driver_number": 23,
        "timestamp": "2026-10-09T12:26:37.5696012Z",
        "recording_url": "https://livetiming.formula1.com/static/2026/2026-10-11_Singapore_Grand_Prix/"
                         "2026-10-09_Sprint_Qualifying/TeamRadio/ALB_23_20261009_202622.mp3",
    }]


def _compressed(payload):
    import base64, json, zlib
    deflate = zlib.compressobj(wbits=-15)
    return base64.b64encode(deflate.compress(json.dumps(payload).encode()) + deflate.flush()).decode()


def test_car_positions_and_telemetry_decode_to_the_latest_frame_per_driver():
    state = snapshot_state()
    apply_message(state, "Position.z", _compressed({"Position": [
        {"Timestamp": "2026-10-09T12:50:00.1Z", "Entries": {"63": {"Status": "OnTrack", "X": 100, "Y": 200, "Z": 7}}},
        {"Timestamp": "2026-10-09T12:50:00.4Z", "Entries": {"63": {"Status": "OnTrack", "X": 110, "Y": 210, "Z": 7},
                                                          "16": {"Status": "OnTrack", "X": -50, "Y": 20, "Z": 6}}},
    ]}))
    apply_message(state, "CarData.z", _compressed({"Entries": [
        {"Utc": "2026-10-09T12:50:00.3Z", "Cars": {"63": {"Channels": {"0": 11000, "2": 280, "3": 7, "4": 100, "5": 0, "45": 12}}}},
    ]}))
    frames = {f["driver_number"]: f for f in car_frames_from_state(state)}
    assert frames[63] == {
        "driver_number": 63, "timestamp": "2026-10-09T12:50:00.4Z",
        "speed": 280, "throttle": 100, "brake": 0, "gear": 7, "rpm": 11000, "drs": 12,
        "x": 110, "y": 210, "z": 7, "live_signal": True,
    }
    assert frames[16]["x"] == -50
    assert frames[16]["speed"] == 0  # no car data for this car yet


def test_no_car_frames_without_position_data():
    assert car_frames_from_state(snapshot_state()) == []


def test_a_parked_cars_no_reading_values_are_not_shown_as_pedal_input():
    state = snapshot_state()
    apply_message(state, "Position.z", _compressed({"Position": [
        {"Timestamp": "t", "Entries": {"3": {"Status": "OnTrack", "X": 815, "Y": 3, "Z": 186}}},
    ]}))
    apply_message(state, "CarData.z", _compressed({"Entries": [
        {"Utc": "t", "Cars": {"3": {"Channels": {"0": 0, "2": 0, "3": 0, "4": 104, "5": 104, "45": 0}}}},
    ]}))
    frame = car_frames_from_state(state)[0]
    assert frame["throttle"] == 0
    assert frame["brake"] == 0


# --- Qualifying shows only real laps ---------------------------------------------------------------

def _lap(state, number, **line):
    apply_message(state, "TimingData", {"Lines": {number: line}})


def test_in_qualifying_an_out_lap_is_not_shown_as_the_lap_time():
    state = snapshot_state()  # 16 is on an out lap (PitOut) in the snapshot
    _lap(state, "16", PitOut=False)
    _lap(state, "16", LastLapTime={"Value": "1:55.120"}, NumberOfLaps=2)
    assert timing_from_state(state)["16"]["last_lap_time"] is None

    _lap(state, "16", LastLapTime={"Value": "1:30.950"}, NumberOfLaps=3)
    assert timing_from_state(state)["16"]["last_lap_time"] == 90.95


def test_in_qualifying_an_in_lap_is_not_shown_as_the_lap_time():
    state = snapshot_state()
    _lap(state, "63", InPit=True)
    _lap(state, "63", LastLapTime={"Value": "2:01.400"}, NumberOfLaps=4)
    assert timing_from_state(state)["63"]["last_lap_time"] == 90.606  # still the real lap

    # Back out of the pits: that out lap is skipped too, then the next push lap shows.
    _lap(state, "63", InPit=False, PitOut=True)
    _lap(state, "63", LastLapTime={"Value": "1:58.000"}, PitOut=False, NumberOfLaps=5)
    assert timing_from_state(state)["63"]["last_lap_time"] == 90.606
    _lap(state, "63", LastLapTime={"Value": "1:30.111"}, NumberOfLaps=6)
    assert timing_from_state(state)["63"]["last_lap_time"] == 90.111


def test_in_qualifying_a_cool_down_lap_is_not_shown_as_the_lap_time():
    state = snapshot_state()
    _lap(state, "63", LastLapTime={"Value": "1:49.000"}, NumberOfLaps=4)  # over 107% of 1:30.606
    assert timing_from_state(state)["63"]["last_lap_time"] == 90.606


def test_outside_qualifying_every_lap_is_shown():
    state = snapshot_state()
    apply_message(state, "SessionInfo", {"Type": "Race", "Name": "Race"})
    _lap(state, "63", InPit=True)
    _lap(state, "63", LastLapTime={"Value": "1:52.300"}, NumberOfLaps=4)
    assert timing_from_state(state)["63"]["last_lap_time"] == 112.3


# --- Stopped sessions ----------------------------------------------------------------------------

def _stopped_state():
    """Today's real red flag: SQ1 stopped at 12:35:51 UTC, race control set the restart at 20:46
    Singapore time (12:46 UTC)."""
    state = snapshot_state()
    apply_message(state, "SessionData", {"StatusSeries": [
        {"Utc": "2026-10-09T12:30:02.209Z", "SessionStatus": "Started"},
        {"Utc": "2026-10-09T12:35:51.495Z", "SessionStatus": "Aborted"},
        {"Utc": "2026-10-09T12:35:51.825Z", "TrackStatus": "Red"},
    ]})
    apply_message(state, "SessionStatus", {"Status": "Aborted"})
    apply_message(state, "TrackStatus", {"Status": "5", "Message": "Red"})
    apply_message(state, "RaceControlMessages", {"Messages": {"1": {
        "Utc": "2026-10-09T12:35:52", "Category": "Flag", "Flag": "RED", "Message": "RED FLAG"}}})
    return state


def test_a_running_session_is_not_stopped():
    assert session_status_from_state(snapshot_state()) == {
        "stopped": False, "red_flag": False, "announcement": None, "resumes_at": None,
    }


def test_a_red_flag_with_no_restart_time_yet():
    assert session_status_from_state(_stopped_state()) == {
        "stopped": True, "red_flag": True, "announcement": None, "resumes_at": None,
    }


def test_the_announced_restart_is_converted_from_track_time_to_utc():
    state = _stopped_state()
    apply_message(state, "RaceControlMessages", {"Messages": {"2": {
        "Utc": "2026-10-09T12:42:13", "Category": "Other", "Message": "SQ1 WILL RESUME AT 20:46"}}})
    apply_message(state, "SessionStatus", {"Status": "Inactive"})
    apply_message(state, "TrackStatus", {"Status": "1", "Message": "AllClear"})
    assert session_status_from_state(state) == {
        "stopped": True, "red_flag": False,
        "announcement": "SQ1 WILL RESUME AT 20:46", "resumes_at": "2026-10-09T12:46:00+00:00",
    }


def test_a_delay_between_qualifying_parts_counts_as_stopped():
    state = snapshot_state()
    apply_message(state, "SessionData", {"StatusSeries": [
        {"Utc": "2026-10-09T12:46:00.11Z", "SessionStatus": "Started"},
        {"Utc": "2026-10-09T12:52:09.115Z", "SessionStatus": "Finished"},
    ]})
    apply_message(state, "SessionStatus", {"Status": "Finished"})
    apply_message(state, "RaceControlMessages", {"Messages": {"1": {
        "Utc": "2026-10-09T13:05:26", "Category": "Other", "Message": "SQ2 WILL START AT 21:11"}}})
    status = session_status_from_state(state)
    assert status["stopped"] is True
    assert status["resumes_at"] == "2026-10-09T13:11:00+00:00"


def test_a_finished_session_with_no_restart_is_not_stopped():
    state = snapshot_state()
    apply_message(state, "SessionData", {"StatusSeries": [
        {"Utc": "2026-10-09T13:28:00.118Z", "SessionStatus": "Started"},
        {"Utc": "2026-10-09T13:36:00.133Z", "SessionStatus": "Finished"},
    ]})
    apply_message(state, "SessionStatus", {"Status": "Finished"})
    # An announcement from earlier in the session does not count once the session restarted after it.
    apply_message(state, "RaceControlMessages", {"Messages": {"1": {
        "Utc": "2026-10-09T13:25:01", "Category": "Other", "Message": "SQ3 WILL START AT 21:28"}}})
    assert session_status_from_state(state)["stopped"] is False


def test_a_restart_time_after_midnight_rolls_to_the_next_day():
    state = _stopped_state()
    apply_message(state, "RaceControlMessages", {"Messages": {"2": {
        "Utc": "2026-10-09T15:55:00", "Category": "Other", "Message": "RACE WILL RESUME AT 00:10"}}})
    # 15:55 UTC is 23:55 in Singapore, so 00:10 is the next day there: 16:10 UTC.
    assert session_status_from_state(state)["resumes_at"] == "2026-10-09T16:10:00+00:00"


def test_in_qualifying_a_driver_with_no_real_lap_seen_shows_their_best_lap():
    # Joined mid-session just after 16's in lap: that lap is hidden, but their best lap is real.
    state = {}
    apply_message(state, "SessionInfo", SNAPSHOT["SessionInfo"])
    apply_message(state, "TimingData", {"Lines": {
        "63": {"Position": "1", "LastLapTime": {"Value": "1:30.606"}, "BestLapTime": {"Value": "1:30.606"}},
        "16": {"Position": "2", "InPit": True, "LastLapTime": {"Value": "2:04.900"}, "BestLapTime": {"Value": "1:31.300"}},
    }})
    timing = timing_from_state(state)
    assert timing["63"]["last_lap_time"] == 90.606
    assert timing["16"]["last_lap_time"] == 91.3


def test_in_qualifying_gaps_come_from_the_current_part():
    state = snapshot_state()
    apply_message(state, "TimingData", {"SessionPart": 3, "Lines": {
        # Pole: fastest in Q3, but not in Q2, so Q2 still holds a gap for him.
        "63": {"Position": "1", "Stats": {
            "1": {"TimeDiffToFastest": "+0.455", "TimeDifftoPositionAhead": "+0.100"},
            "2": {"TimeDiffToFastest": "", "TimeDifftoPositionAhead": ""}}},
        "16": {"Position": "2", "Stats": {
            "2": {"TimeDiffToFastest": "+0.120", "TimeDifftoPositionAhead": "+0.120"}}},
    }})
    apply_message(state, "TimingData", {"Lines": {"44": {
        "Position": "11", "KnockedOut": True, "NumberOfLaps": 9,
        "Stats": [{"TimeDiffToFastest": "+0.800", "TimeDifftoPositionAhead": "+0.050"},
                  {"TimeDiffToFastest": "+1.003", "TimeDifftoPositionAhead": "+0.094"},
                  {"TimeDiffToFastest": "", "TimeDifftoPositionAhead": ""}],
    }}})
    timing = timing_from_state(state)
    assert timing["63"]["gap_to_leader"] == 0.0
    assert timing["16"]["gap_to_leader"] == 0.12
    assert timing["44"]["gap_to_leader"] == 1.003  # knocked out in Q2: the gap from the part they ran last


def test_in_qualifying_a_deleted_lap_is_not_shown():
    state = snapshot_state()
    apply_message(state, "TimingData", {"Lines": {"63": {"BestLapTime": {"Value": "1:31.020"}}}})
    _lap(state, "63", LastLapTime={"Value": "1:30.200"}, NumberOfLaps=4)
    assert timing_from_state(state)["63"]["last_lap_time"] == 90.2
    apply_message(state, "RaceControlMessages", {"Messages": {"1": {
        "Utc": "2026-10-09T12:40:00", "Category": "Other",
        "Message": "CAR 63 (RUS) TIME 1:30.200 DELETED - TRACK LIMITS AT TURN 19 LAP 4 20:39:51"}}})
    assert timing_from_state(state)["63"]["last_lap_time"] == 91.02  # back to the best valid lap


def test_in_qualifying_a_driver_whose_only_lap_this_part_was_deleted_shows_their_last_valid_part():
    # HAD in today's SQ3: his only SQ3 lap was deleted, so this part's best is blank.
    state = snapshot_state()
    apply_message(state, "TimingData", {"SessionPart": 3, "Lines": {"16": {
        "BestLapTime": {"Value": ""},
        "BestLapTimes": [{"Value": "1:34.182"}, {"Value": "1:32.947"}, {"Value": ""}],
    }}})
    assert timing_from_state(state)["16"]["last_lap_time"] == 92.947
