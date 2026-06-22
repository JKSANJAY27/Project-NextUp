from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List
from uuid import UUID

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Announcement
from app.schemas.schemas import AnnouncementOut

router = APIRouter(prefix="/announcements", tags=["announcements"])

@router.get("", response_model=List[AnnouncementOut])
def get_announcements(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch all announcements, ordered by created_at desc."""
    announcements = (
        db.query(Announcement)
        .options(joinedload(Announcement.attachments))
        .order_by(Announcement.created_at.desc())
        .all()
    )
    return announcements

@router.get("/{announcement_id}", response_model=AnnouncementOut)
def get_announcement(
    announcement_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch a single announcement by ID."""
    announcement = (
        db.query(Announcement)
        .options(joinedload(Announcement.attachments))
        .filter(Announcement.id == announcement_id)
        .first()
    )
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return announcement

@router.get("/attachment/{attachment_id}")
def download_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Serve/download the specified attachment from local storage."""
    from app.models.models import AttachmentMetadata
    from fastapi.responses import FileResponse
    import os

    attachment = db.query(AttachmentMetadata).filter(AttachmentMetadata.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
        
    storage_dir = "storage"
    file_path = os.path.join(storage_dir, attachment.storage_path)
    if not os.path.exists(file_path):
         raise HTTPException(status_code=404, detail=f"File not found on disk at {file_path}")
         
    return FileResponse(file_path, filename=attachment.file_name)
