from types import SimpleNamespace

import pandas as pd

from app.services import f1_data_service
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
            event={"OfficialEventName": f"{year} Singapore", "Location": "Marina Bay"},
        )

    monkeypatch.setattr(f1_data_service.fastf1, "get_session", fake_get_session)
    layout = f1_service.get_circuit_layout(2026, "Marina Bay", "Race")
    assert calls == [2026, 2025]
    assert layout["x"] == [1.0, 2.0]
    assert layout["location"] == "Marina Bay"
