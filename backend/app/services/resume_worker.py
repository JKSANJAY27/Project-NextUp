import time
import logging
import threading
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import AiGenerationJob
from app.services.resume_pipeline import ResumeGenerationPipeline

logger = logging.getLogger("nextup.resume_worker")

class ResumeWorker:
    def __init__(self):
        self._stop_event = threading.Event()
        self._thread = None
        self._executor = None

    def start(self):
        if not settings.RESUME_WORKER_ENABLED:
            logger.info("Resume worker is disabled by settings.")
            return

        if self._thread is not None and self._thread.is_alive():
            logger.warning("Resume worker thread is already running.")
            return

        self._stop_event.clear()
        self._executor = ThreadPoolExecutor(
            max_workers=settings.RESUME_WORKER_CONCURRENCY,
            thread_name_prefix="resume-worker-task"
        )
        self._thread = threading.Thread(target=self._run_loop, name="resume-worker", daemon=True)
        self._thread.start()
        logger.info("Resume worker background thread started.")

    def stop(self):
        logger.info("Stopping resume worker...")
        self._stop_event.set()
        if self._executor:
            self._executor.shutdown(wait=False)
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("Resume worker stopped.")

    def _run_loop(self):
        while not self._stop_event.is_set():
            db = SessionLocal()
            try:
                # 1. Recover stale jobs
                self._recover_stale_jobs(db)

                # 2. Poll for queued jobs
                # Use SKIP LOCKED for PG or standard fetch for SQLite
                is_sqlite = "sqlite" in settings.DATABASE_URL.lower()
                if is_sqlite:
                    # SQLite: Fetch one job and lock it
                    job = db.query(AiGenerationJob).filter(
                        AiGenerationJob.status == "queued"
                    ).order_by(AiGenerationJob.created_at.asc()).first()
                else:
                    # PG: FOR UPDATE SKIP LOCKED
                    job = db.query(AiGenerationJob).filter(
                        AiGenerationJob.status == "queued"
                    ).order_by(AiGenerationJob.created_at.asc()).with_for_update(skip_locked=True).first()

                if job:
                    # Lock and set status to processing
                    job.status = "processing"
                    db.commit()
                    job_id = job.id
                    logger.info(f"Picked up resume generation job {job_id} for processing.")

                    # Submit to thread pool
                    self._executor.submit(self._process_job_safe, job_id)
                else:
                    # No jobs, sleep
                    time.sleep(settings.RESUME_WORKER_POLL_SECONDS)

            except Exception as e:
                logger.error(f"Error in resume worker poll loop: {e}", exc_info=True)
                time.sleep(5)
            finally:
                db.close()

    def _recover_stale_jobs(self, db: Session):
        stale_limit = datetime.utcnow() - timedelta(minutes=settings.RESUME_JOB_STALE_MINUTES)
        stale_jobs = db.query(AiGenerationJob).filter(
            AiGenerationJob.status == "processing",
            AiGenerationJob.created_at < stale_limit
        ).all()

        if stale_jobs:
            logger.warning(f"Found {len(stale_jobs)} stale resume generation jobs. Recovering...")
            for job in stale_jobs:
                if job.retry_count < settings.RESUME_JOB_MAX_RETRIES:
                    job.status = "queued"
                    job.retry_count += 1
                    job.error_message = f"Stale job timeout. Retrying attempt {job.retry_count}."
                    logger.info(f"Resetting stale job {job.id} back to queued.")
                else:
                    job.status = "failed"
                    job.error_message = "Stale job timeout. Exceeded max retry limit."
                    job.completed_at = datetime.utcnow()
                    logger.error(f"Failing stale job {job.id} permanently.")
            db.commit()

    def _process_job_safe(self, job_id):
        db = SessionLocal()
        try:
            pipeline = ResumeGenerationPipeline(db, job_id)
            pipeline.run()
        except Exception as e:
            logger.error(f"Failed to process job {job_id}: {e}", exc_info=True)
            # Mark job as failed in db
            try:
                job = db.query(AiGenerationJob).filter(AiGenerationJob.id == job_id).first()
                if job:
                    job.status = "failed"
                    job.error_message = str(e)
                    job.completed_at = datetime.utcnow()
                    db.commit()
            except Exception as db_err:
                logger.error(f"Failed to update failed status for job {job_id}: {db_err}")
        finally:
            db.close()

# Singleton worker instance
worker = ResumeWorker()
