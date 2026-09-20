from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

ALLOWED_ORIGIN = {"Origin": "http://localhost:3000"}

client = TestClient(app, headers=ALLOWED_ORIGIN)


def _authed_client(email):
    c = TestClient(app, headers=ALLOWED_ORIGIN)
    c.post("/api/v1/auth/signup", json={"email": email, "password": "some-password-1", "display_name": email.split("@")[0]})
    return c


def test_submit_prediction_requires_authentication():
    anon = TestClient(app, headers=ALLOWED_ORIGIN)
    response = anon.post("/api/v1/predictions", json={
        "year": 2020, "event_name": "Belgian Grand Prix",
        "predicted_p1": "VER", "predicted_p2": "NOR", "predicted_p3": "LEC",
    })
    assert response.status_code == 401


def test_submit_prediction_requires_csrf_header():
    c = _authed_client("predict-csrf@example.com")
    response = c.post("/api/v1/predictions", json={
        "year": 2020, "event_name": "Belgian Grand Prix",
        "predicted_p1": "VER", "predicted_p2": "NOR", "predicted_p3": "LEC",
    })
    assert response.status_code == 403


def test_submit_prediction_rejects_invalid_driver_code():
    c = _authed_client("predict-invalid@example.com")
    csrf = c.cookies.get("csrf_token")
    with patch("app.services.predictions_service.race_has_started", return_value=False):
        response = c.post(
            "/api/v1/predictions",
            json={"year": 2030, "event_name": "Belgian Grand Prix", "predicted_p1": "VER", "predicted_p2": "NOR", "predicted_p3": "ZZZ"},
            headers={"X-CSRF-Token": csrf},
        )
    assert response.status_code == 400


def test_leaderboard_is_public_and_returns_empty_list_with_no_predictions():
    response = client.get("/api/v1/leaderboard", params={"year": 1901})
    assert response.status_code == 200
    assert response.json() == []


def test_score_race_awards_points_based_on_real_result():
    c = _authed_client("scorer@example.com")
    csrf = c.cookies.get("csrf_token")
    with patch("app.services.predictions_service.race_has_started", return_value=False):
        c.post(
            "/api/v1/predictions",
            json={"year": 2023, "event_name": "Belgian Grand Prix", "predicted_p1": "VER", "predicted_p2": "PER", "predicted_p3": "HAM"},
            headers={"X-CSRF-Token": csrf},
        )

    response = client.post("/api/v1/predictions/score", json={"year": 2023, "event_name": "Belgian Grand Prix"})
    assert response.status_code == 200

    me = c.get("/api/v1/predictions/me", params={"year": 2023})
    # Real 2023 Belgian GP top 3 was VER/PER/LEC -- VER and PER match this
    # prediction's p1/p2 exactly, HAM (p3) isn't in the real top 3 at all:
    # 2 correct drivers x 10 points = 20.
    assert me.json()[0]["points_awarded"] == 20
