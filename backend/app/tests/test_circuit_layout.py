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
            event={"OfficialEventName": f"{year} Singapore", "Location": "Marina Bay", "RoundNumber": 18},
        )

    monkeypatch.setattr(f1_data_service.fastf1, "get_session", fake_get_session)
    layout = f1_service.get_circuit_layout(2026, "Marina Bay", "Race")
    assert calls == [2026, 2025]
    assert layout["x"] == [1.0, 2.0]
    assert layout["location"] == "Marina Bay"


def _counting_session(loads, fail=False):
    def fake_get_session(year, gp, session_type):
        def load(**kwargs):
            loads.append((year, gp))
            if fail:
                raise ValueError("no data")

        return SimpleNamespace(
            load=load,
            laps=SimpleNamespace(pick_fastest=lambda: _Lap()),
            event={"OfficialEventName": "Singapore", "Location": "Marina Bay", "RoundNumber": 18},
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
