import pytest

import app.services.redis_service as redis_module
from app.services.redis_service import RedisService


class _FailingClient:
    closed = False

    async def ping(self):
        raise ConnectionError("refused")

    async def aclose(self):
        _FailingClient.closed = True


@pytest.mark.asyncio
async def test_connect_failure_leaves_client_unset_and_does_not_raise(monkeypatch):
    monkeypatch.setattr(redis_module.redis, "from_url", lambda *a, **k: _FailingClient())
    service = RedisService("redis://nowhere:6379/0")
    await service.connect()
    assert service.client is None


@pytest.mark.asyncio
async def test_failed_connect_is_not_retried_during_the_cooldown(monkeypatch):
    # Every authenticated request calls connect(); if Redis is down that must not
    # mean a fresh (slow) connection attempt on every single request.
    attempts = []

    def fake_from_url(*args, **kwargs):
        attempts.append(kwargs)
        return _FailingClient()

    monkeypatch.setattr(redis_module.redis, "from_url", fake_from_url)
    service = RedisService("redis://nowhere:6379/0")
    await service.connect()
    await service.connect()
    await service.connect()
    assert len(attempts) == 1


@pytest.mark.asyncio
async def test_connect_is_retried_once_the_cooldown_has_elapsed(monkeypatch):
    attempts = []

    def fake_from_url(*args, **kwargs):
        attempts.append(1)
        return _FailingClient()

    clock = {"now": 1000.0}
    monkeypatch.setattr(redis_module.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(redis_module.redis, "from_url", fake_from_url)
    service = RedisService("redis://nowhere:6379/0")

    await service.connect()
    clock["now"] += redis_module.RECONNECT_COOLDOWN_SECONDS + 0.1
    await service.connect()
    assert len(attempts) == 2


@pytest.mark.asyncio
async def test_connection_attempts_use_short_timeouts(monkeypatch):
    seen = {}

    def fake_from_url(*args, **kwargs):
        seen.update(kwargs)
        return _FailingClient()

    monkeypatch.setattr(redis_module.redis, "from_url", fake_from_url)
    await RedisService("redis://nowhere:6379/0").connect()
    assert seen.get("socket_connect_timeout") is not None and seen["socket_connect_timeout"] <= 2
    assert seen.get("socket_timeout") is not None and seen["socket_timeout"] <= 5


@pytest.mark.asyncio
async def test_failed_client_is_closed_so_connections_do_not_leak(monkeypatch):
    _FailingClient.closed = False
    monkeypatch.setattr(redis_module.redis, "from_url", lambda *a, **k: _FailingClient())
    await RedisService("redis://nowhere:6379/0").connect()
    assert _FailingClient.closed is True


@pytest.mark.asyncio
async def test_successful_connect_sets_the_client(monkeypatch):
    class _OkClient:
        async def ping(self):
            return True

    monkeypatch.setattr(redis_module.redis, "from_url", lambda *a, **k: _OkClient())
    service = RedisService("redis://ok:6379/0")
    await service.connect()
    assert service.client is not None
