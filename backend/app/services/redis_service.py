import redis.asyncio as redis
import json
import asyncio
from typing import Any, Dict
from app.core.config import settings

class RedisService:
    def __init__(self, url: str):
        self.redis_url = url
        self.client = None

    async def connect(self):
        if not self.client:
            try:
                self.client = redis.from_url(self.redis_url, decode_responses=True)
                # Test connection
                await self.client.ping()
                print(f"Connected to Redis at {self.redis_url}")
            except Exception as e:
                print(f"Failed to connect to Redis: {e}")
                self.client = None

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
