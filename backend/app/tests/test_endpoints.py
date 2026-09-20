import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "F1 Pit Wall API is Online"

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_get_active_session():
    # This might make a network call or fail if OpenF1 is offline. Let's make sure it handles responses.
    response = client.get("/api/v1/sessions/active")
    # It should either be 200 (if it succeeds) or 500/404 (with detail)
    assert response.status_code in [200, 404, 500]


def test_strategy_simulate_invalid_stint_plan_does_not_crash():
    response = client.post("/api/v1/strategy/simulate", json={
        "year": 2023, "gp": "Belgian Grand Prix", "session": "Race",
        "stints": [{"compound": "MEDIUM", "laps": 5}],
    })
    # FastF1 will actually try to load a real session here; a wildly-wrong lap
    # count should still surface as a 400 validation error, not a 500 crash,
    # once the session loads. If FastF1 itself can't reach network in CI, this
    # comes back as 500 with a network error -- assert it's one or the other,
    # never an unhandled exception (which TestClient would raise, not return).
    assert response.status_code in (400, 500)


def test_strategy_simulate_rejects_malformed_request_body():
    response = client.post("/api/v1/strategy/simulate", json={"year": 2023})
    assert response.status_code == 422


def test_result_card_returns_png_or_a_handled_error():
    response = client.get("/api/v1/share/result-card", params={
        "year": 2023, "gp": "Belgian Grand Prix", "driver": "VER", "session": "Race",
    })
    # Real FastF1 network call -- accept success or a handled (never unhandled) failure.
    assert response.status_code in (200, 404, 500)
    if response.status_code == 200:
        assert response.headers["content-type"] == "image/png"
        assert response.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_result_card_rejects_missing_required_params():
    response = client.get("/api/v1/share/result-card", params={"year": 2023})
    assert response.status_code == 422


def test_driver_season_insights_returns_empty_insights_when_uningested():
    response = client.get("/api/v1/drivers/ZZZ/season-insights", params={"year": 1950})
    assert response.status_code == 200
    body = response.json()
    assert body["driver_code"] == "ZZZ"
    assert body["insights"] == []


def test_driver_season_insights_rejects_missing_year():
    response = client.get("/api/v1/drivers/VER/season-insights")
    assert response.status_code == 422
