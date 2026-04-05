import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from db.supabase_client import get_global_supabase_client
from db.redis_client import get_redis

# --- ROUTER IMPORTS ---
from api.v1.sessions import router as sessions_router
from api.v1.websockets import router as websockets_router
from api.v1.auth import router as auth_router

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn")

app = FastAPI(
    title="MockPanel Backend",
    version="1.0.0",
    debug=settings.debug
)

# 1️⃣ CORS middleware — Enhanced for Vercel Previews
# allow_origin_regex helps in catching all Vercel subdomains
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://mock-panel.vercel.app",   # Primary Domain
        "http://localhost:3000",           # Next.js local
        "http://localhost:5173",           # Vite local
    ],
    allow_origin_regex=r"https://mock-panel-.*\.vercel\.app", # All Vercel previews
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2️⃣ Logging middleware — More robust than 'print'
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
# Note: Auth usually goes first to verify tokens before other routes
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(sessions_router, prefix="/api/v1/sessions", tags=["sessions"])
app.include_router(websockets_router, tags=["websockets"]) # Websockets usually don't need prefix

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Welcome to MockPanel AI Engine",
        "version": "1.0.0"
    }

# Security Note: Hide this in strict production, but keep for now for debugging
@app.get("/env-check")
def check_env():
    # Never return actual keys! Just check if they exist.
    return {
        "env": settings.env,
        "database": "Ready" if settings.supabase_url else "Missing",
        "ai_engine": "Ready" if settings.gemini_api_key or settings.openai_api_key else "Missing",
        "cache": "Ready" if settings.redis_url else "Missing"
    }

if __name__ == "__main__":
    import uvicorn
    # Render overrides this with the Start Command, but good for local dev
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )