"""Sign in with Google (OpenID Connect, authorization code flow).

The browser is sent to Google with a random `state` (stops someone signing you in to their account),
a PKCE challenge (a stolen code is useless without the verifier, which never leaves this server) and a
`nonce` (ties the returned ID token to this sign-in). All three ride in a short-lived httpOnly cookie.
Google's ID token is checked against its published keys, our client ID and Google's issuer."""
import base64
import hashlib
import secrets
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
COOKIE = "google_oauth"
COOKIE_MAX_AGE = 600  # a sign-in at Google has ten minutes to come back
_TRANSPORT: Optional[httpx.AsyncBaseTransport] = None  # tests swap in a mock
_jwks: Optional[jwt.PyJWKClient] = None


class GoogleSignInError(Exception):
    """Google's answer can't be trusted or used. The message is for the server log."""


def configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def redirect_uri() -> str:
    # On the site's own domain (Vercel proxies /api to the backend), so the session cookie set on the way
    # back is the site's first-party cookie.
    return f"{settings.SITE_URL.rstrip('/')}/api/v1/auth/google/callback"


def start() -> Tuple[str, str]:
    """The Google URL to send the browser to, and the cookie value that the callback checks it against."""
    state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    query = urlencode({
        "client_id": settings.GOOGLE_CLIENT_ID, "redirect_uri": redirect_uri(), "response_type": "code",
        "scope": "openid email profile", "state": state, "nonce": nonce,
        "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account",
    })
    return f"{AUTH_URL}?{query}", f"{state}.{nonce}.{verifier}"


def check_state(cookie: Optional[str], state: Optional[str]) -> Tuple[str, str]:
    """The nonce and PKCE verifier saved at the start, if `state` is the one this browser was given."""
    try:
        saved_state, nonce, verifier = (cookie or "").split(".")
    except ValueError:
        raise GoogleSignInError("no sign-in in progress in this browser")
    if not state or not secrets.compare_digest(saved_state, state):
        raise GoogleSignInError("state mismatch")
    return nonce, verifier


def owns_email(claims: Dict[str, Any]) -> bool:
    """Whether Google vouches for who holds the address now, not just that it was verified once: a Google
    account made with a work address keeps it after its owner leaves. Gmail addresses, and Workspace
    accounts (`hd`) whose domain Google manages, are the ones Google says to trust for linking accounts."""
    email = claims["email"].lower()
    return email.endswith("@gmail.com") or (bool(claims.get("hd")) and email.endswith("@" + claims["hd"].lower()))


def _signing_key(id_token: str) -> Any:
    global _jwks
    if _jwks is None:
        _jwks = jwt.PyJWKClient(JWKS_URL)  # caches Google's keys
    return _jwks.get_signing_key_from_jwt(id_token).key


async def finish(code: str, nonce: str, verifier: str) -> Dict[str, Any]:
    """Exchanges the code for Google's ID token and returns its verified claims (sub, email, name...)."""
    async with httpx.AsyncClient(transport=_TRANSPORT, timeout=10) as client:
        response = await client.post(TOKEN_URL, data={
            "code": code, "client_id": settings.GOOGLE_CLIENT_ID, "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri(), "grant_type": "authorization_code", "code_verifier": verifier,
        })
    if response.status_code != 200:
        raise GoogleSignInError(f"token exchange failed: HTTP {response.status_code}")
    id_token = response.json().get("id_token")
    if not id_token:
        raise GoogleSignInError("no ID token in Google's answer")
    try:
        claims = jwt.decode(id_token, _signing_key(id_token), algorithms=["RS256"],
                            audience=settings.GOOGLE_CLIENT_ID, issuer=ISSUERS)
    except jwt.PyJWTError as e:
        raise GoogleSignInError(f"ID token rejected: {e}")
    if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise GoogleSignInError("nonce mismatch")
    if claims.get("email_verified") is not True or not claims.get("email"):
        raise GoogleSignInError("Google hasn't verified this account's email")
    return claims
