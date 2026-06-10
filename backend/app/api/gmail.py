import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.services.gmail_sync import process_queued_jobs

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gmail", tags=["gmail"])

class JobTrigger(BaseModel):
    job_id: Optional[str] = None

@router.post("/process")
def process_job(trigger: JobTrigger, db: Session = Depends(get_db)):
    """
    Triggered by Supabase Edge Function to process a specific raw ingestion job or the next pending job.
    """
    success = process_queued_jobs(db, job_id=trigger.job_id)
    if success:
        return {"status": "success", "message": f"Processed job {trigger.job_id if trigger.job_id else 'next pending'}"}
    else:
        return {"status": "idle", "message": "No pending jobs found."}

@router.post("/sync")
def trigger_sync(db: Session = Depends(get_db)):
    """
    Manually triggers the queue processor to run and process the next pending job.
    """
    success = process_queued_jobs(db)
    if success:
        return {"status": "success", "message": "Successfully processed next pending job."}
    else:
        return {"status": "idle", "message": "No pending jobs in the queue."}
