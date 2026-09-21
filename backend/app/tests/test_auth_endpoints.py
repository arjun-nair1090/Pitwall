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


# --- input hardening ----------------------------------------------------------

import pytest  # noqa: E402


def _post_signup(email, password="valid-password-1", display_name="Tester"):
    return _client().post("/api/v1/auth/signup", json={
        "email": email, "password": password, "display_name": display_name,
    })


def test_signup_rejects_passwords_over_72_bytes_even_when_under_72_characters():
    # bcrypt limits the password to 72 *bytes*. 40 accented characters is 80 bytes:
    # previously this passed the length check and crashed hashing with a 500.
    response = _post_signup("multibyte-long@example.com", password="é" * 40)
    assert response.status_code == 422


def test_signup_accepts_a_multibyte_password_of_exactly_72_bytes():
    response = _post_signup("multibyte-ok@example.com", password="é" * 36)
    assert response.status_code == 200


def test_login_with_an_overlong_password_is_a_clean_401_not_a_500():
    _post_signup("overlong-login@example.com", password="correct-password-9")
    response = _client().post("/api/v1/auth/login", json={
        "email": "overlong-login@example.com", "password": "x" * 500,
    })
    assert response.status_code == 401


def test_emails_are_case_insensitive_and_stored_normalized():
    response = _post_signup("  MiXeD.Case@Example.COM ")
    assert response.status_code == 200
    assert response.json()["email"] == "mixed.case@example.com"

    login = _client().post("/api/v1/auth/login", json={
        "email": "MIXED.case@example.com", "password": "valid-password-1",
    })
    assert login.status_code == 200


def test_signup_treats_emails_differing_only_by_case_as_duplicates():
    assert _post_signup("dupe.case@example.com").status_code == 200
    assert _post_signup("DUPE.CASE@example.com").status_code == 409


@pytest.mark.parametrize("bad_email", ["notanemail", "a@b", "a b@example.com", "@example.com", "user@", "user@@example.com", "u@" + "x" * 300 + ".com"])
def test_signup_rejects_malformed_emails(bad_email):
    assert _post_signup(bad_email).status_code == 422


@pytest.mark.parametrize("bad_name", ["", "   ", "x" * 51])
def test_signup_rejects_invalid_display_names(bad_name):
    assert _post_signup("name-check@example.com", display_name=bad_name).status_code == 422


def test_signup_trims_display_names_and_allows_the_maximum_length():
    response = _post_signup("name-trim@example.com", display_name="  " + "n" * 50 + "  ")
    assert response.status_code == 200
    assert response.json()["display_name"] == "n" * 50


def test_login_still_verifies_a_password_hash_for_unknown_emails(monkeypatch):
    # An unknown email must cost the same as a wrong password, otherwise response
    # time reveals which addresses are registered.
    import app.api.v1.auth_endpoints as endpoints_module
    calls = []
    real_verify = endpoints_module.verify_password

    def spy(password, password_hash):
        calls.append(password_hash)
        return real_verify(password, password_hash)

    monkeypatch.setattr(endpoints_module, "verify_password", spy)
    response = _client().post("/api/v1/auth/login", json={"email": "nobody-here@example.com", "password": "whatever-1"})
    assert response.status_code == 401
    assert len(calls) == 1


def test_auth_cookies_share_the_tokens_lifetime():
    response = _post_signup("cookie-life@example.com")
    set_cookies = [v for k, v in response.headers.multi_items() if k.lower() == "set-cookie"]
    assert len(set_cookies) == 2
    assert all("Max-Age=86400" in c for c in set_cookies)
