import json
import logging
from typing import Any, Optional
from redis.asyncio import Redis as AsyncRedis
from redis import Redis as SyncRedis
from redis.exceptions import RedisError

from core.config import settings

logger = logging.getLogger(__name__)

# Global instances
_async_redis: Optional[AsyncRedis] = None
_sync_redis: Optional[SyncRedis] = None


def get_async_redis() -> AsyncRedis:
    """Get async Redis client for FastAPI/WebSocket operations"""
    global _async_redis
    if _async_redis is None:
        try:
            _async_redis = AsyncRedis.from_url(
                settings.redis_url,
                decode_responses=True,
                max_connections=20,
                retry_on_timeout=True,
                socket_timeout=5.0,
                socket_connect_timeout=5.0,
            )
            logger.info("Async Redis client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize async Redis: {e}")
            raise
    return _async_redis


def get_redis() -> SyncRedis:
    """Get sync Redis client for background workers"""
    global _sync_redis
    if _sync_redis is None:
        try:
            _sync_redis = SyncRedis.from_url(
                settings.redis_url,
                decode_responses=True,
                max_connections=10,
                retry_on_timeout=True,
                socket_timeout=5.0,
            )
            logger.info("Sync Redis client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize sync Redis: {e}")
            raise
    return _sync_redis


class RedisCache:
    """High-level Redis cache operations for MockPanel"""

    def __init__(self):
        self.redis = get_async_redis()

    async def set_session_context(self, session_id: str, context: list[dict]) -> None:
        """Cache conversation history for fast LLM access"""
        key = f"session:{session_id}:context"
        try:
            await self.redis.setex(key, 7200, json.dumps(context))  # 2 hours TTL
        except RedisError as e:
            logger.error(f"Failed to cache session context: {e}")

    async def get_session_context(self, session_id: str) -> Optional[list[dict]]:
        """Retrieve cached conversation history"""
        key = f"session:{session_id}:context"
        try:
            data = await self.redis.get(key)
            return json.loads(data) if data else None
        except RedisError as e:
            logger.error(f"Failed to get session context: {e}")
            return None

    async def set_session_state(self, session_id: str, state: str) -> None:
        """Cache current session state (listening/thinking/speaking)"""
        key = f"session:{session_id}:state"
        try:
            await self.redis.setex(key, 7200, state)
        except RedisError as e:
            logger.error(f"Failed to set session state: {e}")

    async def get_session_state(self, session_id: str) -> Optional[str]:
        """Get current session state"""
        key = f"session:{session_id}:state"
        try:
            return await self.redis.get(key)
        except RedisError as e:
            logger.error(f"Failed to get session state: {e}")
            return None

    async def cache_resume_text(self, session_id: str, resume_text: str) -> None:
        """Cache parsed resume text to avoid re-parsing"""
        key = f"session:{session_id}:resume_text"
        try:
            await self.redis.setex(key, 7200, resume_text)
        except RedisError as e:
            logger.error(f"Failed to cache resume text: {e}")

    async def get_resume_text(self, session_id: str) -> Optional[str]:
        """Get cached resume text"""
        key = f"session:{session_id}:resume_text"
        try:
            return await self.redis.get(key)
        except RedisError as e:
            logger.error(f"Failed to get resume text: {e}")
            return None

    async def store_telemetry(self, session_id: str, telemetry: dict) -> None:
        """Store expression analysis telemetry for analytics"""
        key = f"session:{session_id}:telemetry"
        try:
            # Append to a list in Redis
            await self.redis.rpush(key, json.dumps(telemetry))
            # Set TTL to 2 hours
            await self.redis.expire(key, 7200)
        except RedisError as e:
            logger.error(f"Failed to store telemetry: {e}")

    async def rate_limit_check(self, user_id: str, limit: int = 100) -> bool:
        """Check if user has exceeded rate limit (requests per hour)"""
        key = f"user:{user_id}:rate_limit"
        try:
            current = await self.redis.incr(key)
            if current == 1:
                await self.redis.expire(key, 3600)  # 1 hour TTL
            return current <= limit
        except RedisError as e:
            logger.error(f"Rate limit check failed: {e}")
            return True  # Allow on error

    async def close(self):
        """Close Redis connections"""
        if _async_redis:
            await _async_redis.close()
        if _sync_redis:
            _sync_redis.close()


# Global cache instance
redis_cache = RedisCache()

