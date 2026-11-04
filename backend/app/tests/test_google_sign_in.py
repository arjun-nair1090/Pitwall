"""Sign in with Google: the OAuth code flow with state, PKCE and nonce, and how Google accounts map to users.
Google itself is faked: its token endpoint by an httpx mock, its signing keys by a key made here."""
import base64
import hashlib
import time
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.models.models import IdentityModel, UserModel
from app.services import google_auth
from app.tests.conftest import _TestingSessionLocal

ORIGIN = {"Origin": "http://localhost:3000"}
SITE = "https://pitwall.example"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def google(monkeypatch):
    """Google sign-in configured, with a fake token endpoint that answers with the ID token in `issued`."""
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "client-123.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setattr(settings, "SITE_URL", SITE)
    monkeypatch.setattr(google_auth, "_signing_key", lambda token: _KEY.public_key())
    fake = {"issued": None, "requests": []}

    def token_endpoint(request):
        fake["requests"].append(parse_qs(request.content.decode()))
        return httpx.Response(200, json={"id_token": fake["issued"], "access_token": "unused"})

    monkeypatch.setattr(google_auth, "_TRANSPORT", httpx.MockTransport(token_endpoint))
    return fake


def _id_token(nonce, sub="google-sub-1", email="racer@gmail.com", verified=True, aud=None, **extra):
    claims = {"iss": "https://accounts.google.com", "aud": aud or settings.GOOGLE_CLIENT_ID, "sub": sub,
              "email": email, "email_verified": verified, "name": "Racing Fan", "nonce": nonce,
              "iat": int(time.time()), "exp": int(time.time()) + 600, **extra}
    return jwt.encode(claims, _KEY, algorithm="RS256", headers={"kid": "test"})


def _start(browser):
    response = browser.get("/api/v1/auth/google/start", follow_redirects=False)
    assert response.status_code == 302
    return parse_qs(urlparse(response.headers["location"]).query)


def _sign_in_with_google(google, browser=None, **token_claims):
    browser = browser or TestClient(app, headers=ORIGIN)
    params = _start(browser)
    google["issued"] = _id_token(params["nonce"][0], **token_claims)
    response = browser.get("/api/v1/auth/google/callback", params={"code": "auth-code", "state": params["state"][0]},
                           follow_redirects=False)
    return browser, response


def _user(email):
    db = _TestingSessionLocal()
    try:
        return db.query(UserModel).filter(UserModel.email == email).first()
    finally:
        db.close()


def test_the_site_can_ask_whether_google_sign_in_is_available(monkeypatch):
    browser = TestClient(app)
    assert browser.get("/api/v1/auth/providers").json() == {"google": True}
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "")
    assert browser.get("/api/v1/auth/providers").json() == {"google": False}
    assert browser.get("/api/v1/auth/google/start", follow_redirects=False).status_code == 404


