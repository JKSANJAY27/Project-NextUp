import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Numeric, Boolean, DateTime, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    role = Column(String, default="student")
    created_at = Column(DateTime, default=datetime.utcnow)

    profile = relationship("StudentProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    resumes = relationship("Resume", back_populates="user", cascade="all, delete-orphan")
    applications = relationship("Application", back_populates="user", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")

class StudentProfile(Base):
    __tablename__ = "student_profiles"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    full_name = Column(String, nullable=False)
    branch = Column(String, nullable=False)
    batch_year = Column(Integer, nullable=False)
    neo_id_enc = Column(String, nullable=False)
    neo_id_hash = Column(String(64), unique=True, nullable=False, index=True)
    cgpa = Column(Numeric(4, 2), nullable=False)
    tenth_marks = Column(Numeric(5, 2), nullable=False)
    twelfth_marks = Column(Numeric(5, 2), nullable=False)
    has_arrears = Column(Boolean, default=False)
    skills = Column(ARRAY(String), default=list)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="profile")

class Resume(Base):
    __tablename__ = "resumes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    latex_template = Column(String, default="Classic")
    resume_json_enc = Column(String, nullable=False)
    skills = Column(ARRAY(String), default=list)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="resumes")

class Company(Base):
    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)
    category = Column(String, nullable=False)
    ctc = Column(String)
    stipend = Column(String)
    job_location = Column(String)
    eligible_branches = Column(ARRAY(String), default=list)
    eligibility_rules = Column(JSON, default=dict)
    registration_deadline = Column(DateTime)
    registration_link = Column(String)
    website = Column(String)
    jd_text = Column(String)
    jd_required_skills = Column(ARRAY(String), default=list)
    jd_ats_keywords = Column(ARRAY(String), default=list)
    recruitment_cycle = Column(String, default="Default")
    fingerprint = Column(String(64), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    applications = relationship("Application", back_populates="company", cascade="all, delete-orphan")
    events = relationship("CompanyEvent", back_populates="company", cascade="all, delete-orphan")
    change_logs = relationship("CompanyChangeLog", back_populates="company", cascade="all, delete-orphan")

class CompanyChangeLog(Base):
    __tablename__ = "company_change_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    field_name = Column(String, nullable=False)
    old_value = Column(String)
    new_value = Column(String)
    changed_at = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="change_logs")

class CompanyEvent(Base):
    __tablename__ = "company_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String, nullable=False)  # 'REGISTRATION', 'SHORTLIST', 'OA', 'INTERVIEW', 'OFFER'
    subject = Column(String)
    sender = Column(String)
    body = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="events")
    attachments = relationship("AttachmentMetadata", back_populates="company_event", cascade="all, delete-orphan")
    notification_jobs = relationship("NotificationJob", back_populates="company_event", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="company_event", cascade="all, delete-orphan")

class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint('user_id', 'company_id', name='uq_application_user_company'),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, default="Applied")
    current_round = Column(String, default="Applied")
    notes_enc = Column(String)
    match_score = Column(Integer, default=0)
    applied_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="applications")
    company = relationship("Company", back_populates="applications")

class AttachmentMetadata(Base):
    __tablename__ = "attachments_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_event_id = Column(UUID(as_uuid=True), ForeignKey("company_events.id", ondelete="CASCADE"), nullable=False)
    file_name = Column(String, nullable=False)
    file_type = Column(String, nullable=False)  # 'JD_PDF', 'SHORTLIST_EXCEL'
    storage_path = Column(String)
    parsed_meta = Column(JSON)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    company_event = relationship("CompanyEvent", back_populates="attachments")

class IngestionAuditLog(Base):
    __tablename__ = "ingestion_audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_event_id = Column(UUID(as_uuid=True), ForeignKey("company_events.id", ondelete="CASCADE"), nullable=False)
    field_name = Column(String, nullable=False)
    original_text = Column(String)
    parsed_value = Column(String)
    confidence_score = Column(Numeric(5, 2))
    status = Column(String, default="pending")

class NotificationJob(Base):
    __tablename__ = "notification_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_event_id = Column(UUID(as_uuid=True), ForeignKey("company_events.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime)

    company_event = relationship("CompanyEvent", back_populates="notification_jobs")

class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint('user_id', 'company_event_id', name='uq_notification_user_event'),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    company_event_id = Column(UUID(as_uuid=True), ForeignKey("company_events.id", ondelete="CASCADE"), nullable=False)
    message = Column(String, nullable=False)
    is_read = Column(Boolean, default=False)
    notification_type = Column(String, default="company_update")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="notifications")
    company_event = relationship("CompanyEvent", back_populates="notifications")

class RawIngestionJob(Base):
    __tablename__ = "raw_ingestion_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(UUID(as_uuid=True), ForeignKey("ingestion_sources.id", ondelete="SET NULL"))
    status = Column(String, default="pending")
    payload = Column(JSON, nullable=False)
    retry_count = Column(Integer, default=0)
    locked_at = Column(DateTime)
    locked_by = Column(String)
    error_message = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime)

    source = relationship("IngestionSource", back_populates="jobs")

class IngestionSource(Base):
    __tablename__ = "ingestion_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_name = Column(String, nullable=False)
    department = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
    expected_sync_interval_minutes = Column(Integer, default=1440)
    last_sync = Column(DateTime)
    error_log = Column(String)

    jobs = relationship("RawIngestionJob", back_populates="source")
