import os
import asyncio
import json
import requests
import fastf1
import pandas as pd
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import quote
from app.core.config import settings
from app.services.redis_service import redis_service
from app.services.live_timing import live_timing_feed
from app.websocket.manager import manager
from app.services.live_session import (
    apply_classification, build_leaderboard, driver_entry, fastf1_driver_entries, fastf1_leaderboard, fastf1_race_control,
    pick_session, session_metadata,
)

# Enable FastF1 caching
os.makedirs(settings.FASTF1_CACHE_DIR, exist_ok=True)
try:
    fastf1.Cache.enable_cache(settings.FASTF1_CACHE_DIR)
except Exception as e:
    print(f"Failed to enable FastF1 cache: {e}")

# Seconds each kind of OpenF1 response is reused for.
SESSIONS_TTL = 300
MEETING_TTL = 3600
FINISHED_TTL = 600
LIVE_TTL = 4
# The live page falls back to the latest race FastF1 can load, under this session key.
FASTF1_SESSION_KEY = 9999
FALLBACK_TTL = 1800
# How many recent races to try before giving up (each failed download takes a few seconds).
FALLBACK_EVENTS_TRIED = 3
TELEMETRY_WINDOW_SECONDS = 5
# The startup streamer polls this often during a live session, and checks this often otherwise.
LIVE_POLL_SECONDS = 4
IDLE_POLL_SECONDS = 30
# F1's live feed holds the cars' latest frames in memory, so they can go out twice a second.
FEED_POLL_SECONDS = 0.5

