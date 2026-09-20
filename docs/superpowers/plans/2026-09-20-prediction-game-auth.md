# Auth + Prediction Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real user accounts (bcrypt + JWT httpOnly cookie + CSRF), then a top-3 race-prediction game with a public leaderboard, scored against real official results.

**Architecture:** `UserModel`/`PredictionModel` tables (created via the existing `Base.metadata.create_all()` startup hook, no new migration tooling needed). `auth_service.py` holds pure password-hashing and JWT functions. A new `auth_endpoints.py` router owns signup/login/logout/me and the `get_current_user`/`verify_csrf` dependencies other routes import. `predictions_service.py` holds pure validation/scoring functions; prediction endpoints live alongside auth in the same router file (small enough not to warrant a third file yet).

**Tech Stack:** FastAPI, SQLAlchemy (existing), `bcrypt`, `PyJWT` (both already transitive deps, now pinned directly), pytest + `fastapi.testclient.TestClient` (existing).

**Spec:** `docs/superpowers/specs/2026-09-20-prediction-game-auth-design.md`

## Global Constraints

- `decode_access_token` never raises — invalid/expired/malformed all become `None`; the *caller* (`get_current_user`) is what fails closed with 401. Auth never silently degrades to "some other user" or "anonymous but privileged."
- Every mutating route (`POST`/`PUT`/`DELETE`) that requires a logged-in user also requires CSRF verification — the two checks are independent and both must pass.
- Cookies: `session` is `httponly=True`; `csrf_token` is **not** httpOnly (the frontend must read it). Both `samesite="lax"`, `secure=(RUNNING_LOCALLY != "true")`.
- Prediction driver codes are validated against the same known-code list `strategy_simulator.py` already validates compounds against style — reuse `FALLBACK_2024_DRIVERS`' code set, don't invent a second list.
- `/predictions/score` is intentionally unauthenticated — it only recomputes points from real official results (see spec's "Non-goals" section for why this is safe).

---

### Task 1: User and Prediction models

**Files:**
- Modify: `backend/app/models/models.py`
- Test: `backend/app/tests/test_models.py` (new file)

**Interfaces:**
- Produces: `UserModel`, `PredictionModel` (SQLAlchemy models, importable from `app.models.models`)

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_models.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.models import PredictionModel, UserModel


def test_user_and_prediction_models_create_tables_and_round_trip():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    user = UserModel(email="test@example.com", display_name="Tester", password_hash="hashed")
    db.add(user)
    db.commit()
    db.refresh(user)

    prediction = PredictionModel(
        user_id=user.id, year=2026, event_name="Belgian Grand Prix",
        predicted_p1="VER", predicted_p2="NOR", predicted_p3="LEC",
    )
    db.add(prediction)
    db.commit()
    db.refresh(prediction)

    assert prediction.id is not None
    assert prediction.points_awarded is None
    assert prediction.user_id == user.id


def test_prediction_unique_constraint_rejects_duplicate_user_year_event():
    import pytest
    from sqlalchemy.exc import IntegrityError

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    user = UserModel(email="test2@example.com", display_name="Tester2", password_hash="hashed")
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(PredictionModel(user_id=user.id, year=2026, event_name="Belgian Grand Prix", predicted_p1="VER", predicted_p2="NOR", predicted_p3="LEC"))
    db.commit()

    db.add(PredictionModel(user_id=user.id, year=2026, event_name="Belgian Grand Prix", predicted_p1="HAM", predicted_p2="RUS", predicted_p3="ALO"))
    with pytest.raises(IntegrityError):
        db.commit()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'UserModel'`

- [ ] **Step 3: Add the models**

In `backend/app/models/models.py`, add the import and both models (matching this file's existing style):

```python
from sqlalchemy.sql import func

class UserModel(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    display_name = Column(String(50), nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class PredictionModel(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    year = Column(Integer, nullable=False)
    event_name = Column(String(200), nullable=False)
    predicted_p1 = Column(String(3), nullable=False)
    predicted_p2 = Column(String(3), nullable=False)
    predicted_p3 = Column(String(3), nullable=False)
    points_awarded = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "year", "event_name", name="uq_user_year_event"),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_models.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && SECRET_KEY=test python -m pytest -q`
Expected: all tests pass (53 + 2 = 55)

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/models.py backend/app/tests/test_models.py
git commit -m "feat: add User and Prediction models"
```

---

### Task 2: Password hashing

**Files:**
- Create: `backend/app/services/auth_service.py`
- Modify: `backend/requirements.txt`
- Test: `backend/app/tests/test_auth_service.py` (new file)

**Interfaces:**
- Produces: `hash_password(password: str) -> str`, `verify_password(password: str, password_hash: str) -> bool`

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_auth_service.py
from app.services.auth_service import hash_password, verify_password


def test_hash_password_round_trips_with_verify():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong password", hashed) is False


def test_hash_password_uses_a_random_salt_each_time():
    hashed_a = hash_password("same password")
    hashed_b = hash_password("same password")
    assert hashed_a != hashed_b
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest app/tests/test_auth_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.auth_service'`

- [ ] **Step 3: Add dependencies and implement hashing**

In `backend/requirements.txt`, add:
```
bcrypt
PyJWT
```

Create `backend/app/services/auth_service.py`:

```python
import bcrypt


def hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
```

- [ ] **Step 4: Install and run tests to verify they pass**

Run: `cd backend && pip install bcrypt PyJWT && python -m pytest app/tests/test_auth_service.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/auth_service.py backend/app/tests/test_auth_service.py backend/requirements.txt
git commit -m "feat: add bcrypt password hashing"
```

---

### Task 3: JWT create/decode

**Files:**
- Modify: `backend/app/services/auth_service.py`
- Test: `backend/app/tests/test_auth_service.py`

**Interfaces:**
- Consumes: `settings.SECRET_KEY` (existing)
- Produces: `create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str`, `decode_access_token(token: str) -> Optional[int]`

- [ ] **Step 1: Write the failing tests**

```python
# Append to backend/app/tests/test_auth_service.py
from datetime import timedelta

from app.services.auth_service import create_access_token, decode_access_token


def test_create_and_decode_access_token_round_trips():
    token = create_access_token(user_id=42)
    assert decode_access_token(token) == 42


def test_decode_access_token_rejects_expired_token():
    token = create_access_token(user_id=42, expires_delta=timedelta(seconds=-1))
    assert decode_access_token(token) is None


def test_decode_access_token_rejects_malformed_token():
    assert decode_access_token("not.a.valid.jwt") is None


def test_decode_access_token_rejects_token_signed_with_a_different_key():
    import jwt as pyjwt
    bad_token = pyjwt.encode({"sub": "42"}, "wrong-secret", algorithm="HS256")
    assert decode_access_token(bad_token) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_auth_service.py -v -k access_token`
Expected: FAIL — `ImportError: cannot import name 'create_access_token'`

- [ ] **Step 3: Implement**

Add to `backend/app/services/auth_service.py`:

```python
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt

from app.core.config import settings

ALGORITHM = "HS256"
DEFAULT_EXPIRY = timedelta(days=7)


def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (expires_delta or DEFAULT_EXPIRY)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_auth_service.py -v`
Expected: PASS (7 tests total)

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && SECRET_KEY=test python -m pytest -q`
Expected: all tests pass (55 + 7 = 62, minus the 3 already counted in Task 2 -- 59 new total from Tasks 2+3, so 55 + 7 = 62)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/auth_service.py backend/app/tests/test_auth_service.py
git commit -m "feat: add JWT create/decode for auth sessions"
```

---

### Task 4: Auth endpoints, CSRF, and get_current_user

**Files:**
- Create: `backend/app/api/v1/auth_endpoints.py`
- Modify: `backend/app/main.py` (mount the new router)
- Test: `backend/app/tests/test_auth_endpoints.py` (new file)

**Interfaces:**
- Consumes: `auth_service.hash_password/verify_password/create_access_token/decode_access_token` (Tasks 2-3), `UserModel` (Task 1), `app.core.database.get_db`
- Produces: `get_current_user(request: Request, db: Session = Depends(get_db)) -> UserModel` (raises `HTTPException(401)`), `verify_csrf(request: Request) -> None` (raises `HTTPException(403)`) — both importable from `app.api.v1.auth_endpoints` for the predictions router (Task 6) to reuse.

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_auth_endpoints.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_auth_endpoints.py -v`
Expected: FAIL — 404s (router doesn't exist yet)

- [ ] **Step 3: Implement the router**

```python
# backend/app/api/v1/auth_endpoints.py
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import UserModel
from app.services.auth_service import create_access_token, decode_access_token, hash_password, verify_password

router = APIRouter()


class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    display_name: str


def _set_auth_cookies(response: Response, user_id: int) -> None:
    import os
    secure = os.getenv("RUNNING_LOCALLY") != "true"
    token = create_access_token(user_id=user_id)
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie("session", token, httponly=True, samesite="lax", secure=secure)
    response.set_cookie("csrf_token", csrf_token, httponly=False, samesite="lax", secure=secure)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> UserModel:
    token = request.cookies.get("session")
    user_id = decode_access_token(token) if token else None
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def verify_csrf(request: Request) -> None:
    cookie_value = request.cookies.get("csrf_token")
    header_value = request.headers.get("X-CSRF-Token")
    if not cookie_value or not header_value or cookie_value != header_value:
        raise HTTPException(status_code=403, detail="CSRF check failed")


@router.post("/auth/signup", response_model=UserResponse)
async def signup(req: SignupRequest, response: Response, db: Session = Depends(get_db)):
    existing = db.query(UserModel).filter(UserModel.email == req.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = UserModel(
        email=req.email,
        display_name=req.display_name,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _set_auth_cookies(response, user.id)
    return user


@router.post("/auth/login", response_model=UserResponse)
async def login(req: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.email == req.email).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    _set_auth_cookies(response, user.id)
    return user


@router.post("/auth/logout")
async def logout(response: Response, _current_user: UserModel = Depends(get_current_user), _csrf: None = Depends(verify_csrf)):
    response.delete_cookie("session")
    response.delete_cookie("csrf_token")
    return {"status": "logged out"}


@router.get("/auth/me", response_model=UserResponse)
async def me(current_user: UserModel = Depends(get_current_user)):
    return current_user
```

`_set_auth_cookies` computes `secure` itself via `os.getenv("RUNNING_LOCALLY")`, matching the pattern already used in `config.py`'s `DATABASE_URL`/`REDIS_CONNECTION_URL` properties.

- [ ] **Step 4: Mount the router in `main.py`**

In `backend/app/main.py`, alongside the existing `app.include_router(api_router, prefix="/api/v1")`:

```python
from app.api.v1.auth_endpoints import router as auth_router
...
app.include_router(auth_router, prefix="/api/v1")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_auth_endpoints.py -v`
Expected: PASS (8 tests). Fix forward on any cookie-domain/TestClient quirk (e.g., `TestClient` may need `follow_redirects`/cookie-jar behavior double-checked) rather than weakening the CSRF check to make a test pass.

- [ ] **Step 6: Run full backend suite and compile-check**

Run:
```bash
cd backend
SECRET_KEY=test python -m pytest -q
python -m py_compile app/api/v1/auth_endpoints.py app/main.py
SECRET_KEY=test RUNNING_LOCALLY=true python -c "from app.main import app; print('OK')"
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/v1/auth_endpoints.py backend/app/main.py backend/app/tests/test_auth_endpoints.py
git commit -m "feat: add signup/login/logout/me endpoints with CSRF-protected sessions"
```

---

## Checkpoint: security-review before continuing

**Do not proceed to Task 5 automatically.** Auth is done as of Task 4. Run this
session's `security-review` skill over the auth code specifically (models,
`auth_service.py`, `auth_endpoints.py`) before building the prediction game on
top of it. Report findings; fix anything real before continuing.

---

### Task 5: Prediction validation and scoring (pure functions)

**Files:**
- Create: `backend/app/services/predictions_service.py`
- Test: `backend/app/tests/test_predictions_service.py`

**Interfaces:**
- Produces:
  - `validate_prediction(predicted_p1: str, predicted_p2: str, predicted_p3: str) -> Optional[str]` (error message or `None`)
  - `race_has_started(event_schedule_row, now: datetime) -> bool` (pure, takes a pandas Series-like row, no FastF1 I/O)
  - `score_prediction(predicted: Tuple[str, str, str], actual_top3: Tuple[str, str, str]) -> int`

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_predictions_service.py
from datetime import datetime, timedelta

import pandas as pd
import pytest

from app.services.predictions_service import (
    race_has_started,
    score_prediction,
    validate_prediction,
)


def test_validate_prediction_accepts_three_distinct_known_codes():
    assert validate_prediction("VER", "NOR", "LEC") is None


def test_validate_prediction_rejects_unknown_code():
    error = validate_prediction("VER", "NOR", "ZZZ")
    assert error is not None


def test_validate_prediction_rejects_duplicate_codes():
    error = validate_prediction("VER", "VER", "LEC")
    assert error is not None
    assert "distinct" in error.lower()


def _schedule_row(session_name_col, session_date_col, date_value):
    row = {f"Session{i}": None for i in range(1, 6)}
    row.update({f"Session{i}Date": None for i in range(1, 6)})
    row[session_name_col] = "Race"
    row[session_date_col] = date_value
    return pd.Series(row)


def test_race_has_started_true_when_race_session_is_in_the_past():
    row = _schedule_row("Session5", "Session5Date", pd.Timestamp("2023-01-01", tz="UTC"))
    assert race_has_started(row, now=datetime(2024, 1, 1)) is True


def test_race_has_started_false_when_race_session_is_in_the_future():
    row = _schedule_row("Session5", "Session5Date", pd.Timestamp("2030-01-01", tz="UTC"))
    assert race_has_started(row, now=datetime(2024, 1, 1)) is False


def test_race_has_started_finds_race_session_even_when_not_session5():
    # Sprint weekend: Race is Session4, not Session5
    row = _schedule_row("Session4", "Session4Date", pd.Timestamp("2023-01-01", tz="UTC"))
    assert race_has_started(row, now=datetime(2024, 1, 1)) is True


def test_score_prediction_exact_match_scores_25():
    assert score_prediction(("VER", "NOR", "LEC"), ("VER", "NOR", "LEC")) == 25


def test_score_prediction_right_drivers_wrong_order_scores_partial():
    assert score_prediction(("NOR", "VER", "LEC"), ("VER", "NOR", "LEC")) == 30  # 10 each, 3 correct drivers


def test_score_prediction_one_correct_driver_scores_10():
    assert score_prediction(("VER", "HAM", "ALO"), ("VER", "NOR", "LEC")) == 10


def test_score_prediction_no_correct_drivers_scores_0():
    assert score_prediction(("HAM", "ALO", "GAS"), ("VER", "NOR", "LEC")) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest app/tests/test_predictions_service.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/services/predictions_service.py
from datetime import datetime
from typing import Optional, Tuple

import pandas as pd

from app.services.f1_data_service import FALLBACK_2024_DRIVERS

KNOWN_DRIVER_CODES = {d["code"] for d in FALLBACK_2024_DRIVERS}

EXACT_MATCH_POINTS = 25
PARTIAL_MATCH_POINTS_PER_DRIVER = 10


def validate_prediction(predicted_p1: str, predicted_p2: str, predicted_p3: str) -> Optional[str]:
    codes = [predicted_p1, predicted_p2, predicted_p3]
    for code in codes:
        if code.upper() not in KNOWN_DRIVER_CODES:
            return f"Unknown driver code '{code}'."
    if len(set(codes)) != 3:
        return "Predictions must name three distinct drivers."
    return None


def race_has_started(event_schedule_row: pd.Series, now: datetime) -> bool:
    for i in range(1, 6):
        if event_schedule_row.get(f"Session{i}") == "Race":
            race_date = event_schedule_row.get(f"Session{i}Date")
            if race_date is None or pd.isna(race_date):
                return False
            race_date_naive = pd.Timestamp(race_date).tz_localize(None)
            return race_date_naive <= pd.Timestamp(now)
    return False


def score_prediction(predicted: Tuple[str, str, str], actual_top3: Tuple[str, str, str]) -> int:
    if tuple(predicted) == tuple(actual_top3):
        return EXACT_MATCH_POINTS
    correct_drivers = set(predicted) & set(actual_top3)
    return len(correct_drivers) * PARTIAL_MATCH_POINTS_PER_DRIVER
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest app/tests/test_predictions_service.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && SECRET_KEY=test python -m pytest -q`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/predictions_service.py backend/app/tests/test_predictions_service.py
git commit -m "feat: add prediction validation and scoring (pure functions)"
```

---

### Task 6: Prediction endpoints

**Files:**
- Modify: `backend/app/api/v1/auth_endpoints.py` (add the predictions routes -- small enough not to warrant a third file yet, per the spec)
- Test: `backend/app/tests/test_predictions_endpoints.py`

**Interfaces:**
- Consumes: `get_current_user`, `verify_csrf` (Task 4), `predictions_service.*` (Task 5), `PredictionModel` (Task 1)
- Produces: `POST /predictions`, `GET /predictions/me`, `GET /leaderboard`, `POST /predictions/score`

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_predictions_endpoints.py
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _authed_client(email):
    c = TestClient(app)
    c.post("/api/v1/auth/signup", json={"email": email, "password": "some-password-1", "display_name": email.split("@")[0]})
    return c


def test_submit_prediction_requires_authentication():
    anon = TestClient(app)
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_predictions_endpoints.py -v`
Expected: FAIL — 404s

- [ ] **Step 3: Implement submission, listing, and the leaderboard**

Append to `backend/app/api/v1/auth_endpoints.py`:

```python
from datetime import datetime
from typing import List, Optional

from app.models.models import PredictionModel
from app.services import predictions_service


class PredictionRequest(BaseModel):
    year: int
    event_name: str
    predicted_p1: str
    predicted_p2: str
    predicted_p3: str


class PredictionResponse(BaseModel):
    id: int
    year: int
    event_name: str
    predicted_p1: str
    predicted_p2: str
    predicted_p3: str
    points_awarded: Optional[int]


class LeaderboardRow(BaseModel):
    display_name: str
    total_points: int


@router.post("/predictions", response_model=PredictionResponse)
async def submit_prediction(
    req: PredictionRequest,
    current_user: UserModel = Depends(get_current_user),
    _csrf: None = Depends(verify_csrf),
    db: Session = Depends(get_db),
):
    validation_error = predictions_service.validate_prediction(req.predicted_p1, req.predicted_p2, req.predicted_p3)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    import fastf1
    schedule = fastf1.get_event_schedule(req.year)
    matching = schedule[schedule["EventName"] == req.event_name]
    if not matching.empty and predictions_service.race_has_started(matching.iloc[0], datetime.utcnow()):
        raise HTTPException(status_code=400, detail="This race has already started -- predictions are locked.")

    existing = db.query(PredictionModel).filter(
        PredictionModel.user_id == current_user.id,
        PredictionModel.year == req.year,
        PredictionModel.event_name == req.event_name,
    ).first()

    if existing:
        existing.predicted_p1 = req.predicted_p1.upper()
        existing.predicted_p2 = req.predicted_p2.upper()
        existing.predicted_p3 = req.predicted_p3.upper()
        db.commit()
        db.refresh(existing)
        return existing

    prediction = PredictionModel(
        user_id=current_user.id, year=req.year, event_name=req.event_name,
        predicted_p1=req.predicted_p1.upper(), predicted_p2=req.predicted_p2.upper(), predicted_p3=req.predicted_p3.upper(),
    )
    db.add(prediction)
    db.commit()
    db.refresh(prediction)
    return prediction


@router.get("/predictions/me", response_model=List[PredictionResponse])
async def my_predictions(year: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(PredictionModel).filter(
        PredictionModel.user_id == current_user.id, PredictionModel.year == year,
    ).all()


@router.get("/leaderboard", response_model=List[LeaderboardRow])
async def leaderboard(year: int, db: Session = Depends(get_db)):
    from sqlalchemy import func as sa_func

    rows = (
        db.query(UserModel.display_name, sa_func.sum(PredictionModel.points_awarded).label("total_points"))
        .join(PredictionModel, PredictionModel.user_id == UserModel.id)
        .filter(PredictionModel.year == year, PredictionModel.points_awarded.isnot(None))
        .group_by(UserModel.id)
        .order_by(sa_func.sum(PredictionModel.points_awarded).desc())
        .all()
    )
    return [{"display_name": r[0], "total_points": r[1]} for r in rows]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_predictions_endpoints.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for real-result scoring**

FastF1's `session.results` (confirmed available: `Position` as a float,
`Abbreviation` as the driver code) is the real per-race classification —
`f1_data_service.py` has no per-race accessor today, so `/predictions/score`
calls FastF1 directly, the same way `strategy_simulator`'s endpoint does.

```python
# Append to backend/app/tests/test_predictions_endpoints.py
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
```

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_predictions_endpoints.py -v -k score_race`
Expected: FAIL — 404 (`/predictions/score` doesn't exist yet)

- [ ] **Step 6: Implement `/predictions/score`**

Append to `backend/app/api/v1/auth_endpoints.py`:

```python
class ScoreRequest(BaseModel):
    year: int
    event_name: str


@router.post("/predictions/score")
async def score_race(req: ScoreRequest, db: Session = Depends(get_db)):
    import asyncio
    import fastf1

    def _get_real_top3():
        session = fastf1.get_session(req.year, req.event_name, "Race")
        session.load(laps=False, telemetry=False, weather=False)
        results = session.results.sort_values("Position")
        if len(results) < 3:
            return None
        top3 = results.iloc[:3]["Abbreviation"].tolist()
        return tuple(top3)

    actual_top3 = await asyncio.to_thread(_get_real_top3)
    if actual_top3 is None:
        raise HTTPException(status_code=400, detail="No result available for this race yet.")

    predictions = db.query(PredictionModel).filter(
        PredictionModel.year == req.year, PredictionModel.event_name == req.event_name,
    ).all()
    for prediction in predictions:
        predicted = (prediction.predicted_p1, prediction.predicted_p2, prediction.predicted_p3)
        prediction.points_awarded = predictions_service.score_prediction(predicted, actual_top3)
    db.commit()

    return {"scored_predictions": len(predictions)}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_predictions_endpoints.py -v`
Expected: PASS (5 tests). This hits real FastF1 data for 2023 Spa — already
cached on disk from earlier phases' tests in this session, so it should be fast;
on a machine without that cache it does one real network fetch.

- [ ] **Step 8: Run full backend suite and compile-check**

Run:
```bash
cd backend
SECRET_KEY=test python -m pytest -q
python -m py_compile app/api/v1/auth_endpoints.py
SECRET_KEY=test RUNNING_LOCALLY=true python -c "from app.main import app; print('OK')"
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/api/v1/auth_endpoints.py backend/app/tests/test_predictions_endpoints.py
git commit -m "feat: add prediction submission, leaderboard, and real-result scoring"
```

---

### Task 7: Frontend auth (login/signup, store, axios wiring)

**Files:**
- Modify: `frontend/src/components/AppInitializer.tsx` (axios `withCredentials` + CSRF interceptor, fetch `/auth/me` on load)
- Modify: `frontend/src/store/useTelemetryStore.ts` (add `currentUser` state)
- Create: `frontend/src/app/login/page.tsx`

**Interfaces:**
- Consumes: `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (Task 4)
- No automated test (matches this session's established precedent for frontend UI: `tsc --noEmit` + `next build` + manual browser check)

- [ ] **Step 1: Store slice**

In `useTelemetryStore.ts`, add:

```typescript
export interface CurrentUser {
  id: number;
  email: string;
  display_name: string;
}
```
and to the store: `currentUser: CurrentUser | null`, `setCurrentUser: (user: CurrentUser | null) => void`.

- [ ] **Step 2: Axios credentials + CSRF interceptor + `/auth/me` fetch**

In `AppInitializer.tsx`, alongside the existing `axios.defaults.baseURL = ...` line:

```typescript
axios.defaults.withCredentials = true;

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

axios.interceptors.request.use((config) => {
  if (["post", "put", "delete", "patch"].includes((config.method || "").toLowerCase())) {
    const csrfToken = getCookie("csrf_token");
    if (csrfToken) {
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return config;
});
```

In the component's initial-sync `useEffect`, add a fetch of `/api/v1/auth/me` that calls `setCurrentUser(res.data)` on success and `setCurrentUser(null)` on 401 (a 401 here is an expected "not logged in" state, not an error to log).

- [ ] **Step 3: Login/signup page**

```tsx
// frontend/src/app/login/page.tsx
"use client";

import React, { useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { LogIn, UserPlus } from "lucide-react";
import { useF1Store } from "@/store/useTelemetryStore";

export default function LoginPage() {
  const router = useRouter();
  const setCurrentUser = useF1Store((s) => s.setCurrentUser);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const endpoint = mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/signup";
      const payload = mode === "login" ? { email, password } : { email, password, display_name: displayName };
      const res = await axios.post(endpoint, payload);
      setCurrentUser(res.data);
      router.push("/predictions");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-md mx-auto space-y-8 animate-fade-in">
      <h1 className="text-3xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
        {mode === "login" ? <LogIn className="w-7 h-7 text-f1-red" /> : <UserPlus className="w-7 h-7 text-f1-red" />}
        {mode === "login" ? "Log In" : "Sign Up"}
      </h1>

      <form onSubmit={submit} className="glass-panel p-6 rounded-xl border border-white/5 space-y-4">
        {mode === "signup" && (
          <input
            type="text" placeholder="Display name" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)} required
            className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium"
          />
        )}
        <input
          type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required
          className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium"
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} required
          className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium"
        />
        {error && <p className="text-red-400 text-sm font-titillium">{error}</p>}
        <button
          type="submit" disabled={loading}
          className="w-full bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2.5 rounded-md transition-colors disabled:opacity-40"
        >
          {mode === "login" ? "Log In" : "Sign Up"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="w-full text-white/50 hover:text-white text-sm font-titillium"
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Type-check and build**

Run:
```bash
cd frontend
npx tsc --noEmit
npx next build
```

- [ ] **Step 5: Manual browser check**

Start the dev server and the backend together (matching this session's Phase 5
precedent). Sign up a new account, confirm redirect to `/predictions` (a 404
until Task 8 -- that's expected at this point), confirm `document.cookie` shows
`csrf_token` but the session cookie is not readable from `document.cookie`
(proving `httponly` actually took effect). Log out via a manual `axios.post`
in the browser console if no logout button exists yet, confirm `/auth/me`
then 401s.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AppInitializer.tsx frontend/src/store/useTelemetryStore.ts frontend/src/app/login/
git commit -m "feat: add frontend login/signup and CSRF-aware axios config"
```

---

### Task 8: Frontend predictions + leaderboard page

**Files:**
- Create: `frontend/src/app/predictions/page.tsx`
- Modify: `frontend/src/components/NavigationBar.tsx` (nav link)

**Interfaces:**
- Consumes: `POST /predictions`, `GET /predictions/me`, `GET /leaderboard` (Task 6), `currentUser` (Task 7)

- [ ] **Step 1: Build the page**

A form (three driver-code selects, reusing the `/drivers/known-codes` endpoint
for the option list the same way `strategy/page.tsx` already does) gated on
`currentUser` from the store (if null, show a "log in to predict" prompt
linking to `/login`), plus a leaderboard table for the selected year fetched
from `/leaderboard`.

- [ ] **Step 2: Nav link**

Add a "Predictions" entry to `NavigationBar.tsx`'s `navLinks`, matching the
existing pattern.

- [ ] **Step 3: Type-check, build, manual browser check**

Run `npx tsc --noEmit && npx next build`, then in-browser: submit a prediction
while logged in, confirm it appears via `/predictions/me`, confirm the
leaderboard renders (even if empty/zero until a race has been scored).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/predictions/ frontend/src/components/NavigationBar.tsx
git commit -m "feat: add predictions page and leaderboard"
```

---

## Final checkpoint

After Task 8: run the full backend suite, `tsc --noEmit`, `next build` one
more time together, and re-confirm the security-review findings from the
Task 4 checkpoint were actually addressed (not just noted).
