import redis.asyncio as redis
import json
import time
from typing import Any, Dict
from app.core.config import settings

# Redis is optional infrastructure here (live pub/sub, token revocation): when it
# is unreachable the app degrades instead of failing. That only works if being
# unreachable is *cheap* -- so connection attempts time out quickly, and after a
# failure we don't try again for a while. Without this, every authenticated
# request would block on a fresh connection attempt to a dead server.
CONNECT_TIMEOUT_SECONDS = 1
SOCKET_TIMEOUT_SECONDS = 2
RECONNECT_COOLDOWN_SECONDS = 5


class RedisService:
    def __init__(self, url: str):
        self.redis_url = url
        self.client = None
        self._retry_after = 0.0

    async def connect(self):
        if self.client:
            return
        if time.monotonic() < self._retry_after:
            return

        candidate = None
        try:
            candidate = redis.from_url(
                self.redis_url,
                decode_responses=True,
                socket_connect_timeout=CONNECT_TIMEOUT_SECONDS,
                socket_timeout=SOCKET_TIMEOUT_SECONDS,
            )
            # Test connection
            await candidate.ping()
            self.client = candidate
            print(f"Connected to Redis at {self.redis_url}")
        except Exception as e:
            print(f"Failed to connect to Redis: {e}")
            self.client = None
            self._retry_after = time.monotonic() + RECONNECT_COOLDOWN_SECONDS
            if candidate is not None:
                try:
                    await candidate.aclose()  # don't leak the half-open pool
                except Exception:
                    pass

    async def publish(self, channel: str, message: Dict[str, Any]):
        if not self.client:
            await self.connect()
        if self.client:
            try:
                await self.client.publish(channel, json.dumps(message))
            except Exception as e:
                print(f"Error publishing to Redis channel {channel}: {e}")

    async def subscribe(self, channel: str):
        if not self.client:
            await self.connect()
        if self.client:
            pubsub = self.client.pubsub()
            await pubsub.subscribe(channel)
            return pubsub
        return None

# Global instance
redis_service = RedisService(settings.REDIS_CONNECTION_URL)
