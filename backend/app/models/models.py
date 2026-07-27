from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, UniqueConstraint
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

class LapModel(Base):
    __tablename__ = "laps"

    id = Column(Integer, primary_key=True, index=True)
    session_key = Column(Integer, ForeignKey("sessions.session_key", ondelete="CASCADE"), nullable=False)
    driver_number = Column(Integer, nullable=False)
    lap_number = Column(Integer, nullable=False)
    lap_time = Column(Float, nullable=True)
    sector1 = Column(Float, nullable=True)
    sector2 = Column(Float, nullable=True)
    sector3 = Column(Float, nullable=True)
    compound = Column(String(20), nullable=True)
    tyre_age = Column(Integer, nullable=True)
    pit_out_time = Column(Float, nullable=True)
    pit_in_time = Column(Float, nullable=True)
    is_pit_stop = Column(Boolean, default=False)

    __table_args__ = (
        UniqueConstraint("session_key", "driver_number", "lap_number", name="uq_session_driver_lap"),
    )

class TeamRadioModel(Base):
    __tablename__ = "team_radios"

    id = Column(Integer, primary_key=True, index=True)
    session_key = Column(Integer, ForeignKey("sessions.session_key", ondelete="CASCADE"), nullable=False)
    driver_number = Column(Integer, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    transcript = Column(String, nullable=False)
    recording_url = Column(String(500), nullable=True)
