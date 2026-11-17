import threading
import time
from types import SimpleNamespace

import pandas as pd

from app.core.config import settings
from app.services import f1_data_service, session_info
from app.services.f1_data_service import f1_service


class _Lap:
    def get_telemetry(self):
        return pd.DataFrame({"X": [1.0, 2.0], "Y": [3.0, 4.0]})


def test_layout_falls_back_to_an_earlier_year_when_this_years_race_has_not_run(monkeypatch):
    calls = []

    def fake_get_session(year, gp, session_type):
        calls.append(year)

        def load(**kwargs):
            if year == 2026:
                raise ValueError("no data yet")

        return SimpleNamespace(
            load=load,
            laps=SimpleNamespace(pick_fastest=lambda: _Lap()),
            event={"OfficialEventName": f"{year} Singapore", "Location": "Marina Bay", "RoundNumber": 18,
                   "EventName": "Singapore Grand Prix"},
        )

    monkeypatch.setattr(f1_data_service.fastf1, "get_session", fake_get_session)
    layout = f1_service.get_circuit_layout(2026, "Marina Bay", "Race")
    assert calls == [2026, 2025]
    assert layout["x"] == [1.0, 2.0]
    assert layout["location"] == "Marina Bay"


def test_an_earlier_year_is_found_by_the_race_not_the_venue_name(monkeypatch):
    # FastF1 calls Abu Dhabi's venue "Yas Marina" in 2026 but "Yas Island" in 2025: only the race's
    # name finds last year's while this year's hasn't run.
    calls = []

    def fake_get_session(year, gp, session_type):
        calls.append((year, gp))
        if year == 2025 and gp != "Abu Dhabi Grand Prix":
            raise ValueError("Found no match for 'yasmarina'")

        def load(**kwargs):
            if year == 2026:
                raise ValueError("no data yet")

        return SimpleNamespace(load=load, laps=SimpleNamespace(pick_fastest=lambda: _Lap()),
                               event={"OfficialEventName": "Abu Dhabi", "Location": "Yas Island", "RoundNumber": 24,
                                      "EventName": "Abu Dhabi Grand Prix"})

    monkeypatch.setattr(f1_data_service.fastf1, "get_session", fake_get_session)
    layout = f1_service.get_circuit_layout(2026, "Yas Marina", "Race")
    assert "error" not in layout
    assert calls == [(2026, "Yas Marina"), (2025, "Abu Dhabi Grand Prix")]


class _NoPositionLap:
    def get_telemetry(self):
        raise KeyError("None of ['Date'] are in the columns")  # F1 sent no position data for this lap


def test_a_fastest_lap_without_position_data_gives_way_to_the_next_quickest(monkeypatch):
    # 2026 Monaco: the fastest lap has no position samples, so the outline comes from another lap.
    others = SimpleNamespace(iterlaps=lambda: iter([(0, _NoPositionLap()), (1, _Lap())]))
    laps = SimpleNamespace(pick_fastest=lambda: _NoPositionLap(),
                           sort_values=lambda *a, **k: SimpleNamespace(head=lambda n: others))
    session = SimpleNamespace(load=lambda **k: None, laps=laps,
                              event={"OfficialEventName": "Monaco", "Location": "Monte Carlo"})
    assert f1_service._outline(session)["x"] == [1.0, 2.0]


def _counting_session(loads, fail=False):
    def fake_get_session(year, gp, session_type):
        def load(**kwargs):
            loads.append((year, gp))
            if fail:
                raise ValueError("no data")

        return SimpleNamespace(
            load=load,
            laps=SimpleNamespace(pick_fastest=lambda: _Lap()),
            event={"OfficialEventName": "Singapore", "Location": "Marina Bay", "RoundNumber": 18,
                   "EventName": "Singapore Grand Prix"},
        )
    return fake_get_session


def test_layout_is_worked_out_once_whatever_the_race_is_called(monkeypatch, tmp_path):
    # Each outline costs a full telemetry load (hundreds of MB), so it must not repeat per visit.
    monkeypatch.setattr(settings, "SAVED_ANALYSES_DIR", str(tmp_path))
    loads = []
    monkeypatch.setattr(f1_data_service.fastf1, "get_session", _counting_session(loads))
    first = f1_service.get_circuit_layout(2025, "Marina Bay", "Race")
    assert f1_service.get_circuit_layout(2025, "Singapore", "Race") == first  # same race, other spelling
    assert len(loads) == 1


def test_a_failed_layout_is_not_saved(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "SAVED_ANALYSES_DIR", str(tmp_path))
    loads = []
    monkeypatch.setattr(f1_data_service.fastf1, "get_session", _counting_session(loads, fail=True))
    assert "error" in f1_service.get_circuit_layout(2025, "Marina Bay", "Race")
    monkeypatch.setattr(f1_data_service.fastf1, "get_session", _counting_session(loads))
    assert "error" not in f1_service.get_circuit_layout(2025, "Marina Bay", "Race")


def test_telemetry_loads_never_overlap(monkeypatch):
    # Two at once need ~700 MB, more than the server has: the second waits instead.
    running, peak = [0], [0]

    def fake_get_session(year, event, session_name):
        def load(**kwargs):
            running[0] += 1
            peak[0] = max(peak[0], running[0])
            time.sleep(0.05)
            running[0] -= 1

        return SimpleNamespace(load=load, laps=pd.DataFrame({"LapNumber": [1]}), event={"EventName": "Singapore"})

    monkeypatch.setattr(session_info.fastf1, "get_session", fake_get_session)
    threads = [threading.Thread(target=session_info.load_session, args=(2025, "Singapore", "R"), kwargs={"telemetry": True})
               for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak[0] == 1


def test_an_outline_from_an_earlier_year_is_kept_for_the_year_asked(monkeypatch, tmp_path):
    # Otherwise every visit first retries this year's race: a futile download before it has run, or
    # (2026 Monaco) a whole session's telemetry that turns out to have no position data.
    monkeypatch.setattr(settings, "SAVED_ANALYSES_DIR", str(tmp_path))
    loads = []

    def fake_get_session(year, gp, session_type):
        def load(**kwargs):
            loads.append(year)
            if year == 2026:
                raise ValueError("not run yet")

        return SimpleNamespace(load=load, laps=SimpleNamespace(pick_fastest=lambda: _Lap()),
                               event={"OfficialEventName": "Las Vegas", "Location": "Las Vegas", "RoundNumber": 22,
                                      "EventName": "Las Vegas Grand Prix"})

    monkeypatch.setattr(f1_data_service.fastf1, "get_session", fake_get_session)
    first = f1_service.get_circuit_layout(2026, "Las Vegas", "Race")
    assert loads == [2026, 2025]
    assert f1_service.get_circuit_layout(2026, "Las Vegas", "Race") == first
    assert loads == [2026, 2025]  # nothing loaded the second time
