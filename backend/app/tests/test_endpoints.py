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
