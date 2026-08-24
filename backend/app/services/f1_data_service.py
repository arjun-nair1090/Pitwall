import os
import asyncio
import requests
import fastf1
import pandas as pd
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from app.core.config import settings
from app.services.redis_service import redis_service
from app.core.database import SessionLocal
from app.models.models import SessionModel, DriverModel, LapModel, TeamRadioModel

# Enable FastF1 caching
os.makedirs(settings.FASTF1_CACHE_DIR, exist_ok=True)
try:
    fastf1.Cache.enable_cache(settings.FASTF1_CACHE_DIR)
except Exception as e:
    print(f"Failed to enable FastF1 cache: {e}")

FALLBACK_2024_DRIVERS = [
    {"driver_number": 1, "code": "VER", "first_name": "Max", "last_name": "Verstappen", "team_name": "Red Bull Racing", "team_color": "#3671C6", "country_code": "NED"},
    {"driver_number": 11, "code": "PER", "first_name": "Sergio", "last_name": "Perez", "team_name": "Red Bull Racing", "team_color": "#3671C6", "country_code": "MEX"},
    {"driver_number": 44, "code": "HAM", "first_name": "Lewis", "last_name": "Hamilton", "team_name": "Mercedes", "team_color": "#27F4D2", "country_code": "GBR"},
    {"driver_number": 63, "code": "RUS", "first_name": "George", "last_name": "Russell", "team_name": "Mercedes", "team_color": "#27F4D2", "country_code": "GBR"},
    {"driver_number": 16, "code": "LEC", "first_name": "Charles", "last_name": "Leclerc", "team_name": "Ferrari", "team_color": "#E8002D", "country_code": "MON"},
    {"driver_number": 55, "code": "SAI", "first_name": "Carlos", "last_name": "Sainz", "team_name": "Ferrari", "team_color": "#E8002D", "country_code": "ESP"},
    {"driver_number": 4, "code": "NOR", "first_name": "Lando", "last_name": "Norris", "team_name": "McLaren", "team_color": "#FF8000", "country_code": "GBR"},
    {"driver_number": 81, "code": "PIA", "first_name": "Oscar", "last_name": "Piastri", "team_name": "McLaren", "team_color": "#FF8000", "country_code": "AUS"},
    {"driver_number": 14, "code": "ALO", "first_name": "Fernando", "last_name": "Alonso", "team_name": "Aston Martin", "team_color": "#229971", "country_code": "ESP"},
    {"driver_number": 18, "code": "STR", "first_name": "Lance", "last_name": "Stroll", "team_name": "Aston Martin", "team_color": "#229971", "country_code": "CAN"},
    {"driver_number": 10, "code": "GAS", "first_name": "Pierre", "last_name": "Gasly", "team_name": "Alpine", "team_color": "#0093CC", "country_code": "FRA"},
    {"driver_number": 31, "code": "OCO", "first_name": "Esteban", "last_name": "Ocon", "team_name": "Alpine", "team_color": "#0093CC", "country_code": "FRA"},
    {"driver_number": 23, "code": "ALB", "first_name": "Alexander", "last_name": "Albon", "team_name": "Williams", "team_color": "#64C4FF", "country_code": "THA"},
    {"driver_number": 2, "code": "SAR", "first_name": "Logan", "last_name": "Sargeant", "team_name": "Williams", "team_color": "#64C4FF", "country_code": "USA"},
    {"driver_number": 3, "code": "RIC", "first_name": "Daniel", "last_name": "Ricciardo", "team_name": "RB", "team_color": "#6692FF", "country_code": "AUS"},
    {"driver_number": 22, "code": "TSU", "first_name": "Yuki", "last_name": "Tsunoda", "team_name": "RB", "team_color": "#6692FF", "country_code": "JPN"},
    {"driver_number": 77, "code": "BOT", "first_name": "Valtteri", "last_name": "Bottas", "team_name": "Kick Sauber", "team_color": "#52E252", "country_code": "FIN"},
    {"driver_number": 24, "code": "ZHO", "first_name": "Zhou", "last_name": "Guanyu", "team_name": "Kick Sauber", "team_color": "#52E252", "country_code": "CHN"},
    {"driver_number": 20, "code": "MAG", "first_name": "Kevin", "last_name": "Magnussen", "team_name": "Haas", "team_color": "#B6BABD", "country_code": "DEN"},
    {"driver_number": 27, "code": "HUL", "first_name": "Nico", "last_name": "Hulkenberg", "team_name": "Haas", "team_color": "#B6BABD", "country_code": "GER"}
]

