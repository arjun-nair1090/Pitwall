import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
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
    model_config = ConfigDict(from_attributes=True)


def _set_auth_cookies(response: Response, user_id: int) -> None:
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
async def logout(
    response: Response,
    _current_user: UserModel = Depends(get_current_user),
    _csrf: None = Depends(verify_csrf),
):
    response.delete_cookie("session")
    response.delete_cookie("csrf_token")
    return {"status": "logged out"}


@router.get("/auth/me", response_model=UserResponse)
async def me(current_user: UserModel = Depends(get_current_user)):
    return current_user
