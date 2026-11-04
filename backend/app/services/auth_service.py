import hashlib
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import bcrypt
import httpx
from sqlalchemy.orm import Session

from app.models.models import SessionModel


# bcrypt only ever looks at the first 72 *bytes* of a password (and current
# versions raise rather than silently truncate). Callers validate against this;
# it's a byte limit, not a character limit -- "é" is 2 bytes.
MAX_PASSWORD_BYTES = 72
MIN_PASSWORD_LENGTH = 10
# Stored for accounts that sign in with Google only: not a bcrypt hash, so no password ever matches it.
UNUSABLE_PASSWORD = "!"


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


# ---- passwords seen in data breaches (Have I Been Pwned, k-anonymity) ----

_PWNED_URL = "https://api.pwnedpasswords.com/range/{prefix}"
_PWNED_TRANSPORT: Optional[httpx.AsyncBaseTransport] = None  # tests swap in a mock


async def password_is_breached(password: str) -> bool:
    """Whether the password appears in a known breach. Only the first five characters of its SHA-1 leave
    this server. False if the service can't be reached: signing up shouldn't depend on it."""
    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        async with httpx.AsyncClient(transport=_PWNED_TRANSPORT, timeout=3) as client:
            response = await client.get(_PWNED_URL.format(prefix=prefix), headers={"Add-Padding": "true"})
            response.raise_for_status()
    except httpx.HTTPError as e:
        print(f"Couldn't check the password against known breaches: {e!r}")
        return False
    return any(line.split(":")[0] == suffix and not line.endswith(":0") for line in response.text.splitlines())


# ---- per-account lockout ----

LOCK_AFTER = 5  # wrong passwords for one email from one address...
LOCK_WINDOW_S = 15 * 60  # ...within this long lock that pair for this long
# Keyed by email *and* address: keyed by email alone, anyone could lock a victim out by guessing. Guessing
# from many addresses is what the per-IP limits and the breached-password check are for.
# ponytail: no account-wide cap, as one would hand back the lock-out; add a CAPTCHA (Turnstile) past
# ~50 failures per email per hour if distributed guessing ever shows up in the logs.
# ponytail: in-process memory like rate_limit, so a restart forgets; move to Redis with more than one worker.
_failures: dict[tuple[str, str], deque] = defaultdict(deque)


def seconds_locked(email: str, ip: str) -> int:
    """How long sign-in for this email from this address stays locked, 0 if it isn't. Counted for unknown
    emails too, so a lock never reveals whether an account exists."""
    now = time.monotonic()
    failures = _failures[(email, ip)]
    while failures and failures[0] <= now - LOCK_WINDOW_S:
        failures.popleft()
    return int(failures[0] + LOCK_WINDOW_S - now) + 1 if len(failures) >= LOCK_AFTER else 0


def record_failure(email: str, ip: str) -> None:
    _failures[(email, ip)].append(time.monotonic())


def clear_failures(email: str, ip: str) -> None:
    _failures.pop((email, ip), None)


def reset_lockouts() -> None:
    _failures.clear()


# ---- sessions ----

SESSION_LIFETIME = timedelta(days=30)  # however active, sign in again after this
SESSION_IDLE = timedelta(days=7)  # unused this long, the session ends
_TOUCH_EVERY = timedelta(minutes=5)  # how stale last_seen_at may get, to spare a write per request


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user_id: int, user_agent: str = "", ip: str = "") -> str:
    """Starts a session and returns its token, the cookie value. Only the token's hash is stored."""
    token = secrets.token_urlsafe(32)
    now = _now()
    db.add(SessionModel(user_id=user_id, token_hash=hash_token(token), created_at=now, last_seen_at=now,
                        expires_at=now + SESSION_LIFETIME, user_agent=user_agent[:200], ip=ip[:45]))
    db.commit()
    return token


def find_session(db: Session, token: str) -> Optional[SessionModel]:
    """The live session for this token, or None. Ends a session that has expired or sat unused too long."""
    row = db.query(SessionModel).filter(SessionModel.token_hash == hash_token(token)).first()
    if row is None:
        return None
    now = _now()
    if now >= row.expires_at or now - row.last_seen_at >= SESSION_IDLE:
        db.delete(row)
        db.commit()
        return None
    if now - row.last_seen_at >= _TOUCH_EVERY:
        row.last_seen_at = now
        db.commit()
    return row


def end_session(db: Session, token: str) -> None:
    db.query(SessionModel).filter(SessionModel.token_hash == hash_token(token)).delete()
    db.commit()


def end_other_sessions(db: Session, user_id: int, keep_id: int) -> None:
    db.query(SessionModel).filter(SessionModel.user_id == user_id, SessionModel.id != keep_id).delete()
    db.commit()


def user_sessions(db: Session, user_id: int) -> List[SessionModel]:
    now = _now()
    rows = db.query(SessionModel).filter(SessionModel.user_id == user_id).order_by(SessionModel.last_seen_at.desc()).all()
    return [r for r in rows if now < r.expires_at and now - r.last_seen_at < SESSION_IDLE]
