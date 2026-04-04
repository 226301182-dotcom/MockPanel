#!/usr/bin/env python3
"""
ARQ Background Worker for MockPanel Analytics
Run with: python worker.py
"""
import asyncio
import logging
from arq import Worker
from arq.connections import RedisSettings

from core.config import settings
from workers.analytics_worker import generate_interview_analytics

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Worker settings
WorkerSettings = {
    "redis_settings": RedisSettings.from_dsn(settings.redis_url),
    "functions": [generate_interview_analytics],
    "max_jobs": 10,
    "job_timeout": 300,  # 5 minutes
    "keep_result": 3600,  # Keep results for 1 hour
    "health_check_interval": 60,
}


if __name__ == '__main__':
    worker = Worker(**WorkerSettings)
    asyncio.run(worker.main())