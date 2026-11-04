"""Server-side sessions, per-account lockout and the password policy."""
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.models import SessionModel
from app.services import auth_service
from app.tests.conftest import _TestingSessionLocal

ORIGIN = {"Origin": "http://localhost:3000"}


def _signed_in(email, password="a-strong-password-1"):
    browser = TestClient(app, headers=ORIGIN)
    assert browser.post("/api/v1/auth/signup", json={"email": email, "password": password, "display_name": "Ann"}).status_code == 200
    return browser


def _login(email, password="a-strong-password-1"):
    browser = TestClient(app, headers=ORIGIN)
    return browser, browser.post("/api/v1/auth/login", json={"email": email, "password": password})


def _csrf(browser):
    return {"X-CSRF-Token": browser.cookies.get("csrf_token")}


def _row(token):
    db = _TestingSessionLocal()
    try:
        return db.query(SessionModel).filter(SessionModel.token_hash == auth_service.hash_token(token)).first()
    finally:
        db.close()


def _shift(token, **fields):
    """Moves a session's timestamps, as if time had passed."""
    db = _TestingSessionLocal()
    try:
        row = db.query(SessionModel).filter(SessionModel.token_hash == auth_service.hash_token(token)).first()
        for name, delta in fields.items():
            setattr(row, name, getattr(row, name) + delta)
        db.commit()
    finally:
        db.close()


# ---- sessions ----

def test_the_session_cookie_is_random_and_only_its_hash_is_stored():
    browser = _signed_in("hash-only@example.com")
    token = browser.cookies.get("session")
    row = _row(token)
    assert row is not None and row.token_hash != token
    assert "." not in token  # an opaque token, not a JWT carrying the user id


def test_signing_out_ends_the_session_for_good():
    browser = _signed_in("sign-out@example.com")
    token = browser.cookies.get("session")
    assert browser.post("/api/v1/auth/logout", headers=_csrf(browser)).status_code == 200
    replay = TestClient(app, headers=ORIGIN, cookies={"session": token})
    assert replay.get("/api/v1/auth/me").status_code == 401
    assert _row(token) is None


def test_a_session_ends_after_a_week_unused():
    browser = _signed_in("idle@example.com")
    _shift(browser.cookies.get("session"), last_seen_at=-auth_service.SESSION_IDLE - timedelta(minutes=1))
    assert browser.get("/api/v1/auth/me").status_code == 401


def test_a_session_ends_after_30_days_even_if_used():
    browser = _signed_in("old@example.com")
    _shift(browser.cookies.get("session"), expires_at=-auth_service.SESSION_LIFETIME)
    assert browser.get("/api/v1/auth/me").status_code == 401


def test_the_devices_list_marks_this_one_and_others_can_be_signed_out():
    laptop = _signed_in("devices@example.com")
    phone, response = _login("devices@example.com")
    assert response.status_code == 200

    sessions = laptop.get("/api/v1/auth/sessions").json()
    assert len(sessions) == 2
    assert [s["current"] for s in sessions].count(True) == 1
    phone_id = next(s["id"] for s in sessions if not s["current"])

    assert laptop.delete(f"/api/v1/auth/sessions/{phone_id}", headers=_csrf(laptop)).status_code == 200
    assert phone.get("/api/v1/auth/me").status_code == 401
    assert laptop.get("/api/v1/auth/me").status_code == 200


def test_nobody_can_sign_out_someone_elses_device():
    owner = _signed_in("owner@example.com")
    owner_id = owner.get("/api/v1/auth/sessions").json()[0]["id"]
    stranger = _signed_in("stranger@example.com")
    assert stranger.delete(f"/api/v1/auth/sessions/{owner_id}", headers=_csrf(stranger)).status_code == 404
    assert owner.get("/api/v1/auth/me").status_code == 200


def test_sign_out_everywhere_else_keeps_this_device():
    laptop = _signed_in("everywhere@example.com")
    phone, _ = _login("everywhere@example.com")
    tablet, _ = _login("everywhere@example.com")
    assert laptop.post("/api/v1/auth/sessions/sign-out-others", headers=_csrf(laptop)).status_code == 200
    assert laptop.get("/api/v1/auth/me").status_code == 200
    assert phone.get("/api/v1/auth/me").status_code == 401
    assert tablet.get("/api/v1/auth/me").status_code == 401


