"""
bootstrap.py — API Router for Historical Bootstrap
===================================================
Endpoints:
  GET  /api/users/me/bootstrap-status  — Status of the current user's bootstrap job
  POST /api/bootstrap/cancel           — Cancel an active bootstrap job
  POST /api/admin/bootstrap/{id}/retry — Admin retry for completed_with_errors jobs
"""

import logging
from datetime import datetime
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, BootstrapJob, BootstrapJobProgress

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bootstrap", tags=["bootstrap"])


@router.get("/status", response_model=Any)
def get_user_bootstrap_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get the status of the most recent BootstrapJob for the authenticated user.
    Frontend polls this endpoint during onboarding instead of thrashing /applications.
    """
    job = (
        db.query(BootstrapJob)
        .filter(BootstrapJob.user_id == current_user.id)
        .order_by(BootstrapJob.created_at.desc())
        .first()
    )

    if not job:
        return {
            "has_job": False,
            "status": "none",
            "progress_percent": 100,
            "total_companies": 0,
            "processed_count": 0,
            "suggested_count": 0,
            "archived_count": 0,
            "failed_count": 0,
            "started_at": None,
            "completed_at": None,
        }

    pct = 0
    if job.total_companies > 0:
        pct = min(100, int((job.processed_count / job.total_companies) * 100))
    elif job.status in ("completed", "completed_with_errors"):
        pct = 100

    return {
        "has_job": True,
        "job_id": str(job.id),
        "status": job.status,
        "trigger": job.trigger,
        "progress_percent": pct,
        "total_companies": job.total_companies,
        "processed_count": job.processed_count,
        "suggested_count": job.suggested_count,
        "archived_count": job.archived_count,
        "failed_count": job.failed_count,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error_message": job.error_message,
    }


@router.post("/cancel", response_model=Any)
def cancel_bootstrap_job(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Cancel an active or pending BootstrapJob for the authenticated user.
    """
    job = (
        db.query(BootstrapJob)
        .filter(
            BootstrapJob.user_id == current_user.id,
            BootstrapJob.status.in_(["pending", "running"]),
        )
        .first()
    )

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending or running bootstrap job found.",
        )

    job.status = "cancelled"
    job.cancelled_at = datetime.utcnow()
    job.error_message = "Cancelled by user"
    db.commit()

    return {"status": "cancelled", "job_id": str(job.id)}


@router.post("/admin/{target_user_id}/retry", response_model=Any)
def retry_failed_bootstrap_job(
    target_user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Admin retry for a completed_with_errors or failed BootstrapJob.

    Selective retry semantics: sets job.status back to 'pending'.
    The worker will preserve completed/skipped progress records and ONLY
    re-process company records marked with status='failed'.
    """
    if current_user.role not in ("admin", "superuser"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )

    job = (
        db.query(BootstrapJob)
        .filter(BootstrapJob.user_id == target_user_id)
        .order_by(BootstrapJob.created_at.desc())
        .first()
    )

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No bootstrap job found for user.",
        )

    if job.status not in ("completed_with_errors", "failed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job status is '{job.status}'. Only 'completed_with_errors' or 'failed' jobs can be retried.",
        )

    # Reset progress status for failed company records so they get re-processed
    failed_progress = (
        db.query(BootstrapJobProgress)
        .filter(
            BootstrapJobProgress.bootstrap_job_id == job.id,
            BootstrapJobProgress.status == "failed",
        )
        .all()
    )
    for fp in failed_progress:
        fp.status = "pending"
        fp.outcome = None

    job.status = "pending"
    job.failed_count = 0
    job.error_message = None
    db.commit()

    return {
        "status": "pending",
        "job_id": str(job.id),
        "requeued_company_count": len(failed_progress),
    }
