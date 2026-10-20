import asyncio

import pytest

from app.services import ai_strategist as m

DRIVERS = [{"driver_number": n, "code": c, "team_name": "Team"} for n, c in ((3, "VER"), (16, "LEC"), (10, "GAS"), (23, "ALB"))]


def _row(position, gap, interval):
    return {"position": position, "gap_to_leader": gap, "gap_to_next": interval, "compound": "MEDIUM", "tyre_age": 20}


@pytest.fixture
def feed(monkeypatch):
    """What the live data service answers; each test fills in the timing and race control."""
    data = {"timing": {}, "race_control": []}

    async def timing(_):
        return data["timing"]

    async def drivers(_):
        return DRIVERS

    async def weather(_):
        return {"rainfall": 0}

    async def race_control(_):
        return data["race_control"]

    monkeypatch.setattr(m.f1_service, "get_live_timing", timing)
    monkeypatch.setattr(m.f1_service, "get_drivers", drivers)
    monkeypatch.setattr(m.f1_service, "get_live_weather", weather)
    monkeypatch.setattr(m.f1_service, "get_live_race_control", race_control)
    return data


def strategy():
    return asyncio.run(m.ai_strategist.get_strategy_recommendations(11388))


def test_lapped_and_retired_cars_are_not_undercut_threats(feed):
    feed["timing"] = {"3": _row(1, 0, None), "16": _row(2, 0.9, 0.9), "10": _row(3, "+1 LAP", None), "23": _row(4, "DNF", None)}
    threats = strategy()["undercut_threats"]
    assert [(t["leader"], t["chaser"], t["gap"]) for t in threats] == [("VER", "LEC", 0.9)]


def test_a_deployed_safety_car_is_a_cheap_pit_stop(feed):
    feed["race_control"] = [  # newest first
        {"category": "SafetyCar", "flag": None, "message": "VSC DEPLOYED"},
        {"category": "Flag", "flag": "YELLOW", "message": "YELLOW IN TRACK SECTOR 5"},
    ]
    sc = strategy()["safety_car_opportunity"]
    assert sc["active"] is True and sc["reason"] == "VSC DEPLOYED"


def test_a_safety_car_that_has_ended_is_not(feed):
    feed["race_control"] = [
        {"category": "SafetyCar", "flag": None, "message": "VSC ENDING"},
        {"category": "SafetyCar", "flag": None, "message": "VSC DEPLOYED"},
    ]
    assert strategy()["safety_car_opportunity"]["active"] is False
