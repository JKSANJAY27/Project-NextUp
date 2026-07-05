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
    # Only run create_all for SQLite (local development convenience).
    # In production (PostgreSQL / Supabase), tables already exist and are
    # managed via migrations. Calling create_all against Supabase's PgBouncer
    # pooler triggers an hstore OID probe that always fails with an SSL error.
    if settings.DATABASE_URL.startswith("sqlite"):
        Base.metadata.create_all(bind=engine)
        logging.info("SQLite: tables created/verified.")
    else:
        logging.info("PostgreSQL: skipping create_all — tables managed via migrations.")

    start_scheduler()

@app.on_event("shutdown")
def on_shutdown():
    shutdown_scheduler()

@app.get("/")
def read_root():
    return {"message": f"Welcome to {settings.PROJECT_NAME} API. Access docs at /docs."}
