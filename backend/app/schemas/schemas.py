from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from uuid import UUID

# Auth Schemas
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    email_salt: str

class SaltResponse(BaseModel):
    email_salt: str

# Profile Schemas
class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    branch: Optional[str] = None
    batch_year: Optional[int] = None
    neo_id_enc: Optional[str] = None
    cgpa_enc: Optional[str] = None
    tenth_marks_enc: Optional[str] = None
    twelfth_marks_enc: Optional[str] = None
    has_arrears_enc: Optional[str] = None
    skills: Optional[List[str]] = None

class UserOut(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str] = None
    branch: Optional[str] = None
    batch_year: Optional[int] = None
    neo_id_enc: Optional[str] = None
    cgpa_enc: Optional[str] = None
    tenth_marks_enc: Optional[str] = None
    twelfth_marks_enc: Optional[str] = None
    has_arrears_enc: Optional[str] = None
    skills: Optional[List[str]] = None
    gmail_connected: bool
    created_at: datetime

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
    min_cgpa: Optional[float] = None
    min_tenth: Optional[float] = None
    min_twelfth: Optional[float] = None
    requires_no_arrears: Optional[bool] = False
    registration_deadline: Optional[datetime] = None
    visit_date: Optional[datetime] = None
    registration_link: Optional[str] = None
    website: Optional[str] = None
    jd_text: Optional[str] = None
    jd_required_skills: Optional[List[str]] = None
    jd_ats_keywords: Optional[List[str]] = None
    source_email_body: Optional[str] = None
    additional_info: Optional[Dict[str, Any]] = None

class CompanyOut(CompanyCreate):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True

# Eligibility Response
class CompanyWithEligibilityOut(CompanyOut):
    eligibility_status: str  # 'ELIGIBLE', 'NOT_ELIGIBLE', 'CONDITIONALLY_ELIGIBLE'
    eligibility_reason: Optional[str] = None

# Application Schemas
class ApplicationCreate(BaseModel):
    company_id: UUID
    status_enc: str          # Encrypted status e.g. 'Applied'
    current_round: Optional[str] = "Applied"
    notes_enc: Optional[str] = None

class ApplicationUpdate(BaseModel):
    status_enc: Optional[str] = None
    current_round: Optional[str] = None
    notes_enc: Optional[str] = None
    offer_ctc_enc: Optional[str] = None
    outcome_enc: Optional[str] = None

class ApplicationOut(BaseModel):
    id: UUID
    user_id: UUID
    company_id: UUID
    status_enc: Optional[str]
    current_round: Optional[str]
    applied_at: datetime
    notes_enc: Optional[str]
    offer_ctc_enc: Optional[str]
    outcome_enc: Optional[str]
    match_score: int
    updated_at: datetime
    company: CompanyOut

    class Config:
        from_attributes = True

# Notification Schemas
class NotificationOut(BaseModel):
    id: UUID
    user_id: UUID
    message: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True

