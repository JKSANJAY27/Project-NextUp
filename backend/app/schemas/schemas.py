from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import List, Optional, Dict, Any
from datetime import datetime
from uuid import UUID

# Profile Schemas
class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    branch: Optional[str] = None
    degree_type: Optional[str] = None
    specialization: Optional[str] = None
    batch_year: Optional[int] = None
    neo_id_enc: Optional[str] = None
    neo_id: Optional[str] = None # Plaintext for blind index generation
    cgpa: Optional[float] = None
    tenth_marks: Optional[float] = None
    twelfth_marks: Optional[float] = None
    has_arrears: Optional[bool] = None
    ug_cgpa: Optional[float] = None
    skills: Optional[List[str]] = None

class UserOut(BaseModel):
    id: UUID
    email: str
    role: str
    created_at: datetime
    
    # Profile fields (joined from student_profiles)
    full_name: Optional[str] = None
    branch: Optional[str] = None
    degree_type: Optional[str] = None
    specialization: Optional[str] = None
    batch_year: Optional[int] = None
    neo_id_enc: Optional[str] = None
    neo_id_hash: Optional[str] = None
    cgpa: Optional[float] = None
    tenth_marks: Optional[float] = None
    twelfth_marks: Optional[float] = None
    has_arrears: Optional[bool] = None
    ug_cgpa: Optional[float] = None
    skills: Optional[List[str]] = None

    class Config:
        from_attributes = True

# Company Schemas
class LatestEventSchema(BaseModel):
    id: UUID
    event_type: str
    subject: str
    timestamp: Optional[datetime] = None
    parsed_metadata: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

class CompanyCreate(BaseModel):
    name: str
    category: Optional[str] = None
    role: Optional[str] = None
    ctc: Optional[str] = None
    stipend: Optional[str] = None
    job_location: Optional[str] = None
    eligible_branches: Optional[List[str]] = None
    eligibility_rules: Optional[Dict[str, Any]] = None
    eligibility_raw_text: Optional[str] = None
    registration_deadline: Optional[datetime] = None
    registration_link: Optional[str] = None
    website: Optional[str] = None
    jd_text: Optional[str] = None
    jd_required_skills: Optional[List[str]] = None
    jd_preferred_skills: Optional[List[str]] = None
    jd_ats_keywords: Optional[List[str]] = None
    interview_topics: Optional[List[str]] = None
    recruitment_cycle: Optional[str] = "Default"

class CompanyOut(CompanyCreate):
    id: UUID
    created_at: Optional[datetime] = None
    latest_event: Optional[LatestEventSchema] = None
    # Label for registration_deadline (which is effective_deadline: the next
    # crucial date — registration, then OA/PPT/interview once it passes).
    deadline_label: Optional[str] = None
    # Multi-role drives: [{"role", "ctc", "stipend", "jd_text", ...}] — the
    # resume tailor lets the student pick which role's JD to target.
    roles: Optional[List[dict]] = None
    # Manual drive flag — True if created by the user, not by email parsing.
    is_manual: bool = False
    created_by_user_id: Optional[UUID] = None

    @field_validator("roles", mode="before")
    @classmethod
    def _trim_role_entries(cls, v):
        """Strip the cached jd_strategy blob — server-side only, bloats payloads."""
        if not v:
            return v
        return [
            {k: r.get(k) for k in ("role", "ctc", "stipend", "jd_text")
             if r.get(k) is not None}
            if isinstance(r, dict) else r
            for r in v
        ]

    class Config:
        from_attributes = True


# Manual drive creation — called by the frontend "Manual Drive Announcement" form.
class ManualDriveCreate(BaseModel):
    name: str
    category: str = "Regular"
    role: str
    ctc: Optional[str] = None
    stipend: Optional[str] = None
    job_location: Optional[str] = None
    eligible_branches: Optional[List[str]] = None
    min_cgpa: Optional[float] = None
    requires_no_arrears: bool = False
    registration_deadline: Optional[datetime] = None
    registration_link: Optional[str] = None
    jd_text: Optional[str] = None


# User-logged update on a manual drive (adds a CompanyEvent + updates Application state).
class ManualUpdateCreate(BaseModel):
    stage: str   # ONLINE_ASSESSMENT | TECHNICAL_INTERVIEW | HR_INTERVIEW | OFFER | REJECTION | GENERAL_UPDATE
    date: Optional[datetime] = None
    notes: Optional[str] = None
    result: Optional[str] = None  # "PASS" | "FAIL" | None (still pending)



class EligibilityExplanation(BaseModel):
    # None = UNKNOWN verdict (restricted/criteria-less drives). A strict bool
    # here made FastAPI's response validation 500 on any UNKNOWN company, and
    # that unhandled 500 bypasses CORSMiddleware — surfacing in the browser as
    # a bogus CORS error on /api/companies.
    eligible: Optional[bool] = None
    matched: List[str] = []
    failed: List[str] = []
    unverified: List[str] = []

class CompanyWithEligibilityOut(CompanyOut):
    eligibility_status: str  # 'ELIGIBLE', 'NOT_ELIGIBLE'
    eligibility_reason: Optional[str] = None
    eligibility_explanation: Optional[EligibilityExplanation] = None
    # Dynamic deadline label derived from the latest update event (e.g., "OA Deadline",
    # "Registration Deadline"). Sent from the API so the frontend can display it correctly.
    deadline_label: Optional[str] = None

