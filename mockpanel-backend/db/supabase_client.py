import threading
import logging
from typing import Optional
from supabase import create_client, Client
from core.config import settings

logger = logging.getLogger("uvicorn")

_client_lock: threading.Lock = threading.Lock()
_global_client: Optional[Client] = None

def get_global_supabase_client() -> Client:
    global _global_client
    if _global_client is not None:
        return _global_client

    with _client_lock:
        if _global_client is not None:
            return _global_client

        if not settings.supabase_url or not settings.supabase_anon_key:
            raise ValueError("Supabase URL or Anon Key missing in .env")

        try:
            # 💡 EK DAM SIMPLE INIT: Koi 'ClientOptions' nahi hai isme
            client = create_client(settings.supabase_url, settings.supabase_anon_key)
            
            logger.info("✅ Supabase client initialized: %s", settings.supabase_url)
            _global_client = client
            return _global_client
        except Exception as e:
            logger.error("❌ Supabase Init Failed: %s", e)
            raise ValueError(f"Failed to create Supabase client: {e}")

def get_supabase_service_client() -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ValueError("Supabase Service Key missing in .env")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)