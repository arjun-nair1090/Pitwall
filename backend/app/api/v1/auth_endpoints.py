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
from app.models.models import PredictionModel, UserModel
from app.services import predictions_service
from app.services.auth_service import (
    DEFAULT_EXPIRY,
    MAX_PASSWORD_BYTES,
    create_access_token,
    decode_access_token,
    get_token_jti,
    hash_password,
    is_token_revoked,
    revoke_token,
    verify_password,
)

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
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        # bcrypt's limit is 72 *bytes*, not characters.
        if len(v.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes long (some characters use more than one byte)")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str = Field(max_length=1024)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return _normalize_email(v)


class UserResponse(BaseModel):
    id: int
    email: str
    display_name: str
    model_config = ConfigDict(from_attributes=True)


@functools.lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    return hash_password("timing-equalisation-only-not-a-real-password")


def _set_auth_cookies(response: Response, user_id: int) -> None:
    secure = os.getenv("RUNNING_LOCALLY") != "true"
    token = create_access_token(user_id=user_id)
    csrf_token = secrets.token_urlsafe(32)
    # Same lifetime as the token itself, so the browser drops the cookies exactly
    # when the server would reject them (and they survive a browser restart).
    max_age = int(DEFAULT_EXPIRY.total_seconds())
    response.set_cookie("session", token, max_age=max_age, httponly=True, samesite="lax", secure=secure)
    response.set_cookie("csrf_token", csrf_token, max_age=max_age, httponly=False, samesite="lax", secure=secure)


async def get_current_user(request: Request, db: Session = Depends(get_db)) -> UserModel:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = decode_access_token(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    jti = get_token_jti(token)
    if jti and await is_token_revoked(jti):
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


@router.post("/auth/signup", response_model=UserResponse, dependencies=[Depends(verify_origin)])
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


@router.post("/auth/login", response_model=UserResponse, dependencies=[Depends(verify_origin)])
async def login(req: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.email == req.email).first()
    # Always run a real bcrypt comparison -- against a throwaway hash when the
    # email is unknown -- so response time doesn't reveal which emails exist.
    password_ok = verify_password(req.password, user.password_hash if user else _dummy_password_hash())
    if not user or not password_ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    _set_auth_cookies(response, user.id)
    return user


@router.post("/auth/logout")
async def logout(
    request: Request,
    response: Response,
    _current_user: UserModel = Depends(get_current_user),
    _csrf: None = Depends(verify_csrf),
):
    token = request.cookies.get("session")
    if token:
        jti = get_token_jti(token)
        if jti:
            await revoke_token(jti, ttl_seconds=int(DEFAULT_EXPIRY.total_seconds()))
    response.delete_cookie("session")
    response.delete_cookie("csrf_token")
    return {"status": "logged out"}


@router.get("/auth/me", response_model=UserResponse)
async def me(current_user: UserModel = Depends(get_current_user)):
    return current_user


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


@router.post("/predictions/score")
async def score_race(req: ScoreRequest, db: Session = Depends(get_db)):
    """Recompute points for one race from the official result.

    Deliberately unauthenticated: points are a pure function of the official
    result and each user's already-locked pick, so calling it early, late or
    repeatedly can't change any outcome -- but it does refuse to run until the
    race has started and a *final* classification exists."""
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