# Application Schemas
class ApplicationCreate(BaseModel):
    company_id: UUID
    status: str
    current_round: Optional[str] = "Applied"
    notes_enc: Optional[str] = None
    tailored_resume_enc: Optional[str] = None
    user_decision: Optional[str] = "tracking"
    recruitment_state: Optional[str] = "Registration"
    workspace_priority_override: Optional[str] = None
    snoozed_until: Optional[datetime] = None

class ApplicationUpdate(BaseModel):
    status: Optional[str] = None
    current_round: Optional[str] = None
    notes_enc: Optional[str] = None
    tailored_resume_enc: Optional[str] = None
    user_decision: Optional[str] = None
    recruitment_state: Optional[str] = None
    workspace_priority_override: Optional[str] = None
    snoozed_until: Optional[datetime] = None

class ApplicationOut(BaseModel):
    id: UUID
    user_id: UUID
    company_id: UUID
    status: Optional[str]
    current_round: Optional[str]
    applied_at: Optional[datetime] = None
    notes_enc: Optional[str]
    tailored_resume_enc: Optional[str] = None
    match_score: int
    user_decision: Optional[str]
    recruitment_state: Optional[str]
    last_user_activity_at: Optional[datetime] = None
    workspace_priority_override: Optional[str]
    snoozed_until: Optional[datetime]
    priority_score: int = 0
    is_stale: bool = False
    company: CompanyOut

    class Config:
        from_attributes = True

class OpportunityStateOut(BaseModel):
    record_type: str = "opportunity_state"
    company_id: UUID
    state: str  # unseen, tracking, decision_pending, archived, auto_archived
    archive_reason: Optional[str] = None
    archived_at: Optional[datetime] = None
    decision_pending_since: Optional[datetime] = None
    snoozed_until: Optional[datetime] = None
    previous_state: Optional[str] = None
    updated_at: Optional[datetime] = None
    # Minimal company info for display
    company: Optional[CompanyOut] = None

    class Config:
        from_attributes = True

# Notification Schemas
class NotificationOut(BaseModel):
    id: UUID
    user_id: UUID
    company_event_id: Optional[UUID] = None
    message: str
    is_read: bool
    notification_type: str
    severity: int = 1  # 1=low, 3=medium, 4=high, 5=critical
    notification_scope: str = "ACTIVE"
    expires_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class NotificationDetail(BaseModel):
    id: UUID
    message: str
    is_read: bool
    notification_type: str
    severity: int = 1
    created_at: Optional[datetime] = None
    company_event_id: Optional[UUID] = None
    notification_scope: str = "ACTIVE"
    expires_at: Optional[datetime] = None
    company_id: Optional[UUID] = None
    
    # Source Event Fields
    subject: Optional[str] = None
    sender: Optional[str] = None
    body: Optional[str] = None
    timestamp: Optional[datetime] = None
    
    # Parser confidence scores
    confidence_scores: Dict[str, float] = {}

    class Config:
        from_attributes = True

class NotificationBundle(BaseModel):
    company_id: UUID
    company_name: str
    role: str
    category: str
    unread_count: int
    notifications: List[NotificationDetail]

# Calendar Event Schemas
class CalendarEventCreate(BaseModel):
    title: str
    event_type: str  # 'registration_deadline', 'online_assessment', 'interview', 'offer_result', 'manual'
    date: datetime
    location_platform: Optional[str] = None
    notes: Optional[str] = None
    company_id: Optional[UUID] = None

class CalendarEventUpdate(BaseModel):
    title: Optional[str] = None
    event_type: Optional[str] = None
    date: Optional[datetime] = None
    location_platform: Optional[str] = None
    notes: Optional[str] = None
    company_id: Optional[UUID] = None
    completed: Optional[bool] = None

class CalendarEventOut(BaseModel):
    id: UUID
    user_id: UUID
    company_id: Optional[UUID] = None
    company_event_id: Optional[UUID] = None
    title: str
    company_name: Optional[str] = None
    role: Optional[str] = None
    event_type: str
    date: datetime
    location_platform: Optional[str] = None
    notes: Optional[str] = None
    completed: bool
    is_manual: bool
    is_deleted: bool
    is_user_modified: bool
    source: str
    source_key: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    @field_validator("date", "created_at", "updated_at", mode="before")
    @classmethod
    def ensure_utc_iso(cls, v):
        if isinstance(v, datetime):
            from datetime import timezone
            if v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            return v
        return v

    class Config:
        from_attributes = True

class AttachmentMetadataOut(BaseModel):
    id: UUID
    file_name: str
    file_type: str
    storage_path: Optional[str] = None
    parsed_meta: Optional[Dict[str, Any]] = None
    uploaded_at: datetime

    class Config:
        from_attributes = True

class AnnouncementOut(BaseModel):
    id: UUID
    title: str
    body: str
    announcement_type: str
    deadline: Optional[datetime] = None
    source_email_id: Optional[str] = None
    created_at: datetime
    attachments: List[AttachmentMetadataOut] = []

    class Config:
        from_attributes = True
