import asyncio
import functools
import os
import re
import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func as sa_func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.models import PredictionModel, SessionModel, UserModel
from app.services import auth_service, predictions_service
from app.services.auth_service import MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, hash_password, verify_password

router = APIRouter()

# Plausible F1 seasons; rejects garbage before it reaches FastF1 or the database.
MIN_YEAR = 1950
MAX_YEAR = 2100


# Deliberately simple: one "@", no whitespace, a dot in the domain. Real
# deliverability can only be proven by sending mail (an email-verification flow
# is a documented non-goal), so this only catches typos and junk.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_EMAIL_LENGTH = 254
MAX_DISPLAY_NAME_LENGTH = 50  # matches UserModel.display_name (String(50))


def _normalize_email(value: str) -> str:
    # Emails are case-insensitive in practice; store and compare one canonical
    # form so "A@x.com" and "a@x.com" can't become two accounts.
    return value.strip().lower()


def _check_password_length(v: str) -> str:
    if len(v) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters long")
    # bcrypt's limit is 72 *bytes*, not characters.
    if len(v.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes long (some characters use more than one byte)")
    return v


async def _refuse_breached(password: str) -> None:
    if await auth_service.password_is_breached(password):
        raise HTTPException(status_code=400, detail="That password has appeared in a data breach. Choose a different one.")


class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str

    @field_validator("email")
    @classmethod
    def valid_email(cls, v: str) -> str:
        v = _normalize_email(v)
        if len(v) > MAX_EMAIL_LENGTH or not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("display_name")
    @classmethod
    def valid_display_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Display name can't be empty")
        if len(v) > MAX_DISPLAY_NAME_LENGTH:
            raise ValueError(f"Display name must be at most {MAX_DISPLAY_NAME_LENGTH} characters long")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        return _check_password_length(v)


class LoginRequest(BaseModel):
    email: str
    password: str = Field(max_length=1024)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return _normalize_email(v)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_length(cls, v: str) -> str:
        return _check_password_length(v)


class SessionResponse(BaseModel):
    id: int
    created_at: datetime
    last_seen_at: datetime
    user_agent: str
    ip: str
    current: bool


class UserResponse(BaseModel):
    id: int
    email: str
    display_name: str
    model_config = ConfigDict(from_attributes=True)


@functools.lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    return hash_password("timing-equalisation-only-not-a-real-password")


def _start_session(request: Request, response: Response, db: Session, user_id: int) -> None:
    """Signs this browser in: a new session (never a reused one) and its cookies."""
    secure = os.getenv("RUNNING_LOCALLY") != "true"
    token = auth_service.create_session(db, user_id, user_agent=request.headers.get("user-agent", ""),
                                        ip=request.client.host if request.client else "")
    # The session's longest life; the server ends it sooner if it sits unused.
    max_age = int(auth_service.SESSION_LIFETIME.total_seconds())
    response.set_cookie("session", token, max_age=max_age, httponly=True, samesite="lax", secure=secure)
    response.set_cookie("csrf_token", secrets.token_urlsafe(32), max_age=max_age, httponly=False, samesite="lax", secure=secure)


def current_session(request: Request, db: Session = Depends(get_db)) -> SessionModel:
    token = request.cookies.get("session")
    session = auth_service.find_session(db, token) if token else None
    if session is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return session


async def get_current_user(session: SessionModel = Depends(current_session), db: Session = Depends(get_db)) -> UserModel:
    user = db.query(UserModel).filter(UserModel.id == session.user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def verify_csrf(request: Request) -> None:
    cookie_value = request.cookies.get("csrf_token")
    header_value = request.headers.get("X-CSRF-Token")
    if not cookie_value or not header_value or not secrets.compare_digest(cookie_value, header_value):
        raise HTTPException(status_code=403, detail="CSRF check failed")


def verify_origin(request: Request) -> None:
    """Blocks cross-site form-POST login/signup CSRF: the double-submit CSRF
    cookie can't be used for these two routes (no CSRF cookie exists yet
    pre-login), so this checks the Origin (falling back to Referer) header
    against the configured allow-list instead."""
    origin = request.headers.get("origin")
    if not origin:
        referer = request.headers.get("referer")
        origin = referer.rstrip("/") if referer else None
        if origin:
            # Referer is a full URL; reduce to scheme+host for comparison.
            from urllib.parse import urlparse
            parsed = urlparse(origin)
            origin = f"{parsed.scheme}://{parsed.netloc}"
    if not origin or origin not in settings.CORS_ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="Request origin not allowed")


@router.post("/auth/signup", response_model=UserResponse, dependencies=[Depends(verify_origin), Depends(rate_limit("signup", 5, 3600))])
async def signup(req: SignupRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    existing = db.query(UserModel).filter(UserModel.email == req.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    await _refuse_breached(req.password)

    user = UserModel(
        email=req.email,
        display_name=req.display_name,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _start_session(request, response, db, user.id)
    return user


@router.post("/auth/login", response_model=UserResponse, dependencies=[Depends(verify_origin), Depends(rate_limit("login", 10, 900))])
async def login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else ""
    locked = auth_service.seconds_locked(req.email, ip)
    if locked:
        raise HTTPException(
            status_code=429,
            detail=f"Too many wrong passwords for this account. Try again in {max(1, round(locked / 60))} min.",
            headers={"Retry-After": str(locked)},
        )
    user = db.query(UserModel).filter(UserModel.email == req.email).first()
    # Always run a real bcrypt comparison -- against a throwaway hash when the
    # email is unknown -- so response time doesn't reveal which emails exist.
    password_ok = verify_password(req.password, user.password_hash if user else _dummy_password_hash())
    if not user or not password_ok:
        auth_service.record_failure(req.email, ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    auth_service.clear_failures(req.email, ip)
    _start_session(request, response, db, user.id)
    return user


@router.post("/auth/logout")
async def logout(
    request: Request,
    response: Response,
    _session: SessionModel = Depends(current_session),
    _csrf: None = Depends(verify_csrf),
    db: Session = Depends(get_db),
):
    auth_service.end_session(db, request.cookies["session"])
    response.delete_cookie("session")
    response.delete_cookie("csrf_token")
    return {"status": "logged out"}


@router.get("/auth/me", response_model=UserResponse)
async def me(current_user: UserModel = Depends(get_current_user)):
    return current_user


@router.get("/auth/sessions", response_model=List[SessionResponse])
async def list_sessions(session: SessionModel = Depends(current_session), db: Session = Depends(get_db)):
    """The browsers signed in to this account, most recently used first."""
    return [SessionResponse(id=s.id, created_at=s.created_at, last_seen_at=s.last_seen_at, user_agent=s.user_agent,
                            ip=s.ip, current=s.id == session.id)
            for s in auth_service.user_sessions(db, session.user_id)]


@router.delete("/auth/sessions/{session_id}")
async def sign_out_device(session_id: int, session: SessionModel = Depends(current_session),
                          _csrf: None = Depends(verify_csrf), db: Session = Depends(get_db)):
    deleted = db.query(SessionModel).filter(SessionModel.id == session_id, SessionModel.user_id == session.user_id).delete()
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="No such signed-in device")
    return {"status": "signed out"}


@router.post("/auth/sessions/sign-out-others")
async def sign_out_other_devices(session: SessionModel = Depends(current_session),
                                 _csrf: None = Depends(verify_csrf), db: Session = Depends(get_db)):
    auth_service.end_other_sessions(db, session.user_id, keep_id=session.id)
    return {"status": "signed out"}


@router.post("/auth/password", dependencies=[Depends(rate_limit("password", 10, 3600))])
async def change_password(req: PasswordChangeRequest, session: SessionModel = Depends(current_session),
                          _csrf: None = Depends(verify_csrf), db: Session = Depends(get_db)):
    """Changes the password and signs out every other device, in case someone else had it."""
    user = db.query(UserModel).filter(UserModel.id == session.user_id).first()
    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    await _refuse_breached(req.new_password)
    user.password_hash = hash_password(req.new_password)
    db.commit()
    auth_service.end_other_sessions(db, user.id, keep_id=session.id)
    return {"status": "password changed"}


class PredictionRequest(BaseModel):
    year: int = Field(ge=MIN_YEAR, le=MAX_YEAR)
    event_name: str = Field(min_length=1, max_length=200)
    predicted_p1: str = Field(max_length=10)
    predicted_p2: str = Field(max_length=10)
    predicted_p3: str = Field(max_length=10)


class PredictionResponse(BaseModel):
    id: int
    year: int
    event_name: str
    predicted_p1: str
    predicted_p2: str
    predicted_p3: str
    points_awarded: Optional[int]
    model_config = ConfigDict(from_attributes=True)


class LeaderboardRow(BaseModel):
    display_name: str
    total_points: int


def _utc_now() -> datetime:
    """Naive UTC "now" (datetime.utcnow() is deprecated)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _load_event(year: int, event_name: str):
    """The exact-match schedule row for a race, or an HTTP error.

    Fails closed: if the schedule can't be loaded we refuse (503) rather than
    skip the race-start lock."""
    try:
        event = await asyncio.to_thread(predictions_service.find_event, year, event_name)
    except Exception:
        raise HTTPException(status_code=503, detail="The race schedule is unavailable right now. Please try again shortly.")
    if event is None:
        raise HTTPException(status_code=400, detail=f"Unknown event '{event_name}' for {year}.")
    if predictions_service.race_start_utc(event) is None:
        raise HTTPException(status_code=400, detail="This event has no scheduled race to predict.")
    return event


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

    event = await _load_event(req.year, req.event_name)
    if predictions_service.race_has_started(event, _utc_now()):
        raise HTTPException(status_code=400, detail="This race has already started -- predictions are locked.")

    p1, p2, p3 = (predictions_service.normalize_code(c) for c in (req.predicted_p1, req.predicted_p2, req.predicted_p3))

    def _find_existing():
        return db.query(PredictionModel).filter(
            PredictionModel.user_id == current_user.id,
            PredictionModel.year == req.year,
            PredictionModel.event_name == req.event_name,
        ).first()

    prediction = _find_existing()
    if prediction is None:
        prediction = PredictionModel(user_id=current_user.id, year=req.year, event_name=req.event_name)
        db.add(prediction)
    prediction.predicted_p1, prediction.predicted_p2, prediction.predicted_p3 = p1, p2, p3

    try:
        db.commit()
    except IntegrityError:
        # Two simultaneous submissions from the same user both saw "no existing
        # row"; the unique constraint caught the second. Fold it into an update.
        db.rollback()
        prediction = _find_existing()
        if prediction is None:
            raise HTTPException(status_code=409, detail="Could not save your prediction. Please try again.")
        prediction.predicted_p1, prediction.predicted_p2, prediction.predicted_p3 = p1, p2, p3
        db.commit()

    db.refresh(prediction)
    return prediction


@router.get("/predictions/me", response_model=List[PredictionResponse])
async def my_predictions(
    year: int = Query(ge=MIN_YEAR, le=MAX_YEAR),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(PredictionModel)
        .filter(PredictionModel.user_id == current_user.id, PredictionModel.year == year)
        .order_by(PredictionModel.id)
        .all()
    )


@router.get("/leaderboard", response_model=List[LeaderboardRow])
async def leaderboard(year: int = Query(ge=MIN_YEAR, le=MAX_YEAR), db: Session = Depends(get_db)):
    total = sa_func.sum(PredictionModel.points_awarded)
    rows = (
        db.query(UserModel.display_name, total.label("total_points"))
        .join(PredictionModel, PredictionModel.user_id == UserModel.id)
        .filter(PredictionModel.year == year, PredictionModel.points_awarded.isnot(None))
        .group_by(UserModel.id, UserModel.display_name)
        # Ties break alphabetically so the board never reshuffles between requests.
        .order_by(total.desc(), UserModel.display_name.asc())
        .all()
    )
    return [{"display_name": r[0], "total_points": int(r[1])} for r in rows]


class ScoreRequest(BaseModel):
    year: int = Field(ge=MIN_YEAR, le=MAX_YEAR)
    event_name: str = Field(min_length=1, max_length=200)


@router.post("/predictions/score", dependencies=[Depends(rate_limit("score", 10, 3600))])
async def score_race(req: ScoreRequest, db: Session = Depends(get_db)):
    """Recompute points for one race from the official result.

    Deliberately unauthenticated: points are a pure function of the official
    result and each user's already-locked pick, so calling it early, late or
    repeatedly can't change any outcome -- but it does refuse to run until the
    race has started and a *final* classification exists. Rate limited, since
    each call fetches the result and rewrites every user's points."""
    event = await _load_event(req.year, req.event_name)
    if not predictions_service.race_has_started(event, _utc_now()):
        raise HTTPException(status_code=400, detail="This race hasn't started yet -- nothing to score.")

    try:
        actual_top3 = await asyncio.to_thread(predictions_service.fetch_actual_top3, req.year, req.event_name)
    except Exception:
        raise HTTPException(status_code=503, detail="Couldn't fetch the official result right now. Please try again shortly.")
    if actual_top3 is None:
        raise HTTPException(status_code=400, detail="No final official result is available for this race yet.")

    predictions = db.query(PredictionModel).filter(
        PredictionModel.year == req.year, PredictionModel.event_name == req.event_name,
    ).all()
    for prediction in predictions:
        predicted = (prediction.predicted_p1, prediction.predicted_p2, prediction.predicted_p3)
        prediction.points_awarded = predictions_service.score_prediction(predicted, actual_top3)
    db.commit()

    return {"scored_predictions": len(predictions)}
