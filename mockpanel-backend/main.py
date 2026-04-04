from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from db.supabase_client import get_global_supabase_client
from db.redis_client import get_redis

# --- ROUTER IMPORTS ---
from api.v1.sessions import router as sessions_router
from api.v1.websockets import router as websockets_router
from api.v1.auth import router as auth_router  # ✅ NEW: Auth router import kiya

app = FastAPI(
    title="MockPanel Backend",
    version="1.0.0",
    debug=settings.debug
)

# Logging middleware to see all incoming requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    # Print clean logs for debugging
    print(f"🚀 Received request: {request.method} {request.url}")
    response = await call_next(request)
    print(f"✅ Response status: {response.status_code}")
    return response

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    # ✅ FIX: Vercel ka live link add kar diya hai
    allow_origins=[
        "http://localhost:3000", 
        "https://mock-panel.vercel.app"
    ], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- INCLUDE ROUTERS ---
# Auth router ko pehle include karna better practice hai
app.include_router(auth_router)       # ✅ NEW: Isse /api/v1/auth/signup chalne lagega
app.include_router(sessions_router)
app.include_router(websockets_router)

@app.get("/")
def read_root():
    return {
        "status": "online", 
        "message": "Welcome to MockPanel AI Engine",
        "version": "1.0.0"
    }

@app.get("/env-check")
def check_env():
    # Sensitive keys ko mask kar diya hai safety ke liye
    env_status = {
        "ENV": settings.env,
        "SUPABASE_URL": "Loaded" if settings.supabase_url else "Not Set",
        "GEMINI_API_KEY": "Loaded" if settings.gemini_api_key else "Not Set",
        "REDIS_URL": "Connected" if settings.redis_url else "Not Set",
        "JWT_SECRET_KEY": "Loaded" if settings.jwt_secret_key else "Not Set"
    }
    return {"env_status": env_status}

if __name__ == "__main__":
    import uvicorn
    # Settings se host aur port utha rahe hain
    uvicorn.run(
        "main:app",
        host=settings.api_host if hasattr(settings, 'api_host') else "0.0.0.0",
        port=settings.api_port if hasattr(settings, 'api_port') else 8000,
        reload=True,
    )