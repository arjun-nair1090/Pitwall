from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base

class SessionModel(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_key = Column(Integer, unique=True, nullable=False, index=True)
    year = Column(Integer, nullable=False)
    location = Column(String(100), nullable=False)
    country = Column(String(100), nullable=False)
    circuit_name = Column(String(200), nullable=False)
    circuit_short_name = Column(String(50), nullable=False)
    session_name = Column(String(100), nullable=False)
    date_start = Column(DateTime(timezone=True), nullable=False)
    date_end = Column(DateTime(timezone=True), nullable=False)

class DriverModel(Base):
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, index=True)
    session_key = Column(Integer, ForeignKey("sessions.session_key", ondelete="CASCADE"), nullable=False)
    driver_number = Column(Integer, nullable=False, index=True)
    code = Column(String(3), nullable=False, index=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    full_name = Column(String(200), nullable=False)
    team_name = Column(String(100), nullable=False)
    team_color = Column(String(10), nullable=False)
    country_code = Column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("session_key", "driver_number", name="uq_driver_session"),
    )

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