def test_changing_the_password_signs_out_every_other_device():
    laptop = _signed_in("change-pw@example.com")
    phone, _ = _login("change-pw@example.com")
    body = {"current_password": "a-strong-password-1", "new_password": "another-strong-one-2"}
    assert laptop.post("/api/v1/auth/password", json=body, headers=_csrf(laptop)).status_code == 200
    assert laptop.get("/api/v1/auth/me").status_code == 200
    assert phone.get("/api/v1/auth/me").status_code == 401
    assert _login("change-pw@example.com", "another-strong-one-2")[1].status_code == 200


def test_changing_the_password_needs_the_current_one():
    browser = _signed_in("wrong-current@example.com")
    body = {"current_password": "not-my-password", "new_password": "another-strong-one-2"}
    response = browser.post("/api/v1/auth/password", json=body, headers=_csrf(browser))
    assert response.status_code == 400
    assert response.json()["detail"] == "Your current password is incorrect."


# ---- lockout ----

def test_five_wrong_passwords_lock_the_account_for_a_while():
    _signed_in("locked@example.com")
    for _ in range(auth_service.LOCK_AFTER):
        assert _login("locked@example.com", "wrong-password")[1].status_code == 401
    response = _login("locked@example.com")[1]  # even the right password, until the lock lifts
    assert response.status_code == 429
    assert "Retry-After" in response.headers


def test_unknown_emails_lock_the_same_way_so_the_lock_reveals_nothing():
    for _ in range(auth_service.LOCK_AFTER):
        assert _login("nobody@example.com", "wrong-password")[1].status_code == 401
    assert _login("nobody@example.com", "wrong-password")[1].status_code == 429


def test_a_successful_sign_in_clears_earlier_failures():
    _signed_in("recovers@example.com")
    for _ in range(auth_service.LOCK_AFTER - 1):
        _login("recovers@example.com", "wrong-password")
    assert _login("recovers@example.com")[1].status_code == 200
    assert _login("recovers@example.com", "wrong-password")[1].status_code == 401


# ---- password policy ----

def test_passwords_need_at_least_10_characters():
    browser = TestClient(app, headers=ORIGIN)
    response = browser.post("/api/v1/auth/signup", json={"email": "short@example.com", "password": "nine-char", "display_name": "Ann"})
    assert response.status_code == 422


def test_a_password_from_a_known_breach_is_refused(monkeypatch):
    async def breached(password):
        return True
    monkeypatch.setattr(auth_service, "password_is_breached", breached)
    browser = TestClient(app, headers=ORIGIN)
    response = browser.post("/api/v1/auth/signup", json={"email": "pwned@example.com", "password": "password1234", "display_name": "Ann"})
    assert response.status_code == 400
    assert "data breach" in response.json()["detail"]


def _pwned_api(body="", status=200, fail=False):
    def handler(request):
        if fail:
            raise httpx.ConnectError("offline", request=request)
        return httpx.Response(status, text=body)
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_the_breach_check_sends_only_the_first_five_hash_characters(monkeypatch):
    import hashlib
    digest = hashlib.sha1(b"password1234").hexdigest().upper()
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(200, text=f"{digest[5:]}:42\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1")

    monkeypatch.setattr(auth_service, "_PWNED_TRANSPORT", httpx.MockTransport(handler))
    assert await auth_service.password_is_breached("password1234") is True
    assert seen == [f"https://api.pwnedpasswords.com/range/{digest[:5]}"]
    assert digest[5:] not in seen[0]


@pytest.mark.asyncio
async def test_the_breach_check_lets_signups_through_when_the_service_is_down(monkeypatch):
    monkeypatch.setattr(auth_service, "_PWNED_TRANSPORT", _pwned_api(fail=True))
    assert await auth_service.password_is_breached("anything-at-all-9") is False


def test_someone_elses_wrong_guesses_dont_lock_the_owner_out():
    # The lock counts failures per email and address, so an attacker can't lock a victim out by guessing.
    _signed_in("victim@example.com")
    attacker = TestClient(app, headers=ORIGIN, client=("203.0.113.66", 50000))
    for _ in range(auth_service.LOCK_AFTER + 1):
        attacker.post("/api/v1/auth/login", json={"email": "victim@example.com", "password": "wrong-password"})
    owner = TestClient(app, headers=ORIGIN, client=("198.51.100.7", 50000))
    assert owner.post("/api/v1/auth/login", json={"email": "victim@example.com", "password": "a-strong-password-1"}).status_code == 200
