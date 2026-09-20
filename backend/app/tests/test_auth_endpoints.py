from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _signup(email="user@example.com", password="hunter2horse", display_name="Tester"):
    return client.post("/api/v1/auth/signup", json={
        "email": email, "password": password, "display_name": display_name,
    })


def test_signup_sets_session_and_csrf_cookies():
    response = _signup()
    assert response.status_code == 200
    assert "session" in response.cookies
    assert "csrf_token" in response.cookies
    body = response.json()
    assert body["email"] == "user@example.com"
    assert body["display_name"] == "Tester"
    assert "password" not in body
    assert "password_hash" not in body


def test_signup_rejects_duplicate_email():
    _signup(email="dupe@example.com")
    response = _signup(email="dupe@example.com")
    assert response.status_code == 409


def test_login_with_correct_password_succeeds():
    _signup(email="login-ok@example.com", password="correct-password-1")
    response = client.post("/api/v1/auth/login", json={
        "email": "login-ok@example.com", "password": "correct-password-1",
    })
    assert response.status_code == 200
    assert "session" in response.cookies


def test_login_with_wrong_password_returns_401():
    _signup(email="login-bad@example.com", password="correct-password-2")
    response = client.post("/api/v1/auth/login", json={
        "email": "login-bad@example.com", "password": "wrong-password",
    })
    assert response.status_code == 401


def test_me_requires_authentication():
    anon_client = TestClient(app)
    response = anon_client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_me_returns_current_user_when_authenticated():
    authed_client = TestClient(app)
    authed_client.post("/api/v1/auth/signup", json={
        "email": "me@example.com", "password": "some-password-3", "display_name": "MeUser",
    })
    response = authed_client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["display_name"] == "MeUser"


def test_logout_without_csrf_header_is_rejected():
    authed_client = TestClient(app)
    authed_client.post("/api/v1/auth/signup", json={
        "email": "logout-csrf@example.com", "password": "some-password-4", "display_name": "LogoutUser",
    })
    response = authed_client.post("/api/v1/auth/logout")
    assert response.status_code == 403


def test_logout_with_correct_csrf_header_succeeds():
    authed_client = TestClient(app)
    authed_client.post("/api/v1/auth/signup", json={
        "email": "logout-ok@example.com", "password": "some-password-5", "display_name": "LogoutUser2",
    })
    csrf_token = authed_client.cookies.get("csrf_token")
    response = authed_client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf_token})
    assert response.status_code == 200
