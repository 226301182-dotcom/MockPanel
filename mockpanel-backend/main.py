import logging
import sys
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

# In imports ko dhyan se check karein, agar 'settings' load nahi ho raha toh yahi crash hoga
try:
    from core.config import settings
    from db.supabase_client import get_global_supabase_client
    from db.redis_client import get_redis
    
    # --- ROUTER IMPORTS ---
    from api.v1.sessions import router as sessions_router
    from api.v1.websockets import router as websockets_router
    from api.v1.auth import router as auth_router
except Exception as e:
    print(f"❌ CRITICAL IMPORT ERROR: {e}")
    sys.exit(1)

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn")

app = FastAPI(
    title="MockPanel Backend",
    version="1.0.0",
    debug=settings.debug
)

# 1️⃣ CORS middleware — Wildcard for testing (Vercel aur Render ke beech jhagda khatam)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2️⃣ Logging middleware — Request track karne ke liye
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"🚀 {request.method} {request.url}")
    try:
        response = await call_next(request)
        logger.info(f"✅ Status: {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"❌ Request Failed: {str(e)}")
        raise

# --- INCLUDE ROUTERS ---

# ⚠️ DHYAN DEIN: Yahan se paths finalize ho rahe hain

# 1. Auth: Ismein 'auth.py' ke andar pehle se "/api/v1/auth" hai.
# Isse chhedne ki zaroorat nahi, ye login pass kar raha hai.
app.include_router(auth_router) 

# 2. Sessions: Frontend "/sessions" dhoond raha hai.
# Yahan prefix="/sessions" de rahe hain. 
# (NOTE: api/v1/sessions.py ke andar APIRouter ka prefix khali kar dena).
app.include_router(sessions_router, prefix="/sessions", tags=["sessions"])

# 3. Websockets:
app.include_router(websockets_router, tags=["websockets"]) 

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Welcome to MockPanel AI Engine",
        "version": "1.0.0"
    }

@app.get("/env-check")
def check_env():
    return {
        "env": settings.env,
        "database": "Ready" if settings.supabase_url else "Missing",
        "ai_engine": "Ready" if settings.gemini_api_key else "Missing",
        "cache": "Ready" if settings.redis_url else "Missing"
    }

if __name__ == "__main__":
    import uvicorn
    # Render handles this via Start Command, but good for local
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)