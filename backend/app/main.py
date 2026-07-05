from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError as SAOperationalError
from app.core.config import settings
from app.core.database import engine, Base
from app.api import auth, users, companies, applications, gmail, notifications, resumes, ai, calendar, announcements, dashboard
from app.services.gmail_sync import start_scheduler, shutdown_scheduler

# NOTE: Do NOT call Base.metadata.create_all() at module level.
# If the DB has a transient SSL issue at import time, it crashes the whole app
# before uvicorn can even start. Instead, we run it in the startup event with retries.

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

import logging

@app.exception_handler(SAOperationalError)
async def db_operational_error_handler(request: Request, exc: SAOperationalError):
    """Return 503 on stale DB SSL connections so the frontend can retry."""
    logging.error(f"Database OperationalError on {request.method} {request.url.path}: {exc}")
    return JSONResponse(
        status_code=503,
        content={"detail": "Database temporarily unavailable. Please retry."},
    )

# Middleware to log headers
@app.middleware("http")
async def log_requests(request: Request, call_next):
    auth_header = request.headers.get("Authorization")
    logging.warning(f"DEBUG: Request {request.method} {request.url.path} - Auth Header: {auth_header[:20] if auth_header else 'None'}...")
    response = await call_next(request)
    logging.warning(f"DEBUG: Response status: {response.status_code}")
    return response

# Add GZip Middleware for compression
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Set CORS origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://project-next-up.vercel.app",
        "https://project-nextup.vercel.app"
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers (mounted under both /api and /api/v1 for compatibility)
for api_prefix in [settings.API_V1_STR, "/api/v1"]:
    app.include_router(auth.router, prefix=api_prefix)
    app.include_router(users.router, prefix=api_prefix)
    app.include_router(companies.router, prefix=api_prefix)
    app.include_router(applications.router, prefix=api_prefix)
    app.include_router(gmail.router, prefix=api_prefix)
    app.include_router(notifications.router, prefix=api_prefix)
    app.include_router(resumes.router, prefix=api_prefix)
    app.include_router(ai.router, prefix=api_prefix)
    app.include_router(calendar.router, prefix=api_prefix)
    app.include_router(announcements.router, prefix=api_prefix)
    app.include_router(dashboard.router, prefix=api_prefix)

@app.on_event("startup")
def on_startup():
    # Run structural schema migrations automatically on boot
    db_url = settings.DATABASE_URL
    is_sqlite = db_url.startswith("sqlite")
    
    migrations = [
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS jd_strategy JSONB;" if not is_sqlite else "ALTER TABLE companies ADD COLUMN IF NOT EXISTS jd_strategy TEXT;",
        "ALTER TABLE ai_generation_jobs ADD COLUMN IF NOT EXISTS result_json JSONB;" if not is_sqlite else "ALTER TABLE ai_generation_jobs ADD COLUMN IF NOT EXISTS result_json TEXT;",
        "CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_status_created ON ai_generation_jobs(status, created_at);"
    ]
    
    postgres_only = [
        "ALTER TABLE ai_generation_jobs DROP CONSTRAINT IF EXISTS ai_generation_jobs_status_check;",
        "ALTER TABLE ai_generation_jobs ADD CONSTRAINT ai_generation_jobs_status_check CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled'));"
    ]
    
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            trans = conn.begin()
            try:
                for sql in migrations:
                    conn.execute(text(sql))
                if not is_sqlite:
                    for sql in postgres_only:
                        conn.execute(text(sql))
                trans.commit()
                logging.info("Startup schema migration verified successfully.")
            except Exception as mig_err:
                trans.rollback()
                logging.error(f"Startup schema migration failed: {mig_err}")
    except Exception as outer_err:
        logging.error(f"Startup migration outer execution failed: {outer_err}")

    if is_sqlite:
        Base.metadata.create_all(bind=engine)
        logging.info("SQLite: tables created/verified.")
    else:
        logging.info("PostgreSQL: connection verified.")

    start_scheduler()
    from app.services.resume_worker import worker as resume_worker
    resume_worker.start()

@app.on_event("shutdown")
def on_shutdown():
    shutdown_scheduler()
    from app.services.resume_worker import worker as resume_worker
    resume_worker.stop()

@app.get("/")
def read_root():
    return {"message": f"Welcome to {settings.PROJECT_NAME} API. Access docs at /docs."}


@app.post("/api/admin/reset-circuits")
def admin_reset_circuits(request: Request):
    """
    Admin endpoint: reset all AI gateway circuit breakers.
    Use this after a provider (e.g. the HF Space) recovers from failures
    without needing to restart the Render server.
    When INGEST_AUTH_TOKEN is configured, requires 'Authorization: Bearer <token>'.
    """
    if settings.INGEST_AUTH_TOKEN:
        auth_header = request.headers.get("Authorization", "")
        expected = f"Bearer {settings.INGEST_AUTH_TOKEN}"
        if auth_header != expected:
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    from app.services.ai_provider import reset_all_circuits
    reset_all_circuits()
    return {"status": "ok", "message": "All AI circuit breakers have been reset to closed state."}


@app.get("/api/admin/ai-health")
def admin_ai_health(request: Request):
    """
    Admin endpoint: inspect AI gateway health and circuit breaker states.
    When INGEST_AUTH_TOKEN is configured, requires 'Authorization: Bearer <token>'.
    """
    if settings.INGEST_AUTH_TOKEN:
        auth_header = request.headers.get("Authorization", "")
        expected = f"Bearer {settings.INGEST_AUTH_TOKEN}"
        if auth_header != expected:
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    from app.services.ai_provider import get_parser_gateway, get_resume_gateway
    return {
        "parser": get_parser_gateway().health(),
        "resume": get_resume_gateway().health(),
    }