# The predictions form's last-resort driver codes, for when no standings load.
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
    """The live page's data: the current session from OpenF1, else the latest race FastF1 can load.

    OpenF1 allows 30 requests a minute and closes to keyless requests while a session runs, so every
    response is cached (briefly for a live session, longer for a finished one) and a failed request
    falls back to the last good response.
    """

    def __init__(self):
        self.openf1_base_url = "https://api.openf1.org/v1"
        self._cache: Dict[str, Tuple[float, Any]] = {}
        self._live_keys: set = set()
        self._fallback: Optional[Tuple[float, Any]] = None
        self._fallback_lock = threading.Lock()

    def _openf1_url(self, endpoint: str, params: Optional[Dict[str, Any]]) -> str:
        # OpenF1 filters such as date>2026-10-11T13:00 only work unencoded, with no "="
        parts = []
        for key, value in (params or {}).items():
            if key.endswith((">", "<")):
                parts.append(f"{key}{value}")
            else:
                parts.append(f"{quote(str(key))}={quote(str(value))}")
        return f"{self.openf1_base_url}/{endpoint}" + (f"?{'&'.join(parts)}" if parts else "")

    def _fetch_openf1(self, endpoint: str, params: Optional[Dict[str, Any]] = None, ttl: float = FINISHED_TTL) -> Optional[List[Any]]:
        """A list of OpenF1 records, or None. Supports a Bearer key (OPENF1_API_KEY) for live sessions."""
        url = self._openf1_url(endpoint, params)
        cached = self._cache.get(url)
        if cached and cached[0] > time.monotonic():
            return cached[1]

        headers = {}
        api_key = os.getenv("OPENF1_API_KEY")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        try:
            response = requests.get(url, headers=headers, timeout=10)
            data = response.json() if response.status_code == 200 else None
            if response.status_code not in (200, 404):
                print(f"OpenF1 returned {response.status_code} for {url}")
        except Exception as e:
            print(f"Exception fetching OpenF1 {url}: {e}")
            data = None

        if isinstance(data, list):
            self._cache[url] = (time.monotonic() + ttl, data)
            return data
        # rate limited, closed during a live session, or down: keep showing what we last had
        return cached[1] if cached else None

    async def fetch_openf1_async(self, endpoint: str, params: Optional[Dict[str, Any]] = None, ttl: float = FINISHED_TTL) -> Optional[List[Any]]:
        return await asyncio.to_thread(self._fetch_openf1, endpoint, params, ttl)

    def _ttl(self, session_key: int) -> float:
        return LIVE_TTL if session_key in self._live_keys else FINISHED_TTL

    async def current_session(self) -> Optional[Dict[str, Any]]:
        """The running session, else the most recent one to have started (never one still to come)."""
        live = live_timing_feed.active_session()
        if live:  # F1's own feed: OpenF1 is closed to keyless requests while a session runs
            return live
        now = datetime.now(timezone.utc)
        for year in (now.year, now.year - 1):  # before the season's first session, last season's finale
            sessions = await self.fetch_openf1_async("sessions", {"year": year}, SESSIONS_TTL)
            if sessions is None:
                break
            picked = pick_session(sessions, now)
            if picked:
                chosen, live = picked
                meetings = await self.fetch_openf1_async("meetings", {"meeting_key": chosen.get("meeting_key")}, MEETING_TTL)
                if live:
                    self._live_keys.add(chosen["session_key"])
                else:
                    self._live_keys.discard(chosen["session_key"])
                return session_metadata(chosen, meetings[0] if meetings else None, live)

        fallback = await asyncio.to_thread(self._fastf1_fallback)
        return fallback["meta"] if fallback else None

    async def get_latest_session_key(self) -> Optional[int]:
        current = await self.current_session()
        return current["session_key"] if current else None

    def _fastf1_fallback(self) -> Optional[Dict[str, Any]]:
        """The latest race of this season (or last) that FastF1 can load, for when OpenF1 can't help."""
        with self._fallback_lock:
            if self._fallback and self._fallback[0] > time.monotonic():
                return self._fallback[1]
            result = None
            now = datetime.now()
            for year in (now.year, now.year - 1):
                try:
                    schedule = fastf1.get_event_schedule(year, include_testing=False)
                except Exception as e:
                    print(f"Couldn't load the {year} schedule: {e}")
                    continue
                past = schedule[schedule["EventDate"] <= now].sort_values("EventDate", ascending=False)
                for _, event in past.head(FALLBACK_EVENTS_TRIED).iterrows():
                    try:
                        session = fastf1.get_session(year, int(event["RoundNumber"]), "R")
                        session.load(laps=True, telemetry=False, weather=True, messages=True)
                        if session.laps is None or session.laps.empty:
                            continue
                    except Exception as e:
                        print(f"Skipping {year} {event['EventName']} for the live fallback: {e}")
                        continue
                    start = event.get("Session5DateUtc")
                    if pd.notna(start) and start.tzinfo is None:
                        start = start.tz_localize("UTC")
                    result = {"session": session, "meta": {
                        "session_key": FASTF1_SESSION_KEY, "year": year, "location": event["Location"],
                        "country": event["Country"], "circuit_name": event["Location"],
                        "circuit_short_name": event["Location"], "meeting_name": event["EventName"],
                        "session_name": "Race",
                        "date_start": start.isoformat() if pd.notna(start) else None,
                        "date_end": (start + timedelta(hours=2)).isoformat() if pd.notna(start) else None,
                        "live": False, "source": "fastf1",
                    }}
                    break
                if result:
                    break
            self._fallback = (time.monotonic() + FALLBACK_TTL, result)
            return result

    async def _fallback_session(self):
        fallback = await asyncio.to_thread(self._fastf1_fallback)
        return fallback["session"] if fallback else None

    async def get_drivers(self, session_key: int) -> List[Dict[str, Any]]:
        if live_timing_feed.serves(session_key):
            return live_timing_feed.drivers()
        if session_key == FASTF1_SESSION_KEY:
            session = await self._fallback_session()
            return fastf1_driver_entries(session.results) if session is not None else []
        drivers = await self.fetch_openf1_async("drivers", {"session_key": session_key}, self._ttl(session_key))
        return [driver_entry(d) for d in drivers or [] if isinstance(d, dict) and d.get("driver_number") is not None]

    async def get_live_timing(self, session_key: int) -> Dict[str, Any]:
        if live_timing_feed.serves(session_key):
            return live_timing_feed.timing()
        if session_key == FASTF1_SESSION_KEY:
            session = await self._fallback_session()
            return fastf1_leaderboard(session.results, session.laps) if session is not None else {}
        ttl = self._ttl(session_key)
        laps = await self.fetch_openf1_async("laps", {"session_key": session_key}, ttl)
        if not laps:
            return {}
        stints = await self.fetch_openf1_async("stints", {"session_key": session_key}, ttl)
        intervals = await self.fetch_openf1_async("intervals", {"session_key": session_key}, ttl)
        positions = await self.fetch_openf1_async("position", {"session_key": session_key}, ttl)
        board = build_leaderboard(laps, stints, intervals, positions)
        if session_key not in self._live_keys:
            # a finished session: the official result, so a retired car reads DNF, not its last gap
            results = await self.fetch_openf1_async("session_result", {"session_key": session_key}, ttl)
            if results:
                board = apply_classification(board, results)
        return board

    async def get_live_weather(self, session_key: int) -> Optional[Dict[str, Any]]:
        """The latest weather reading, or a live_signal:False sentinel (never fabricated values)."""
        if live_timing_feed.serves(session_key) and live_timing_feed.weather():
            return live_timing_feed.weather()
        if session_key == FASTF1_SESSION_KEY:
            session = await self._fallback_session()
            weather = getattr(session, "weather_data", None) if session is not None else None
            if weather is not None and not weather.empty:
                last = weather.iloc[-1]
                return {
                    "air_temperature": float(last["AirTemp"]), "track_temperature": float(last["TrackTemp"]),
                    "humidity": float(last["Humidity"]), "rainfall": int(bool(last["Rainfall"])),
                    "wind_speed": float(last["WindSpeed"]), "wind_direction": float(last["WindDirection"]),
                    "timestamp": None, "live_signal": True,
                }
            return {"live_signal": False, "message": "No weather data for this session."}
        weather_data = await self.fetch_openf1_async("weather", {"session_key": session_key}, self._ttl(session_key))
        if weather_data:
            latest = max(weather_data, key=lambda x: x.get("date", ""))
            return {
                "air_temperature": latest.get("air_temperature"),
                "track_temperature": latest.get("track_temperature"),
                "humidity": latest.get("humidity"),
                "rainfall": latest.get("rainfall"),
                "wind_speed": latest.get("wind_speed"),
                "wind_direction": latest.get("wind_direction"),
                "timestamp": latest.get("date"),
                "live_signal": True,
            }
        return {"live_signal": False, "message": "No weather data for this session."}

    async def get_live_race_control(self, session_key: int) -> List[Dict[str, Any]]:
        """Race control messages, newest first (empty when there are none, never fabricated)."""
        if live_timing_feed.serves(session_key):
            return live_timing_feed.race_control()
        if session_key == FASTF1_SESSION_KEY:
            session = await self._fallback_session()
            return fastf1_race_control(getattr(session, "race_control_messages", None)) if session is not None else []
        rc_data = await self.fetch_openf1_async("race_control", {"session_key": session_key}, self._ttl(session_key))
        return [
            {"timestamp": item.get("date"), "category": item.get("category"), "message": item.get("message"), "flag": item.get("flag")}
            for item in sorted(rc_data or [], key=lambda x: x.get("date", ""), reverse=True)[:20]
        ]

    async def get_session_status(self, session_key: int) -> Dict[str, Any]:
        """Whether the session is stopped and when it restarts. Only F1's feed carries this."""
        if live_timing_feed.serves(session_key):
            return live_timing_feed.session_status()
        return {"stopped": False, "red_flag": False, "announcement": None, "resumes_at": None}

    async def get_race_strategy(self, session_key: int) -> Dict[str, Any]:
        """Live battles, rejoin places and undercut/overcut odds. They need the lap-by-lap history only
        F1's feed is building during a session, so a session it isn't covering has none."""
        if not live_timing_feed.serves(session_key):
            return {"live": False}
        from app.services import live_strategy

        snapshot = live_timing_feed.race_snapshot()
        session = snapshot.get("session") or {}
        prior = live_strategy.prior_pit_loss(session.get("year"), session.get("location"))
        return {"live": True, **await asyncio.to_thread(live_strategy.race_strategy, snapshot, prior)}

    async def get_live_radios(self, session_key: int) -> List[Dict[str, Any]]:
        if live_timing_feed.serves(session_key):
            return live_timing_feed.radios()
        if session_key == FASTF1_SESSION_KEY:
            return []  # FastF1 has no team radio
        radio_data = await self.fetch_openf1_async("team_radio", {"session_key": session_key}, self._ttl(session_key))
        return [
            {"driver_number": item.get("driver_number"), "timestamp": item.get("date"), "recording_url": item.get("recording_url")}
            for item in sorted(radio_data or [], key=lambda x: x.get("date", ""), reverse=True)[:20]
        ]

    def get_circuit_layout(self, year: int, gp: str, session_type: str) -> Dict[str, Any]:
        """Fetch 2D circuit layout coordinates using FastF1.

        During a live weekend this year's race has no data yet, so the outline comes from the most
        recent earlier year that raced at the same venue (the coordinates are in the same frame)."""
        error = None
        for attempt_year in (year, year - 1, year - 2):
            try:
                session = fastf1.get_session(attempt_year, gp, session_type)
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
                print(f"No circuit layout from {attempt_year} {gp}: {e}")
                error = e
        return {"error": str(error)}

    async def stream_live_telemetry(self, session_key: int):
        """Publishes each car's latest position and telemetry for a live session.

        Asks OpenF1 only for the last few seconds of data. When there is none, publishes a single
        live_signal:False sentinel rather than synthetic values, and the frontend shows 'No live signal'.
        """
        since = (datetime.now(timezone.utc) - timedelta(seconds=TELEMETRY_WINDOW_SECONDS)).strftime("%Y-%m-%dT%H:%M:%S")
        params = {"session_key": session_key, "date>": since}
        car_data = await self.fetch_openf1_async("car_data", params, LIVE_TTL)
        locations = await self.fetch_openf1_async("location", params, LIVE_TTL)

        if car_data:
            latest_points = {}
            for point in car_data:
                num = point["driver_number"]
                if num not in latest_points or point["date"] > latest_points[num]["date"]:
                    latest_points[num] = point

            latest_locations = {}
            for loc in locations or []:
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
                await redis_service.publish("telemetry:live", merged)
        else:
            await self.publish_no_signal()

    async def telemetry_tick(self) -> float:
        """One pass of the startup streamer; returns how long to wait before the next.

        Car data is only polled while a session is live (a few seconds of it at a time), so the
        30-a-minute OpenF1 allowance is left for the timing board.
        """
        if live_timing_feed.active_session():
            # F1's feed: each car's latest frame straight to the browsers (no Redis needed). Frames
            # only arrive with an F1 TV token; without one the map and telemetry panels stay empty.
            for frame in live_timing_feed.car_frames():
                await manager.broadcast(json.dumps(frame))
            return FEED_POLL_SECONDS
        current = await self.current_session()
        if current and current.get("live") and current.get("source") == "openf1":
            await self.stream_live_telemetry(current["session_key"])
            return LIVE_POLL_SECONDS
        await self.publish_no_signal()
        return IDLE_POLL_SECONDS

    async def publish_no_signal(self):
        """Tell the browsers there's no live car data, rather than fabricating any."""
        await redis_service.publish("telemetry:live", {
            "live_signal": False,
            "message": "No live session active. Awaiting OpenF1 data.",
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

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

# Global instance
f1_service = F1DataService()
