import os
import secrets
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.models import PredictionModel, UserModel
from app.services import predictions_service
from app.services.auth_service import (
    DEFAULT_EXPIRY,
    create_access_token,
    decode_access_token,
    get_token_jti,
    hash_password,
    is_token_revoked,
    revoke_token,
    verify_password,
)

router = APIRouter()


class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if len(v) > 72:
            raise ValueError("Password must be at most 72 characters long")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    display_name: str
    model_config = ConfigDict(from_attributes=True)


def _set_auth_cookies(response: Response, user_id: int) -> None:
    secure = os.getenv("RUNNING_LOCALLY") != "true"
    token = create_access_token(user_id=user_id)
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie("session", token, httponly=True, samesite="lax", secure=secure)
    response.set_cookie("csrf_token", csrf_token, httponly=False, samesite="lax", secure=secure)


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
    if not user or not verify_password(req.password, user.password_hash):
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
    model_config = ConfigDict(from_attributes=True)


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
