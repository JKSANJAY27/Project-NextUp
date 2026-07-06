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
        "ALTER TABLE ai_generation_jobs ADD COLUMN IF NOT EXISTS input_payload_enc TEXT;",
        "ALTER TABLE ai_generation_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;" if is_sqlite else "ALTER TABLE ai_generation_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE;",
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


@app.post("/api/admin/backfill-jd-strategies")
def admin_backfill_jd_strategies(request: Request):
    """
    Admin endpoint: for every company missing a JD strategy, backfill
    companies.jd_text (from the attached JD PDF if present, else the latest
    announcement email body) and generate the reusable JD Strategy JSON.
    Runs in a background thread — each strategy takes minutes on free-tier CPU.
    When INGEST_AUTH_TOKEN is configured, requires 'Authorization: Bearer <token>'.
    """
    if settings.INGEST_AUTH_TOKEN:
        auth_header = request.headers.get("Authorization", "")
        if auth_header != f"Bearer {settings.INGEST_AUTH_TOKEN}":
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})

    import threading

    def _backfill():
        from app.core.database import SessionLocal
        from app.models.models import Company, CompanyEvent, AttachmentMetadata
        from app.services.ai_service import generate_jd_strategy
        from app.services.pdf_extractor import extract_text_from_pdf

        db = SessionLocal()
        try:
            companies = db.query(Company).all()
            done = 0
            for company in companies:
                existing = company.jd_strategy if isinstance(company.jd_strategy, dict) else {}
                if existing.get("required_skills"):
                    continue
                try:
                    # Best JD text: attached JD PDF > stored jd_text > latest event body
                    jd_text = company.jd_text or ""
                    pdf_att = (
                        db.query(AttachmentMetadata)
                        .join(CompanyEvent, AttachmentMetadata.company_event_id == CompanyEvent.id)
                        .filter(CompanyEvent.company_id == company.id,
                                AttachmentMetadata.file_type == "JD_PDF")
                        .order_by(AttachmentMetadata.uploaded_at.desc())
                        .first()
                    )
                    if pdf_att and pdf_att.file_data:
                        try:
                            pdf_text = extract_text_from_pdf(pdf_att.file_data)
                            if pdf_text and len(pdf_text) > len(jd_text):
                                jd_text = pdf_text[:20000]
                        except Exception:
                            pass
                    if not jd_text:
                        latest_event = (
                            db.query(CompanyEvent)
                            .filter(CompanyEvent.company_id == company.id,
                                    CompanyEvent.body.isnot(None))
                            .order_by(CompanyEvent.timestamp.asc())
                            .first()
                        )
                        if latest_event and latest_event.body:
                            jd_text = latest_event.body

                    if not jd_text:
                        logging.info(f"[jd-backfill] {company.name}: no JD text found, skipping")
                        continue

                    company.jd_text = jd_text
                    strategy = generate_jd_strategy(
                        jd_text, role=company.role, company_name=company.name
                    )
                    if strategy:
                        company.jd_strategy = strategy
                        db.commit()
                        done += 1
                        logging.info(f"[jd-backfill] {company.name} — strategy saved "
                                     f"(source={strategy.get('strategy_source')})")
                except Exception as e:
                    db.rollback()
                    logging.error(f"[jd-backfill] {company.name} failed: {e}")
            logging.info(f"[jd-backfill] complete — {done} strategies generated.")
        finally:
            db.close()

    threading.Thread(target=_backfill, name="jd-backfill", daemon=True).start()
    return {"status": "started", "message": "JD strategy backfill running in background. Watch logs for progress."}


@app.post("/api/admin/reset-and-reparse")
def admin_reset_and_reparse(request: Request, since: str = "2026-06-29"):
    """
    Admin endpoint: wipe ALL drives (companies + their events, applications,
    states, attachments, notifications) and re-parse the email queue from a
    given date onward. Emails before `since` are marked dead_letter (ignored),
    so update mails whose parent drive predates the window simply park as
    pending events and never surface.

    The normal 5-minute cron then drains the re-queued emails with the current
    parser (grounding guards, thread-reply routing, shortlist processing).
    When INGEST_AUTH_TOKEN is configured, requires 'Authorization: Bearer <token>'.
    """
    if settings.INGEST_AUTH_TOKEN:
        auth_header = request.headers.get("Authorization", "")
        if auth_header != f"Bearer {settings.INGEST_AUTH_TOKEN}":
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})

    import re as _re
    if not _re.match(r"^\d{4}-\d{2}-\d{2}$", since):
        return JSONResponse(status_code=400,
                            content={"detail": "since must be YYYY-MM-DD"})

    from sqlalchemy import text as _text
    from app.core.database import SessionLocal

    is_sqlite = settings.DATABASE_URL.startswith("sqlite")
    # Postgres: prefer the email's own timestamp from the payload; fall back
    # to the ingestion row's created_at when absent/malformed.
    ts_expr = (
        "CASE WHEN payload->>'timestamp' ~ '^\\d{4}-\\d{2}-\\d{2}' "
        "THEN (payload->>'timestamp')::timestamptz ELSE created_at END"
        if not is_sqlite else "created_at"
    )

    db = SessionLocal()
    try:
        counts = {}
        counts["pending_company_events_deleted"] = db.execute(
            _text("DELETE FROM pending_company_events")).rowcount
        counts["companies_deleted"] = db.execute(
            _text("DELETE FROM companies")).rowcount

        counts["jobs_requeued"] = db.execute(_text(f"""
            UPDATE raw_ingestion_jobs
            SET status='pending', retry_count=0, parsed_output=NULL,
                validated_output=NULL, error_message=NULL, locked_at=NULL,
                locked_by=NULL, final_classification=NULL, processed_at=NULL
            WHERE {ts_expr} >= :since
        """), {"since": since}).rowcount

        counts["jobs_ignored_pre_window"] = db.execute(_text(f"""
            UPDATE raw_ingestion_jobs
            SET status='dead_letter',
                error_message='Ignored: email predates the reparse window ({since}).'
            WHERE {ts_expr} < :since AND status != 'dead_letter'
        """), {"since": since}).rowcount

        db.commit()

        try:
            from app.core.redis import bump_companies_list_version, bump_announcements_version
            bump_companies_list_version()
            bump_announcements_version()
        except Exception:
            pass

        logging.warning(f"[reset-and-reparse] since={since} -> {counts}")
        return {
            "status": "ok",
            "since": since,
            **counts,
            "message": "All drives wiped. The queue processor will re-parse the "
                       "window over the next hours (~2-3 min per email). Trigger "
                       "POST /api/gmail/reprocess_all to drain continuously.",
        }
    except Exception as e:
        db.rollback()
        logging.error(f"[reset-and-reparse] failed: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"detail": str(e)})
    finally:
        db.close()


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
