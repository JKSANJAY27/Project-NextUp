import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.core.ratelimit import rate_limit
from app.services.gmail_sync import process_queued_jobs, process_all_jobs_loop

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gmail", tags=["gmail"])

class JobTrigger(BaseModel):
    job_id: Optional[str] = None


def require_ingest_token(request: Request):
    """These triggers start multi-minute LLM parses — they must not be an open
    DoS surface. Same policy as the admin endpoints: when INGEST_AUTH_TOKEN is
    configured the caller must present it (the Edge Function webhook sends it)."""
    if settings.INGEST_AUTH_TOKEN:
        auth_header = request.headers.get("Authorization", "")
        if auth_header != f"Bearer {settings.INGEST_AUTH_TOKEN}":
            raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/process")
def process_job(trigger: JobTrigger, db: Session = Depends(get_db),
                _auth: None = Depends(require_ingest_token),
                _rl: None = Depends(rate_limit("gmail_trigger", 30, 300))):
    """
    Triggered by Supabase Edge Function to process a specific raw ingestion job or the next pending job.
    """
    success = process_queued_jobs(db, job_id=trigger.job_id)
    if success:
        return {"status": "success", "message": f"Processed job {trigger.job_id if trigger.job_id else 'next pending'}"}
    else:
        return {"status": "idle", "message": "No pending jobs found."}

@router.post("/sync")
def trigger_sync(db: Session = Depends(get_db),
                 _auth: None = Depends(require_ingest_token),
                 _rl: None = Depends(rate_limit("gmail_trigger", 30, 300))):
    """
    Manually triggers the queue processor to run and process the next pending job.
    """
    success = process_queued_jobs(db)
    if success:
        return {"status": "success", "message": "Successfully processed next pending job."}
    else:
        return {"status": "idle", "message": "No pending jobs in the queue."}

@router.post("/reprocess_all")
def trigger_reprocess_all(background_tasks: BackgroundTasks,
                          _auth: None = Depends(require_ingest_token),
                          _rl: None = Depends(rate_limit("gmail_reprocess", 4, 600))):
    """
    Triggers batch reprocessing of all pending jobs in a background thread inside the container.
    """
    background_tasks.add_task(process_all_jobs_loop)
    return {"status": "success", "message": "Batch reprocessing started in the background."}