def test_starting_sends_the_browser_to_google_with_state_nonce_and_pkce():
    browser = TestClient(app, headers=ORIGIN)
    params = _start(browser)
    assert params["client_id"] == [settings.GOOGLE_CLIENT_ID]
    assert params["redirect_uri"] == [f"{SITE}/api/v1/auth/google/callback"]
    assert params["scope"] == ["openid email profile"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["state"][0] and params["nonce"][0] and params["code_challenge"][0]
    assert "google_oauth" in browser.cookies


def test_a_new_google_user_gets_an_account_and_is_signed_in(google):
    browser, response = _sign_in_with_google(google)
    assert response.status_code == 303
    assert response.headers["location"] == f"{SITE}/predictions"
    assert browser.get("/api/v1/auth/me").json()["display_name"] == "Racing Fan"
    # the code was exchanged with the PKCE verifier matching the challenge sent to Google, and our secret
    sent = google["requests"][0]
    assert sent["code"] == ["auth-code"] and sent["client_secret"] == ["test-secret"]
    assert sent["redirect_uri"] == [f"{SITE}/api/v1/auth/google/callback"]


def test_the_pkce_verifier_matches_the_challenge(google):
    browser = TestClient(app, headers=ORIGIN)
    params = _start(browser)
    google["issued"] = _id_token(params["nonce"][0])
    browser.get("/api/v1/auth/google/callback", params={"code": "c", "state": params["state"][0]}, follow_redirects=False)
    verifier = google["requests"][0]["code_verifier"][0]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert params["code_challenge"] == [challenge]


def test_a_returning_google_user_gets_the_same_account(google):
    _sign_in_with_google(google, sub="returning-sub", email="back@gmail.com")
    browser, _ = _sign_in_with_google(google, sub="returning-sub", email="back@gmail.com")
    first_id = _user("back@gmail.com").id
    assert browser.get("/api/v1/auth/me").json()["id"] == first_id
    db = _TestingSessionLocal()
    try:
        assert db.query(IdentityModel).filter(IdentityModel.subject == "returning-sub").count() == 1
    finally:
        db.close()


def test_google_links_to_an_existing_account_and_switches_its_password_off(google):
    # Someone may have registered this email with a password before its owner ever signed in with Google
    # (nothing proved they own the address), so that password and its sessions must stop working.
    squatter = TestClient(app, headers=ORIGIN)
    squatter.post("/api/v1/auth/signup", json={"email": "linked@gmail.com", "password": "squatters-pass-1", "display_name": "Sq"})
    browser, response = _sign_in_with_google(google, sub="linked-sub", email="linked@gmail.com")
    assert response.status_code == 303
    assert browser.get("/api/v1/auth/me").json()["email"] == "linked@gmail.com"
    assert squatter.get("/api/v1/auth/me").status_code == 401
    login = TestClient(app, headers=ORIGIN).post("/api/v1/auth/login", json={"email": "linked@gmail.com", "password": "squatters-pass-1"})
    assert login.status_code == 401


def test_a_google_account_without_a_verified_email_is_refused(google):
    browser, response = _sign_in_with_google(google, email="unverified@gmail.com", verified=False)
    assert response.headers["location"] == f"{SITE}/login?error=google"
    assert browser.get("/api/v1/auth/me").status_code == 401
    assert _user("unverified@gmail.com") is None


def test_a_forged_state_is_refused(google):
    browser = TestClient(app, headers=ORIGIN)
    params = _start(browser)
    google["issued"] = _id_token(params["nonce"][0])
    response = browser.get("/api/v1/auth/google/callback", params={"code": "c", "state": "attacker-state"}, follow_redirects=False)
    assert response.headers["location"] == f"{SITE}/login?error=google"
    assert google["requests"] == []  # never even exchanged the code
    assert browser.get("/api/v1/auth/me").status_code == 401


@pytest.mark.parametrize("bad", [{"nonce": "replayed"}, {"aud": "someone-elses-app"}, {"iss": "https://evil.example"}])
def test_an_id_token_with_the_wrong_nonce_audience_or_issuer_is_refused(google, bad):
    browser = TestClient(app, headers=ORIGIN)
    params = _start(browser)
    claims = {"nonce": params["nonce"][0], **bad}
    nonce = claims.pop("nonce")
    google["issued"] = _id_token(nonce, **claims)
    response = browser.get("/api/v1/auth/google/callback", params={"code": "c", "state": params["state"][0]}, follow_redirects=False)
    assert response.headers["location"] == f"{SITE}/login?error=google"
    assert browser.get("/api/v1/auth/me").status_code == 401


def test_cancelling_at_google_comes_back_to_the_login_page():
    browser = TestClient(app, headers=ORIGIN)
    params = _start(browser)
    response = browser.get("/api/v1/auth/google/callback", params={"error": "access_denied", "state": params["state"][0]},
                           follow_redirects=False)
    assert response.headers["location"] == f"{SITE}/login?error=google_cancelled"