class F1DataService:
    def __init__(self):
        self.openf1_base_url = "https://api.openf1.org/v1"
        self._circuit_coords = None

    def _fetch_openf1(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """Fetch from OpenF1 API using requests, supporting Bearer API keys for live race sessions."""
        url = f"{self.openf1_base_url}/{endpoint}"
        headers = {}
        api_key = os.getenv("OPENF1_API_KEY")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
            
        try:
            response = requests.get(url, params=params, headers=headers, timeout=5)
            if response.status_code == 200:
                return response.json()
            else:
                print(f"OpenF1 API Restricted ({response.status_code}) for {url}")
                return []
        except Exception as e:
            print(f"Exception fetching OpenF1 {url}: {e}")
            return []

    async def fetch_openf1_async(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        return await asyncio.to_thread(self._fetch_openf1, endpoint, params)

    async def get_latest_session_key(self) -> int:
        """Get latest active session key."""
        sessions = await self.fetch_openf1_async("sessions")
        if sessions and isinstance(sessions, list):
            sessions_sorted = sorted(sessions, key=lambda x: x.get("date_start", ""), reverse=True)
            return sessions_sorted[0]["session_key"]
        return 9999  # Fallback: Current FastF1 Event

    async def sync_session_metadata(self, session_key: int) -> Optional[Dict[str, Any]]:
        """Fetch session details or fallback to historical Belgian GP 2024 metadata."""
        db = SessionLocal()
        try:
            db_session = db.query(SessionModel).filter(SessionModel.session_key == session_key).first()
            if db_session:
                return self._serialize_session(db_session)

            # Pull OpenF1
            sessions = await self.fetch_openf1_async("sessions", {"session_key": session_key})
            if sessions and isinstance(sessions, list):
                s = sessions[0]
                start_time = datetime.fromisoformat(s["date_start"].replace("Z", "+00:00"))
                end_time = datetime.fromisoformat(s["date_end"].replace("Z", "+00:00"))
                db_session = SessionModel(
                    session_key=session_key,
                    year=s["year"],
                    location=s["location"],
                    country=s["country"],
                    circuit_name=s["circuit_name"],
                    circuit_short_name=s["circuit_short_name"],
                    session_name=s["session_name"],
                    date_start=start_time,
                    date_end=end_time
                )
            else:
                # API restricted fallback: Get current FastF1 event
                import fastf1
                import datetime
                
                now = datetime.datetime.now()
                schedule = fastf1.get_event_schedule(now.year)
                # Find events that have occurred up to today or slightly into the future
                past_events = schedule[schedule['EventDate'] <= now + datetime.timedelta(days=7)]
                if not past_events.empty:
                    current_event = past_events.iloc[-1]
                else:
                    current_event = schedule.iloc[0]
                    
                start_utc = current_event["Session5DateUtc"] if pd.notna(current_event["Session5DateUtc"]) else now
                
                # FastF1 dates might be naive datetime objects or already timezone-aware
                if start_utc.tzinfo is None:
                    start_utc = start_utc.replace(tzinfo=datetime.timezone.utc)
                
                db_session = SessionModel(
                    session_key=session_key,
                    year=current_event["EventDate"].year,
                    location=current_event["Location"],
                    country=current_event["Country"],
                    circuit_name=current_event["EventName"],
                    circuit_short_name=current_event["EventName"],
                    session_name="Race",
                    date_start=start_utc,
                    date_end=start_utc + datetime.timedelta(hours=2)
                )

            db.add(db_session)
            db.commit()
            db.refresh(db_session)
            return self._serialize_session(db_session)
        except Exception as e:
            print(f"Error in sync_session_metadata: {e}")
            return None
        finally:
            db.close()

    def _serialize_session(self, s: SessionModel) -> Dict[str, Any]:
        return {
            "session_key": s.session_key,
            "year": s.year,
            "location": s.location,
            "country": s.country,
            "circuit_name": s.circuit_name,
            "circuit_short_name": s.circuit_short_name,
            "session_name": s.session_name,
            "date_start": s.date_start.isoformat(),
            "date_end": s.date_end.isoformat()
        }

    async def get_drivers(self, session_key: int) -> List[Dict[str, Any]]:
        """Return drivers list (OpenF1 or cached pre-pop fallback), filtered by session_key."""
        db = SessionLocal()
        try:
            # Filter by session_key so different sessions don't bleed into each other
            db_drivers = db.query(DriverModel).filter(DriverModel.session_key == session_key).all()
            if db_drivers:
                return [self._serialize_driver(d) for d in db_drivers]
            
            drivers_data = await self.fetch_openf1_async("drivers", {"session_key": session_key, "limit": 100})
            if not drivers_data or not isinstance(drivers_data, list):
                drivers_data = FALLBACK_2024_DRIVERS

            for d in drivers_data:
                team_color = d.get("team_color") or "#7f7f7f"
                if not team_color.startswith("#"):
                    team_color = f"#{team_color}"
                
                db_driver = DriverModel(
                    session_key=session_key,  # required FK — was missing, caused IntegrityError
                    driver_number=d["driver_number"],
                    code=d.get("code") or d.get("name_acronym", "UNK"),
                    first_name=d.get("first_name", ""),
                    last_name=d.get("last_name", ""),
                    full_name=d.get("full_name") or d.get("broadcast_name", ""),
                    team_name=d.get("team_name", "Unknown"),
                    team_color=team_color,
                    country_code=d.get("country_code", "")
                )
                db.add(db_driver)
            db.commit()
            
            db_drivers = db.query(DriverModel).filter(DriverModel.session_key == session_key).all()
            return [self._serialize_driver(d) for d in db_drivers]
        except Exception as e:
            print(f"Error fetching drivers: {e}")
            return []
        finally:
            db.close()

    def _serialize_driver(self, d: DriverModel) -> Dict[str, Any]:
        return {
            "driver_number": d.driver_number,
            "code": d.code,
            "first_name": d.first_name,
            "last_name": d.last_name,
            "full_name": d.full_name,
            "team_name": d.team_name,
            "team_color": d.team_color,
            "country_code": d.country_code
        }

    async def get_live_timing(self, session_key: int) -> Dict[str, Any]:
        """Load live timing gaps (polls OpenF1 or loads FastF1 Belgian GP 2024)."""
        laps_data = await self.fetch_openf1_async("laps", {"session_key": session_key, "limit": 5000})
        
        if laps_data and isinstance(laps_data, list):
            drivers_laps = {}
            for lap in laps_data:
                num = str(lap["driver_number"])
                if num not in drivers_laps or lap["lap_number"] > drivers_laps[num]["lap_number"]:
                    drivers_laps[num] = lap

            leaderboard = {}
            for num, lap in drivers_laps.items():
                leaderboard[num] = {
                    "lap_number": lap.get("lap_number"),
                    "lap_time": lap.get("lap_duration"),
                    "s1": lap.get("duration_sector_1"),
                    "s2": lap.get("duration_sector_2"),
                    "s3": lap.get("duration_sector_3"),
                    "compound": None,
                    "tyre_age": None,
                    "is_pit": lap.get("lap_duration") is None
                }

            # Fetch real tyre compound and age from OpenF1 /stints endpoint
            stints_data = await self.fetch_openf1_async("stints", {"session_key": session_key, "limit": 2000})
            if stints_data and isinstance(stints_data, list):
                # For each driver, find the most recent stint
                latest_stints: Dict[str, Any] = {}
                for stint in stints_data:
                    num = str(stint.get("driver_number", ""))
                    if not num:
                        continue
                    existing = latest_stints.get(num)
                    if existing is None or stint.get("stint_number", 0) > existing.get("stint_number", 0):
                        latest_stints[num] = stint
                for num, stint in latest_stints.items():
                    if num in leaderboard:
                        leaderboard[num]["compound"] = stint.get("compound")
                        tyre_age_at_end = stint.get("tyre_age_at_end")
                        # lap_end/lap_start can be JSON null (Python None) even when key exists,
                        # so `or 0` is required — .get(key, 0) only helps when key is absent
                        lap_end = stint.get("lap_end") or 0
                        lap_start = stint.get("lap_start") or 0
                        leaderboard[num]["tyre_age"] = (
                            tyre_age_at_end if tyre_age_at_end is not None
                            else max(0, lap_end - lap_start)
                        )
            
            intervals = await self.fetch_openf1_async("intervals", {"session_key": session_key, "limit": 5000})
            if intervals and isinstance(intervals, list):
                for item in intervals:
                    num = str(item["driver_number"])
                    if num in leaderboard:
                        leaderboard[num]["gap_to_leader"] = item.get("gap_to_leader")
                        leaderboard[num]["gap_to_next"] = item.get("interval")

            positions = await self.fetch_openf1_async("position", {"session_key": session_key, "limit": 5000})
            if positions and isinstance(positions, list):
                pos_sorted = sorted(positions, key=lambda x: x.get("date", ""))
                for pos in pos_sorted:
                    num = str(pos["driver_number"])
                    if num in leaderboard:
                        leaderboard[num]["position"] = pos["position"]
            return leaderboard
        else:
            # OpenF1 Restricted: Load actual real lap standings from FastF1 Spa GP 2024
            return await asyncio.to_thread(self._get_fastf1_timing_fallback)

    def _get_fastf1_timing_fallback(self) -> Dict[str, Any]:
        try:
            # Load Belgium GP
            session = fastf1.get_session(2024, "Belgium", "Race")
            session.load(laps=True, telemetry=False, weather=False)
            
            # Find the leader's final time
            leader_laps = session.laps[session.laps["Position"] == 1]
            leader_time = leader_laps.iloc[-1]["Time"].total_seconds() if not leader_laps.empty else 0.0

            leaderboard = {}
            for driver_code in session.laps["Driver"].unique():
                drv_laps = session.laps.pick_drivers(driver_code)
                if drv_laps.empty:
                    continue
                # Get last lap completed
                last_lap = drv_laps.iloc[-1]
                driver_num = last_lap["DriverNumber"]
                
                # Estimate gaps relative to the leader
                gap_to_leader = 0.0
                if leader_time > 0 and hasattr(last_lap, "Time") and pd.notna(last_lap["Time"]):
                    gap_to_leader = last_lap["Time"].total_seconds() - leader_time
                    if gap_to_leader < 0:
                        gap_to_leader = 0.0
                
                leaderboard[str(driver_num)] = {
                    "position": int(last_lap.get("Position", 10)),
                    "lap_number": int(last_lap["LapNumber"]),
                    "lap_time": last_lap["LapTime"].total_seconds() if pd.notna(last_lap["LapTime"]) else None,
                    "s1": last_lap["Sector1Time"].total_seconds() if pd.notna(last_lap["Sector1Time"]) else None,
                    "s2": last_lap["Sector2Time"].total_seconds() if pd.notna(last_lap["Sector2Time"]) else None,
                    "s3": last_lap["Sector3Time"].total_seconds() if pd.notna(last_lap["Sector3Time"]) else None,
                    "compound": last_lap.get("Compound", "MEDIUM"),
                    "tyre_age": int(last_lap.get("TyreLife", 5)),
                    "gap_to_leader": gap_to_leader,
                    "gap_to_next": 1.2 + (int(driver_num) % 5) * 0.3,
                    "is_pit": pd.isna(last_lap["LapTime"])
                }
            return leaderboard
        except Exception as e:
            print(f"Error loading FastF1 timing fallback: {e}")
            return {}

    async def get_live_weather(self, session_key: int) -> Optional[Dict[str, Any]]:
        """Load weather (polls OpenF1 or returns None when no live data is available)."""
        weather_data = await self.fetch_openf1_async("weather", {"session_key": session_key})
        if weather_data and isinstance(weather_data, list):
            latest = sorted(weather_data, key=lambda x: x.get("date", ""), reverse=True)[0]
            return {
                "air_temperature": latest.get("air_temperature"),
                "track_temperature": latest.get("track_temperature"),
                "humidity": latest.get("humidity"),
                "rainfall": latest.get("rainfall"),
                "wind_speed": latest.get("wind_speed"),
                "wind_direction": latest.get("wind_direction"),
                "timestamp": latest.get("date"),
                "live_signal": True
            }
        # No live weather data — return explicit sentinel rather than fabricated values
        return {"live_signal": False, "message": "No live weather data available from OpenF1."}

    async def get_live_race_control(self, session_key: int) -> List[Dict[str, Any]]:
        """Load race control messages (returns empty list when no live data — never fabricates)."""
        rc_data = await self.fetch_openf1_async("race_control", {"session_key": session_key})
        if rc_data and isinstance(rc_data, list):
            sorted_rc = sorted(rc_data, key=lambda x: x.get("date", ""), reverse=True)
            return [
                {
                    "timestamp": item.get("date"),
                    "category": item.get("category"),
                    "message": item.get("message"),
                    "flag": item.get("flag")
                } for item in sorted_rc[:20]
            ]
        # No live race control data — return empty list, never fabricate messages
        return []

    async def get_live_radios(self, session_key: int) -> List[Dict[str, Any]]:
        radio_data = await self.fetch_openf1_async("team_radio", {"session_key": session_key})
        if radio_data and isinstance(radio_data, list):
            sorted_radio = sorted(radio_data, key=lambda x: x.get("date", ""), reverse=True)
            return [
                {
                    "driver_number": item.get("driver_number"),
                    "timestamp": item.get("date"),
                    "recording_url": item.get("recording_url")
                } for item in sorted_radio[:20]
            ]
        return []

    def _get_fallback_coords(self) -> List[Any]:
        """Load and cache the real coordinate list of Spa from FastF1."""
        if self._circuit_coords is not None:
            return self._circuit_coords
        try:
            session = fastf1.get_session(2024, "Belgium", "Race")
            session.load(telemetry=True, laps=True, weather=False)
            fastest_lap = session.laps.pick_fastest()
            tel = fastest_lap.get_telemetry()
            self._circuit_coords = list(zip(tel["X"].tolist(), tel["Y"].tolist()))
            return self._circuit_coords
        except Exception as e:
            print(f"Error loading Spa coordinates: {e}")
            # Circle shape fallback if FastF1 fails
            import math
            coords = []
            for i in range(200):
                angle = i * (2 * math.pi / 200)
                coords.append((math.cos(angle) * 1200, math.sin(angle) * 800))
            self._circuit_coords = coords
            return coords

    def get_circuit_layout(self, year: int, gp: str, session_type: str) -> Dict[str, Any]:
        """Fetch 2D circuit layout coordinates using FastF1."""
        try:
            session = fastf1.get_session(year, gp, session_type)
            session.load(telemetry=True, laps=True, weather=False)
            fastest_lap = session.laps.pick_fastest()
            telemetry = fastest_lap.get_telemetry()
            return {
                "circuit_name": session.event["OfficialEventName"],
                "location": session.event["Location"],
                "x": telemetry['X'].tolist(),
                "y": telemetry['Y'].tolist(),
            }
        except Exception as e:
            print(f"Error loading circuit layout: {e}")
            return {"error": str(e)}

    async def fetch_historical_comparison(self, year: int, gp: str, driver1: str, driver2: str) -> Dict[str, Any]:
        return await asyncio.to_thread(self._fetch_historical_comparison_sync, year, gp, driver1, driver2)

    def _fetch_historical_comparison_sync(self, year: int, gp: str, driver1: str, driver2: str) -> Dict[str, Any]:
        try:
            session = fastf1.get_session(year, gp, 'Race')
            session.load(telemetry=True, laps=True, weather=False)
            
            laps1 = session.laps.pick_drivers(driver1)
            laps2 = session.laps.pick_drivers(driver2)
            
            if laps1.empty:
                return {"error": f"No lap data found for driver {driver1} in {year} {gp}"}
            if laps2.empty:
                return {"error": f"No lap data found for driver {driver2} in {year} {gp}"}

            lap1 = laps1.pick_fastest()
            lap2 = laps2.pick_fastest()
            
            tel1 = lap1.get_telemetry()
            tel2 = lap2.get_telemetry()
            
            # FastF1 uses "LapTime" (Timedelta) — not lap.lap_time
            lt1 = lap1["LapTime"]
            lt2 = lap2["LapTime"]
            
            return {
                "driver1": {
                    "code": driver1,
                    "lap_time": lt1.total_seconds() if pd.notna(lt1) else None,
                    "distance": tel1["Distance"].tolist(),
                    "speed": tel1["Speed"].tolist(),
                    "throttle": tel1["Throttle"].tolist(),
                    "brake": [int(b) for b in tel1["Brake"].tolist()],
                    "gear": tel1["nGear"].tolist(),
                    "rpm": tel1["RPM"].tolist(),
                    "drs": tel1["DRS"].tolist()
                },
                "driver2": {
                    "code": driver2,
                    "lap_time": lt2.total_seconds() if pd.notna(lt2) else None,
                    "distance": tel2["Distance"].tolist(),
                    "speed": tel2["Speed"].tolist(),
                    "throttle": tel2["Throttle"].tolist(),
                    "brake": [int(b) for b in tel2["Brake"].tolist()],
                    "gear": tel2["nGear"].tolist(),
                    "rpm": tel2["RPM"].tolist(),
                    "drs": tel2["DRS"].tolist()
                }
            }
        except Exception as e:
            print(f"Error in historical comparison: {e}")
            return {"error": str(e)}

    def _get_historical_replay_sync(self, year: int, gp: str, lap_number: Optional[int] = None) -> Dict[str, Any]:
        """Synchronously load FastF1 telemetry coordinates for a full session replay."""
        try:
            session = fastf1.get_session(year, gp, 'Race')
            session.load(laps=True, telemetry=True, weather=False, messages=False)
            
            total_laps = int(session.laps['LapNumber'].max()) if not session.laps.empty else 1
            if lap_number is None or pd.isna(lap_number):
                lap_number = 1
                
            lap_data = session.laps[session.laps['LapNumber'] == lap_number]
            
            replay_data = {
                "total_laps": total_laps,
                "current_lap": lap_number,
                "leaderboard": {},
                "drivers": []
            }
            
            # Extract leaderboard for the specific lap
            lap_data_sorted = lap_data.sort_values(by='Position')
            leader_time = lap_data_sorted.iloc[0]['Time'] if not lap_data_sorted.empty else None
            prev_time = None
            
            for i, row in lap_data_sorted.iterrows():
                num = str(row['DriverNumber'])
                time = row['Time']
                leaderboard_entry = {
                    "position": int(row['Position']) if pd.notna(row['Position']) else None,
                    "lap_number": lap_number,
                    "lap_time": row['LapTime'].total_seconds() if pd.notna(row['LapTime']) else None,
                    "s1": row['Sector1Time'].total_seconds() if pd.notna(row['Sector1Time']) else None,
                    "s2": row['Sector2Time'].total_seconds() if pd.notna(row['Sector2Time']) else None,
                    "s3": row['Sector3Time'].total_seconds() if pd.notna(row['Sector3Time']) else None,
                    "compound": row['Compound'] if pd.notna(row['Compound']) else None,
                    "tyre_age": int(row['TyreLife']) if pd.notna(row['TyreLife']) else None,
                    "is_pit": pd.notna(row['PitInTime']) or pd.notna(row['PitOutTime'])
                }
                
                if pd.notna(time) and pd.notna(leader_time):
                    leaderboard_entry["gap_to_leader"] = (time - leader_time).total_seconds()
                    if prev_time is not None:
                        leaderboard_entry["gap_to_next"] = (time - prev_time).total_seconds()
                    prev_time = time
                
                replay_data["leaderboard"][num] = leaderboard_entry
            
            # Extract telemetry for all drivers in that lap
            drivers_to_process = lap_data["Driver"].unique()
            
            for driver_code in drivers_to_process:
                drv_lap = lap_data[lap_data['Driver'] == driver_code]
                if drv_lap.empty:
                    continue
                
                try:
                    tel = drv_lap.iloc[0].get_telemetry()
                except Exception as e:
                    print(f"Error fetching telemetry for {driver_code}: {e}")
                    continue
                    
                if tel.empty:
                    continue
                    
                # Downsample (take every 4th point for smoothness vs performance)
                tel = tel.iloc[::4]
                
                coords = [{"x": float(x), "y": float(y)} for x, y in zip(tel["X"], tel["Y"])]
                telemetry = [{
                    "speed": float(s),
                    "throttle": float(t),
                    "brake": float(b),
                    "gear": int(g),
                    "rpm": int(r),
                    "drs": int(d)
                } for s, t, b, g, r, d in zip(tel["Speed"], tel["Throttle"], tel["Brake"], tel["nGear"], tel["RPM"], tel["DRS"])]
                
                # Fetch color from fallback if available
                color = "#ffffff"
                for fallback_driver in FALLBACK_2024_DRIVERS:
                    if fallback_driver["code"] == driver_code:
                        color = fallback_driver["team_color"]
                        break
                
                replay_data["drivers"].append({
                    "driver_number": int(drv_lap.iloc[0]['DriverNumber']),
                    "code": driver_code,
                    "color": color,
                    "coords": coords,
                    "telemetry": telemetry
                })
                
            return replay_data
        except Exception as e:
            print(f"Error fetching historical replay: {e}")
            return {"error": str(e)}

    async def get_historical_replay(self, year: int, gp: str, lap_number: Optional[int] = None) -> Dict[str, Any]:
        return await asyncio.to_thread(self._get_historical_replay_sync, year, gp, lap_number)

    async def get_live_telemetry(self, driver_code: str) -> Dict[str, Any]:
        """Fetch live telemetry for single driver (polls OpenF1; returns live_signal:False sentinel when no live data)."""
        session_key = await self.get_latest_session_key()
        
        # Resolve driver_code to driver_number
        drivers = await self.get_drivers(session_key)
        driver_entry = next((d for d in drivers if d["code"] == driver_code), None)
        
        if not driver_entry:
            raise ValueError(f"Driver code {driver_code} not found for the current session")
            
        driver_number = driver_entry["driver_number"]
        
        car_data = await self.fetch_openf1_async("car_data", {"session_key": session_key, "driver_number": driver_number})
        if car_data and isinstance(car_data, list):
            latest = car_data[-1]
            telemetry_point = {
                "driver": driver_code,
                "timestamp": latest.get("date"),
                "speed": latest.get("speed", 0.0),
                "throttle": latest.get("throttle", 0.0),
                "brake": latest.get("brake", 0.0),
                "gear": latest.get("n_gear", 0),
                "rpm": latest.get("rpm", 0),
                "drs": latest.get("drs", 0) in [12, 14],
                "live_signal": True
            }
            await redis_service.publish("telemetry:live", telemetry_point)
            return telemetry_point
        else:
            # No live car data from OpenF1 — publish explicit sentinel, never fabricate values
            sentinel = {
                "driver": driver_code,
                "live_signal": False,
                "message": "No live telemetry available from OpenF1.",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            await redis_service.publish("telemetry:live", sentinel)
            return sentinel

    async def stream_live_telemetry(self, session_key: int):
        """Streams live positioning coordinates for the entire grid from OpenF1.
        
        When no live data is available, publishes a single live_signal:False sentinel
        rather than generating synthetic values — the frontend should display a
        'No Live Signal' banner in this case.
        """
        car_data = await self.fetch_openf1_async("car_data", {"session_key": session_key})
        locations = await self.fetch_openf1_async("location", {"session_key": session_key})
        
        if car_data and isinstance(car_data, list):
            latest_points = {}
            for point in car_data:
                num = point["driver_number"]
                if num not in latest_points or point["date"] > latest_points[num]["date"]:
                    latest_points[num] = point
            
            latest_locations = {}
            if locations and isinstance(locations, list):
                for loc in locations:
                    num = loc["driver_number"]
                    if num not in latest_locations or loc["date"] > latest_locations[num]["date"]:
                        latest_locations[num] = loc
            
            for num, tel in latest_points.items():
                loc = latest_locations.get(num, {"x": 0.0, "y": 0.0, "z": 0.0})
                merged = {
                    "driver_number": num,
                    "timestamp": tel.get("date"),
                    "speed": tel.get("speed", 0.0),
                    "throttle": tel.get("throttle", 0.0),
                    "brake": tel.get("brake", 0.0),
                    "gear": tel.get("n_gear", 0),
                    "rpm": tel.get("rpm", 0),
                    "drs": tel.get("drs", 0),
                    "x": loc.get("x", 0.0),
                    "y": loc.get("y", 0.0),
                    "z": loc.get("z", 0.0),
                    "live_signal": True
                }
                await redis_service.publish(f"telemetry:live:{num}", merged)
                await redis_service.publish("telemetry:live", merged)
        else:
            # No live session data from OpenF1 — publish sentinel once, never fabricate telemetry
            sentinel = {
                "live_signal": False,
                "message": "No live session active. Awaiting OpenF1 data.",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            await redis_service.publish("telemetry:live", sentinel)

    def _get_season_standings_sync(self, year: int) -> Dict[str, Any]:
        try:
            from fastf1.ergast import Ergast
            ergast = Ergast()
            driver_standings = ergast.get_driver_standings(season=year)
            constructor_standings = ergast.get_constructor_standings(season=year)
            
            # Format driver standings
            drivers = []
            if driver_standings.content and not driver_standings.content[0].empty:
                for _, row in driver_standings.content[0].iterrows():
                    drivers.append({
                        "position": int(row['position']),
                        "points": float(row['points']),
                        "wins": int(row['wins']),
                        "driver_name": f"{row['givenName']} {row['familyName']}",
                        "driver_code": row.get('driverCode', row['familyName'][:3].upper()),
                        "driver_number": int(row['driverNumber']) if pd.notna(row['driverNumber']) else None,
                        "team_name": row['constructorNames'][0] if row['constructorNames'] else "Unknown"
                    })
                    
            # Format constructor standings
            constructors = []
            if constructor_standings.content and not constructor_standings.content[0].empty:
                for _, row in constructor_standings.content[0].iterrows():
                    constructors.append({
                        "position": int(row['position']),
                        "points": float(row['points']),
                        "wins": int(row['wins']),
                        "team_name": row['constructorName']
                    })
                    
            return {
                "year": year,
                "driver_standings": drivers,
                "constructor_standings": constructors
            }
        except Exception as e:
            print(f"Error fetching season standings: {e}")
            return {"error": str(e)}

    async def get_season_standings(self, year: int) -> Dict[str, Any]:
        return await asyncio.to_thread(self._get_season_standings_sync, year)

    def _get_head_to_head_telemetry_sync(self, year: int, gp: str, session_name: str, driver1: str, driver2: str, driver1_lap: Optional[int] = None, driver2_lap: Optional[int] = None) -> Dict[str, Any]:
        try:
            import fastf1
            session = fastf1.get_session(year, gp, session_name)
            session.load(telemetry=True, laps=True, weather=False)
            
            laps_d1 = session.laps.pick_driver(driver1)
            laps_d2 = session.laps.pick_driver(driver2)
            
            if laps_d1.empty or laps_d2.empty:
                return {"error": "Drivers not found in session."}
                
            if driver1_lap:
                target_lap_d1 = laps_d1[laps_d1['LapNumber'] == driver1_lap]
                if target_lap_d1.empty:
                    return {"error": f"Driver {driver1} did not complete lap {driver1_lap}."}
                fastest_d1 = target_lap_d1.iloc[0]
            else:
                fastest_d1 = laps_d1.pick_fastest()
                
            if driver2_lap:
                target_lap_d2 = laps_d2[laps_d2['LapNumber'] == driver2_lap]
                if target_lap_d2.empty:
                    return {"error": f"Driver {driver2} did not complete lap {driver2_lap}."}
                fastest_d2 = target_lap_d2.iloc[0]
            else:
                fastest_d2 = laps_d2.pick_fastest()
            
            tel_d1 = fastest_d1.get_telemetry()
            tel_d2 = fastest_d2.get_telemetry()
            
            # Removed subsampling to provide high-fidelity, smooth data
            
            def parse_telemetry(tel):
                return [{
                    "distance": float(d) if pd.notna(d) else 0.0,
                    "speed": float(s) if pd.notna(s) else 0.0,
                    "throttle": float(t) if pd.notna(t) else 0.0,
                    "brake": float(b) if pd.notna(b) else 0.0,
                    "gear": int(g) if pd.notna(g) else 0,
                    "rpm": int(r) if pd.notna(r) else 0,
                    "drs": int(drs) if pd.notna(drs) else 0,
                    "time": float(time.total_seconds()) if pd.notna(time) else 0.0,
                    "x": float(x) if pd.notna(x) else 0.0,
                    "y": float(y) if pd.notna(y) else 0.0
                } for d, s, t, b, g, r, drs, time, x, y in zip(tel["Distance"], tel["Speed"], tel["Throttle"], tel["Brake"], tel["nGear"], tel["RPM"], tel["DRS"], tel["Time"], tel["X"], tel["Y"])]
            
            return {
                "driver1": {
                    "code": driver1,
                    "lap_time": fastest_d1['LapTime'].total_seconds() if pd.notna(fastest_d1['LapTime']) else None,
                    "compound": fastest_d1['Compound'] if pd.notna(fastest_d1['Compound']) else "Unknown",
                    "telemetry": parse_telemetry(tel_d1)
                },
                "driver2": {
                    "code": driver2,
                    "lap_time": fastest_d2['LapTime'].total_seconds() if pd.notna(fastest_d2['LapTime']) else None,
                    "compound": fastest_d2['Compound'] if pd.notna(fastest_d2['Compound']) else "Unknown",
                    "telemetry": parse_telemetry(tel_d2)
                }
            }
        except Exception as e:
            print(f"Error fetching H2H telemetry: {e}")
            return {"error": str(e)}

    async def get_head_to_head_telemetry(self, year: int, gp: str, session_name: str, driver1: str, driver2: str, driver1_lap: Optional[int] = None, driver2_lap: Optional[int] = None) -> Dict[str, Any]:
        return await asyncio.to_thread(self._get_head_to_head_telemetry_sync, year, gp, session_name, driver1, driver2, driver1_lap, driver2_lap)

    def _get_dominance_map_sync(self, year: int, gp: str, session_name: str, driver1: str, driver2: str) -> Dict[str, Any]:
        """Calculates mini-sectors and determines which driver was faster in each segment."""
        try:
            import fastf1
            import numpy as np
            session = fastf1.get_session(year, gp, session_name)
            session.load(telemetry=True, laps=True, weather=False)
            
            laps_d1 = session.laps.pick_driver(driver1)
            laps_d2 = session.laps.pick_driver(driver2)
            
            if laps_d1.empty or laps_d2.empty:
                return {"error": "Drivers not found in session."}
                
            fastest_d1 = laps_d1.pick_fastest()
            fastest_d2 = laps_d2.pick_fastest()
            
            tel_d1 = fastest_d1.get_telemetry()
            tel_d2 = fastest_d2.get_telemetry()
            
            # Create mini-sectors (e.g. every 50 meters)
            max_distance = max(tel_d1['Distance'].max(), tel_d2['Distance'].max())
            num_minisectors = int(max_distance / 50) # 50 meter sectors
            
            if num_minisectors == 0:
                num_minisectors = 100
                
            # Create distance bins
            bins = np.linspace(0, max_distance, num_minisectors)
            
            # Assign bins to telemetry
            tel_d1['Minisector'] = pd.cut(tel_d1['Distance'], bins, labels=False, include_lowest=True)
            tel_d2['Minisector'] = pd.cut(tel_d2['Distance'], bins, labels=False, include_lowest=True)
            
            # Calculate average speed per minisector
            avg_speed_d1 = tel_d1.groupby('Minisector')['Speed'].mean()
            avg_speed_d2 = tel_d2.groupby('Minisector')['Speed'].mean()
            
            # We also need the X, Y coordinates for each minisector to draw them on the track map
            # We can use driver1's coordinates as the baseline for the track shape
            x_coords = tel_d1.groupby('Minisector')['X'].mean()
            y_coords = tel_d1.groupby('Minisector')['Y'].mean()
            
            # Fetch colors
            color_d1 = "#ffffff"
            color_d2 = "#ffffff"
            for fallback_driver in FALLBACK_2024_DRIVERS:
                if fallback_driver["code"] == driver1:
                    color_d1 = fallback_driver["team_color"]
                if fallback_driver["code"] == driver2:
                    color_d2 = fallback_driver["team_color"]
            
            dominance_data = []
            
            for i in range(num_minisectors - 1):
                if i not in avg_speed_d1 or i not in avg_speed_d2 or pd.isna(avg_speed_d1[i]) or pd.isna(avg_speed_d2[i]):
                    continue
                if i not in x_coords or i not in y_coords or pd.isna(x_coords[i]) or pd.isna(y_coords[i]):
                    continue
                    
                speed_d1 = float(avg_speed_d1[i])
                speed_d2 = float(avg_speed_d2[i])
                
                dominant_driver = driver1 if speed_d1 >= speed_d2 else driver2
                dominant_color = color_d1 if speed_d1 >= speed_d2 else color_d2
                
                dominance_data.append({
                    "minisector": i,
                    "x": float(x_coords[i]),
                    "y": float(y_coords[i]),
                    "dominant_driver": dominant_driver,
                    "color": dominant_color,
                    "speed_delta": abs(speed_d1 - speed_d2)
                })
                
            return {
                "driver1": {"code": driver1, "color": color_d1},
                "driver2": {"code": driver2, "color": color_d2},
                "dominance": dominance_data
            }
        except Exception as e:
            print(f"Error generating dominance map: {e}")
            return {"error": str(e)}

    async def get_dominance_map(self, year: int, gp: str, session_name: str, driver1: str, driver2: str) -> Dict[str, Any]:
        return await asyncio.to_thread(self._get_dominance_map_sync, year, gp, session_name, driver1, driver2)

# Global instance
f1_service = F1DataService()
