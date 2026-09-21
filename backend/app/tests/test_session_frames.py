import threading

import pandas as pd
import pytest

from app.services import session_frames
from app.services.session_frames import LruCache, SessionFrames


def test_lru_cache_returns_none_for_a_missing_key():
    assert LruCache(maxsize=2).get("nope") is None


def test_lru_cache_stores_and_returns_values():
    cache = LruCache(maxsize=2)
    cache.set("a", 1)
    assert cache.get("a") == 1


def test_lru_cache_evicts_the_least_recently_used_entry():
    cache = LruCache(maxsize=2)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.get("a")          # "a" is now the most recently used
    cache.set("c", 3)       # evicts "b"
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert cache.get("c") == 3


def test_lru_cache_overwrites_an_existing_key_without_growing():
    cache = LruCache(maxsize=2)
    cache.set("a", 1)
    cache.set("a", 2)
    cache.set("b", 3)
    assert cache.get("a") == 2 and cache.get("b") == 3


def test_lru_cache_is_safe_under_concurrent_use():
    cache = LruCache(maxsize=8)

    def worker(n):
        for i in range(200):
            cache.set((n, i % 10), i)
            cache.get((n, (i + 1) % 10))

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(cache) <= 8


def _frames():
    return SessionFrames(
        event_name="Belgian Grand Prix", year=2023, session_name="Race",
        results=pd.DataFrame({"Abbreviation": ["VER"]}), laps=pd.DataFrame({"Driver": ["VER"]}), race_control=None,
    )


def test_load_session_frames_is_cached_per_session(monkeypatch):
    session_frames._FRAMES_CACHE = LruCache(maxsize=4)
    calls = []
    monkeypatch.setattr(session_frames, "_load_from_fastf1", lambda y, g, s: calls.append((y, g, s)) or _frames())

    first = session_frames.load_session_frames(2023, "Belgian Grand Prix", "Race")
    second = session_frames.load_session_frames(2023, "  belgian grand prix ", "Race")  # same session, different spelling
    assert first is second
    assert len(calls) == 1


def test_load_session_frames_does_not_cache_failures(monkeypatch):
    session_frames._FRAMES_CACHE = LruCache(maxsize=4)
    attempts = []

    def flaky(year, gp, session):
        attempts.append(1)
        if len(attempts) == 1:
            raise ConnectionError("network")
        return _frames()

    monkeypatch.setattr(session_frames, "_load_from_fastf1", flaky)
    with pytest.raises(ConnectionError):
        session_frames.load_session_frames(2023, "Belgian Grand Prix", "Race")
    assert session_frames.load_session_frames(2023, "Belgian Grand Prix", "Race") is not None
    assert len(attempts) == 2
