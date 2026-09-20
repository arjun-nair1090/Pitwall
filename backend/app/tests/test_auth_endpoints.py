from fastapi.testclient import TestClient

from app.main import app

ALLOWED_ORIGIN = {"Origin": "http://localhost:3000"}


def _client():
    return TestClient(app, headers=ALLOWED_ORIGIN)


client = _client()


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
    anon_client = _client()
    response = anon_client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_me_returns_current_user_when_authenticated():
    authed_client = _client()
    authed_client.post("/api/v1/auth/signup", json={
        "email": "me@example.com", "password": "some-password-3", "display_name": "MeUser",
    })
    response = authed_client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["display_name"] == "MeUser"


def test_logout_without_csrf_header_is_rejected():
    authed_client = _client()
    authed_client.post("/api/v1/auth/signup", json={
        "email": "logout-csrf@example.com", "password": "some-password-4", "display_name": "LogoutUser",
    })
    response = authed_client.post("/api/v1/auth/logout")
    assert response.status_code == 403


def test_logout_with_correct_csrf_header_succeeds():
    authed_client = _client()
    authed_client.post("/api/v1/auth/signup", json={
        "email": "logout-ok@example.com", "password": "some-password-5", "display_name": "LogoutUser2",
    })
    csrf_token = authed_client.cookies.get("csrf_token")
    response = authed_client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf_token})
    assert response.status_code == 200


def test_signup_rejects_short_password():
    response = _signup(email="shortpw@example.com", password="short1")
    assert response.status_code == 422


def test_signup_and_login_reject_missing_or_disallowed_origin():
    # Simulates a cross-site form POST -- browsers won't attach an
    # Origin matching this app's own allowed origins for that.
    no_origin_client = TestClient(app)
    response = no_origin_client.post(
        "/api/v1/auth/signup",
        json={"email": "origin-check@example.com", "password": "some-password-6", "display_name": "OriginUser"},
        headers={"Origin": "https://evil.example.com"},
    )
    assert response.status_code == 403


def test_logout_revokes_the_token_so_it_cannot_be_reused(monkeypatch):
    import app.services.auth_service as auth_service_module

    class FakeRedisClient:
        def __init__(self):
            self._store = {}

        async def set(self, key, value, ex=None):
            self._store[key] = value

        async def exists(self, key):
            return 1 if key in self._store else 0

    monkeypatch.setattr(auth_service_module.redis_service, "client", FakeRedisClient())

    authed_client = _client()
    authed_client.post("/api/v1/auth/signup", json={
        "email": "revoke-me@example.com", "password": "some-password-8", "display_name": "RevokeUser",
    })

    stolen_session_cookie = authed_client.cookies.get("session")
    csrf_token = authed_client.cookies.get("csrf_token")

    logout_response = authed_client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf_token})
    assert logout_response.status_code == 200

    # Simulate an attacker who captured the raw token before logout and
    # replays it directly on a fresh client (the original client's cookie
    # jar already dropped it via logout's Set-Cookie -- this bypasses that
    # to prove the token itself is rejected, not just "cookie is missing").
    replay_client = _client()
    replay_client.cookies.set("session", stolen_session_cookie)
    response = replay_client.get("/api/v1/auth/me")
    assert response.status_code == 401
