import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt

from app.core.config import settings
from app.services.redis_service import redis_service


# bcrypt only ever looks at the first 72 *bytes* of a password (and current
# versions raise rather than silently truncate). Callers validate against this;
# it's a byte limit, not a character limit -- "é" is 2 bytes.
MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Never raises: a password longer than bcrypt's limit can't have been the one
    that was hashed, and a malformed stored hash can't match anything."""
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > MAX_PASSWORD_BYTES:
        return False
    try:
        return bcrypt.checkpw(password_bytes, password_hash.encode("utf-8"))
    except ValueError:
        return False


ALGORITHM = "HS256"
# Shortened from an earlier 7-day default after a security review flagged that
# logout didn't revoke the token -- paired with the revocation check below,
# but still bounding how long a token could matter even if revocation storage
# (Redis) happens to be unavailable when someone logs out.
DEFAULT_EXPIRY = timedelta(hours=24)


def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (expires_delta or DEFAULT_EXPIRY)
    payload = {"sub": str(user_id), "exp": expire, "jti": secrets.token_urlsafe(16)}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def _decode_payload(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        return None


def decode_access_token(token: str) -> Optional[int]:
    """Never raises -- any invalid/expired/malformed token becomes None. The
    caller (get_current_user) is what fails closed with a 401; this function's
    job is only to say whether the token itself checks out."""
    payload = _decode_payload(token)
    if payload is None:
        return None
    try:
        return int(payload["sub"])
    except (KeyError, ValueError):
        return None


def get_token_jti(token: str) -> Optional[str]:
    payload = _decode_payload(token)
    if payload is None:
        return None
    return payload.get("jti")


def _revocation_key(jti: str) -> str:
    return f"revoked_token:{jti}"


async def revoke_token(jti: str, ttl_seconds: int) -> None:
    """Best-effort -- if Redis is unreachable, logout still deletes the
    cookie (the primary user-visible effect); the token just remains
    technically valid until it naturally expires. Never raises."""
    if redis_service.client is None:
        await redis_service.connect()
    if redis_service.client is None:
        return
    try:
        await redis_service.client.set(_revocation_key(jti), "1", ex=ttl_seconds)
    except Exception as e:
        print(f"Failed to record token revocation: {e}")


async def is_token_revoked(jti: str) -> bool:
    """Defaults to False (not revoked) if Redis is unreachable -- the JWT's own
    signature/expiry check is still the primary guarantee; this is an
    additional layer, not the only one, so it degrades rather than fails closed."""
    if redis_service.client is None:
        await redis_service.connect()
    if redis_service.client is None:
        return False
    try:
        return bool(await redis_service.client.exists(_revocation_key(jti)))
    except Exception as e:
        print(f"Failed to check token revocation: {e}")
        return False
