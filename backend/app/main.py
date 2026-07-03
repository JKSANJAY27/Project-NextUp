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

# Include Routers
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(users.router, prefix=settings.API_V1_STR)
app.include_router(companies.router, prefix=settings.API_V1_STR)
app.include_router(applications.router, prefix=settings.API_V1_STR)
app.include_router(gmail.router, prefix=settings.API_V1_STR)
app.include_router(notifications.router, prefix=settings.API_V1_STR)
app.include_router(resumes.router, prefix=settings.API_V1_STR)
app.include_router(ai.router, prefix=settings.API_V1_STR)
app.include_router(calendar.router, prefix=settings.API_V1_STR)
app.include_router(announcements.router, prefix=settings.API_V1_STR)
app.include_router(dashboard.router, prefix=settings.API_V1_STR)

@app.on_event("startup")
def on_startup():
    import time
    from sqlalchemy.exc import OperationalError as SAOperationalError

    # Retry create_all up to 5 times with backoff.
    # Render's DB proxy can have a transient SSL blip right at deploy time.
    max_attempts = 5
    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
            logging.info("Database tables verified/created successfully.")
            break
        except SAOperationalError as e:
            if attempt == max_attempts:
                logging.error(f"Could not connect to database after {max_attempts} attempts. Giving up: {e}")
                raise
            wait = 2 ** attempt  # 2, 4, 8, 16 seconds
            logging.warning(f"DB connection attempt {attempt} failed (SSL/transient error). Retrying in {wait}s... Error: {e}")
            time.sleep(wait)

    start_scheduler()

@app.on_event("shutdown")
def on_shutdown():
    shutdown_scheduler()

@app.get("/")
def read_root():
    return {"message": f"Welcome to {settings.PROJECT_NAME} API. Access docs at /docs."}
