from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from uuid import UUID

# Profile Schemas
class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    branch: Optional[str] = None
    batch_year: Optional[int] = None
    neo_id_enc: Optional[str] = None
    neo_id: Optional[str] = None # Plaintext for blind index generation
    cgpa: Optional[float] = None
    tenth_marks: Optional[float] = None
    twelfth_marks: Optional[float] = None
    has_arrears: Optional[bool] = None
    skills: Optional[List[str]] = None

class UserOut(BaseModel):
    id: UUID
    email: str
    role: str
    created_at: datetime
    
    # Profile fields (joined from student_profiles)
    full_name: Optional[str] = None
    branch: Optional[str] = None
    batch_year: Optional[int] = None
    neo_id_enc: Optional[str] = None
    neo_id_hash: Optional[str] = None
    cgpa: Optional[float] = None
    tenth_marks: Optional[float] = None
    twelfth_marks: Optional[float] = None
    has_arrears: Optional[bool] = None
    skills: Optional[List[str]] = None

    class Config:
        from_attributes = True

# Company Schemas
class CompanyCreate(BaseModel):
    name: str
    category: Optional[str] = None
    role: Optional[str] = None
    ctc: Optional[str] = None
    stipend: Optional[str] = None
    job_location: Optional[str] = None
    eligible_branches: Optional[List[str]] = None
    eligibility_rules: Optional[Dict[str, Any]] = None
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
    created_at: datetime

    class Config:
        from_attributes = True

class CompanyWithEligibilityOut(CompanyOut):
    eligibility_status: str  # 'ELIGIBLE', 'NOT_ELIGIBLE'
    eligibility_reason: Optional[str] = None

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
    applied_at: datetime
    notes_enc: Optional[str]
    tailored_resume_enc: Optional[str] = None
    match_score: int
    user_decision: Optional[str]
    recruitment_state: Optional[str]
    last_user_activity_at: datetime
    workspace_priority_override: Optional[str]
    snoozed_until: Optional[datetime]
    priority_score: int = 0
    is_stale: bool = False
    company: CompanyOut

    class Config:
        from_attributes = True

# Notification Schemas
class NotificationOut(BaseModel):
    id: UUID
    user_id: UUID
    company_event_id: UUID
    message: str
    is_read: bool
    notification_type: str
    created_at: datetime

    class Config:
        from_attributes = True

class NotificationDetail(BaseModel):
    id: UUID
    message: str
    is_read: bool
    notification_type: str
    created_at: datetime
    company_event_id: UUID
    
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
