"""Loads a finished race/sprint session's results, laps and race-control messages
once, and keeps recent ones in memory.

Parsing a FastF1 session takes seconds even with the on-disk cache warm. The
debrief and what-if features both re-read the same session repeatedly (tweaking a
hypothetical re-runs it), so caching the parsed frames makes those interactive.
Finished sessions never change, so there is nothing to invalidate."""
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Hashable, Optional

import pandas as pd


class LruCache:
    """Small thread-safe LRU. Loads run in worker threads, so access is locked."""

    def __init__(self, maxsize: int):
        self._maxsize = maxsize
        self._data: "OrderedDict[Hashable, Any]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Hashable) -> Optional[Any]:
        with self._lock:
            if key not in self._data:
                return None
            self._data.move_to_end(key)
            return self._data[key]

    def set(self, key: Hashable, value: Any) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)


@dataclass
class SessionFrames:
    event_name: str
    year: int
    session_name: str
    results: pd.DataFrame
    laps: pd.DataFrame
    race_control: Optional[pd.DataFrame]


_FRAMES_CACHE = LruCache(maxsize=8)


def _load_from_fastf1(year: int, gp: str, session_name: str) -> SessionFrames:
    import fastf1

    session = fastf1.get_session(year, gp, session_name)
    session.load(laps=True, telemetry=False, weather=False, messages=True)

    race_control = None
    try:
        race_control = session.race_control_messages
    except Exception:
        pass  # optional: absent for some sessions

    return SessionFrames(
        event_name=str(session.event["EventName"]),
        year=year,
        session_name=session_name,
        results=session.results,
        laps=session.laps,
        race_control=race_control,
    )


def load_session_frames(year: int, gp: str, session_name: str = "Race") -> SessionFrames:
    """Blocking -- call via asyncio.to_thread from async routes. Failures are not cached."""
    key = (year, gp.strip().lower(), session_name)
    cached = _FRAMES_CACHE.get(key)
    if cached is not None:
        return cached
    frames = _load_from_fastf1(year, gp.strip(), session_name)
    _FRAMES_CACHE.set(key, frames)
    return frames
