from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List
from uuid import UUID

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Announcement
from app.schemas.schemas import AnnouncementOut
from app.core.redis import get_cache, set_cache, get_announcements_version

router = APIRouter(prefix="/announcements", tags=["announcements"])

@router.get("", response_model=List[AnnouncementOut])
def get_announcements(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch all announcements, ordered by created_at desc."""
    version = get_announcements_version()
    cache_key = f"nextup:cache:global:announcements:v{version}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    announcements = (
        db.query(Announcement)
        .options(joinedload(Announcement.attachments))
        .order_by(Announcement.created_at.desc())
        .all()
    )
    # Serialize to dict list using schema helper
    serialized = [AnnouncementOut.from_orm(ann).dict() for ann in announcements]
    set_cache(cache_key, serialized, expire_seconds=1800) # 30 min TTL
    return serialized

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
        
    if attachment.file_data:
        from fastapi import Response
        media_type = "application/pdf" if attachment.file_name.lower().endswith('.pdf') else "application/octet-stream"
        return Response(content=attachment.file_data, media_type=media_type, headers={"Content-Disposition": f"inline; filename=\"{attachment.file_name}\""})

    storage_dir = "storage"
    file_path = os.path.join(storage_dir, attachment.storage_path)
    if not os.path.exists(file_path):
         raise HTTPException(status_code=404, detail=f"File not found on disk at {file_path}")
         
    return FileResponse(file_path, filename=attachment.file_name)
