import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Numeric, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator, CHAR
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from app.core.database import Base

class GUID(TypeDecorator):
    """Platform-independent GUID type.
    Uses PostgreSQL's UUID type, otherwise CHAR(36), storing as string.
    """
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID())
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == "postgresql":
            return str(value)
        else:
            if not isinstance(value, uuid.UUID):
                return str(uuid.UUID(value))
            return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        else:
            if not isinstance(value, uuid.UUID):
                return uuid.UUID(value)
            return value

class User(Base):
    __tablename__ = "users"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    email_salt = Column(String, nullable=False)
    neo_id_enc = Column(String, nullable=True)
    full_name = Column(String, nullable=True)
    branch = Column(String, nullable=True)
    batch_year = Column(Integer, nullable=True)
    cgpa_enc = Column(String, nullable=True)
    tenth_marks_enc = Column(String, nullable=True)
    twelfth_marks_enc = Column(String, nullable=True)
    has_arrears_enc = Column(String, nullable=True)  # Stored as ciphertext string
    skills = Column(JSON, nullable=True)             # Plaintext array of skill strings
    gmail_connected = Column(Boolean, default=False)
    gmail_token_enc = Column(String, nullable=True)
    gmail_last_synced = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    applications = relationship("Application", back_populates="user", cascade="all, delete-orphan")
    resumes = relationship("Resume", back_populates="user", cascade="all, delete-orphan")

class Company(Base):
    __tablename__ = "companies"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False, index=True)
    category = Column(String, nullable=True) # Dream, Super Dream, Mass Recruiter, Internship etc.
    role = Column(String, nullable=True)
    ctc = Column(String, nullable=True)
    stipend = Column(String, nullable=True)
    job_location = Column(String, nullable=True)
    eligible_branches = Column(JSON, nullable=True) # ["CSE", "IT", "ECE"]
    min_cgpa = Column(Numeric(4, 2), nullable=True)
    min_tenth = Column(Numeric(5, 2), nullable=True)
    min_twelfth = Column(Numeric(5, 2), nullable=True)
    requires_no_arrears = Column(Boolean, default=False)
    registration_deadline = Column(DateTime, nullable=True)
    visit_date = Column(DateTime, nullable=True)
    registration_link = Column(String, nullable=True)
    website = Column(String, nullable=True)
    jd_text = Column(String, nullable=True)
    jd_required_skills = Column(JSON, nullable=True)
    jd_ats_keywords = Column(JSON, nullable=True)
    source_email_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    applications = relationship("Application", back_populates="company", cascade="all, delete-orphan")
    experiences = relationship("InterviewExperience", back_populates="company", cascade="all, delete-orphan")

class Application(Base):
    __tablename__ = "applications"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    company_id = Column(GUID, ForeignKey("companies.id"), nullable=False)
    status_enc = Column(String, nullable=True)     # Ciphertext: 'Applied', 'Shortlisted', 'OA', etc.
    current_round = Column(String, nullable=True)  # Plaintext round name
    applied_at = Column(DateTime, default=datetime.utcnow)
    notes_enc = Column(String, nullable=True)      # Ciphertext
    offer_ctc_enc = Column(String, nullable=True)  # Ciphertext
    outcome_enc = Column(String, nullable=True)    # Ciphertext
    match_score = Column(Integer, default=0)       # Plaintext
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="applications")
    company = relationship("Company", back_populates="applications")
    round_events = relationship("RoundEvent", back_populates="application", cascade="all, delete-orphan")

class RoundEvent(Base):
    __tablename__ = "round_events"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    application_id = Column(GUID, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False)
    round_name = Column(String, nullable=True)      # Plaintext
    scheduled_at = Column(DateTime, nullable=True)
    platform = Column(String, nullable=True)
    status = Column(String, nullable=True)          # upcoming, completed, skipped
    result_enc = Column(String, nullable=True)      # Ciphertext
    notes_enc = Column(String, nullable=True)       # Ciphertext

    application = relationship("Application", back_populates="round_events")

class Resume(Base):
    __tablename__ = "resumes"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    resume_json_enc = Column(String, nullable=True) # Ciphertext
    latex_template = Column(String, default="Classic")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="resumes")

class InterviewExperience(Base):
    __tablename__ = "interview_experiences"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    company_id = Column(GUID, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    batch_year = Column(Integer, nullable=True)
    role = Column(String, nullable=True)
    rounds = Column(JSON, nullable=True)            # Plaintext list of round info
    overall_difficulty = Column(String, nullable=True) # easy, medium, hard
    selected = Column(Boolean, default=False)
    submitted_at = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="experiences")
