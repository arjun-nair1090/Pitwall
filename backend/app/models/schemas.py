from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List

class SessionBase(BaseModel):
    session_key: int
    year: int
    location: str
    country: str
    circuit_name: str
    circuit_short_name: str
    session_name: str
    date_start: datetime
    date_end: datetime

class SessionCreate(SessionBase):
    pass

class Session(SessionBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class DriverBase(BaseModel):
    driver_number: int
    code: str
    first_name: str
    last_name: str
    full_name: str
    team_name: str
    team_color: str
    country_code: str

class DriverCreate(DriverBase):
    pass

class Driver(DriverBase):
    model_config = ConfigDict(from_attributes=True)

class LapBase(BaseModel):
    session_key: int
    driver_number: int
    lap_number: int
    lap_time: Optional[float] = None
    sector1: Optional[float] = None
    sector2: Optional[float] = None
    sector3: Optional[float] = None
    compound: Optional[str] = None
    tyre_age: Optional[int] = None
    pit_out_time: Optional[float] = None
    pit_in_time: Optional[float] = None
    is_pit_stop: bool = False

class LapCreate(LapBase):
    pass

class Lap(LapBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class TeamRadioBase(BaseModel):
    session_key: int
    driver_number: int
    timestamp: datetime
    transcript: str
    recording_url: Optional[str] = None

class TeamRadioCreate(TeamRadioBase):
    pass

class TeamRadio(TeamRadioBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class TelemetryData(BaseModel):
    driver_number: int
    code: str
    timestamp: datetime
    speed: float
    throttle: float
    brake: float
    gear: int
    rpm: int
    drs: int
    x: float
    y: float
    z: float
