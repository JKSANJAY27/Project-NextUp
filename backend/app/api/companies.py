import logging
from fastapi import APIRouter, Depends, Header, HTTPException, status, File, UploadFile, Form, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
import io
from datetime import datetime

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, StudentProfile, Company, Application, CompanyEvent, Notification, IngestionAuditLog
from app.schemas.schemas import CompanyCreate, CompanyOut, CompanyWithEligibilityOut
from collections import defaultdict
from app.services.eligibility import check_eligibility
from app.services.email_parser import parse_placement_email
from app.services.pdf_extractor import parse_job_description
from app.services.excel_parser import extract_neo_ids_from_excel
from app.services.match_scorer import calculate_match_score
from app.core.security import decrypt_field, encrypt_field
from app.core.redis import (
    get_cache, set_cache, get_companies_list_version, bump_companies_list_version,
    get_company_version, bump_company_version, get_user_version, bump_user_version
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/companies", tags=["companies"])

@router.post("", response_model=CompanyOut)
def create_company(
    company_in: CompanyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    new_company = Company(**company_in.dict())
    db.add(new_company)
    db.commit()
    db.refresh(new_company)
    bump_companies_list_version()
    return new_company

def process_jd_background(company_id: UUID, file_bytes: bytes):
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        company = db.query(Company).filter(Company.id == company_id).first()
        if not company:
            return
            
        parsed = parse_job_description(file_bytes)
        company.jd_text = parsed["jd_text"]
        company.jd_required_skills = parsed["skills"]
        company.jd_ats_keywords = parsed["ats_keywords"]
        db.add(company)
        
        # Recalculate match scores for all applications to this company
        applications = db.query(Application).filter(Application.company_id == company_id).all()
        for app in applications:
            student_profile = db.query(StudentProfile).filter(StudentProfile.user_id == app.user_id).first()
            if student_profile:
                student_cgpa = float(student_profile.cgpa) if student_profile.cgpa is not None else None
                
                rules = company.eligibility_rules or {}
                company_min_cgpa = float(rules.get("min_cgpa")) if rules.get("min_cgpa") else None
                
                score = calculate_match_score(
                    student_skills=student_profile.skills or [],
                    jd_required_skills=company.jd_required_skills or [],
                    student_cgpa=student_cgpa,
                    company_min_cgpa=company_min_cgpa
                )
                app.match_score = score
                db.add(app)
                
        db.commit()
        db.refresh(company)
        bump_company_version(company_id)
        for app in applications:
            bump_user_version(app.user_id)
    except Exception as e:
        logger.error(f"Background JD parsing failed: {str(e)}")
    finally:
        db.close()

def process_shortlist_background(company_id: UUID, file_bytes: bytes, current_user_id: UUID, x_client_key: Optional[str]):
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        extracted_ids = extract_neo_ids_from_excel(file_bytes)
        
        # For background job, we can check for all users if we had access to their keys, 
        # but realistically this endpoint only checks the current_user because of client-side encryption.
        user = db.query(User).filter(User.id == current_user_id).first()
        if not user or not user.profile:
            return
            
        profile = user.profile
        if x_client_key and profile.neo_id_enc:
            try:
                decrypted_neo = decrypt_field(profile.neo_id_enc, x_client_key).upper().strip()
                app = db.query(Application).filter(
                    Application.user_id == current_user_id,
                    Application.company_id == company_id
                ).first()
                
                if decrypted_neo in extracted_ids:
                    if app:
                        app.status = "Shortlisted"
                        app.recruitment_state = "Shortlisted"
                        app.current_round = "Shortlisted"
                    else:
                        app = Application(
                            user_id=current_user_id,
                            company_id=company_id,
                            status="Shortlisted",
                            recruitment_state="Shortlisted",
                            current_round="Shortlisted",
                            match_score=0
                        )
                    db.add(app)
                    db.commit()
                    bump_user_version(current_user_id)
                else:
                    if app and app.status in ('Applied', 'Shortlisted', 'OA', 'Interview'):
                        app.status = "Likely Rejected"
                        db.add(app)
                        db.commit()
                        bump_user_version(current_user_id)
            except Exception as e:
                logger.error(f"Failed to decrypt user neo_id or shortlist check: {str(e)}")
    except Exception as e:
        logger.error(f"Background Shortlist parsing failed: {str(e)}")
    finally:
        db.close()

@router.post("/import")
async def import_placement_file(
    import_type: str = Form(...), # 'email', 'jd', 'shortlist'
    company_id: Optional[UUID] = Form(None),
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    x_client_key: Optional[str] = Header(None, alias="X-Client-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    file_bytes = await file.read()
    
    if import_type == "email":
        # Parse email text
        try:
            email_text = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            email_text = file_bytes.decode("latin-1")
            
        raw_parsed = parse_placement_email(email_text)
        from app.services.validator import validate_and_normalize_parsed_data
        validated = validate_and_normalize_parsed_data(raw_parsed, db)
        ext_data = validated.get("extracted_data", {})
        
        company_name = ext_data.get("company", {}).get("value") or "Unknown Company"
        role_data = ext_data.get("roles", [{}])[0] if ext_data.get("roles") else {}
        role = role_data.get("role", {}).get("value") or "Software Engineer"
        ctc = role_data.get("ctc", {}).get("value")
        stipend = role_data.get("stipend", {}).get("value")
        eligible_branches = role_data.get("eligible_branches", {}).get("value") or []
        min_cgpa = role_data.get("min_cgpa", {}).get("value")
        min_tenth_marks = role_data.get("min_tenth_marks", {}).get("value")
        min_twelfth_marks = role_data.get("min_twelfth_marks", {}).get("value")
        requires_no_arrears = role_data.get("requires_no_arrears", {}).get("value", False)
        
        category = ext_data.get("email_category") or "Regular"
        if category in ("NEW_DRIVE", "DRIVE_UPDATE"):
            category = "Regular"
            
        eligibility_rules = {
            "min_cgpa": min_cgpa,
            "min_tenth_marks": min_tenth_marks,
            "min_twelfth_marks": min_twelfth_marks,
            "requires_no_arrears": requires_no_arrears
        }
        
        deadline_str = ext_data.get("deadline_iso", {}).get("value")
        registration_deadline = None
        if deadline_str:
            try:
                registration_deadline = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
            except Exception:
                pass
                
        new_company = Company(
            name=company_name,
            role=role,
            category=category,
            ctc=ctc,
            stipend=stipend,
            eligible_branches=eligible_branches,
            eligibility_rules=eligibility_rules,
            job_location=ext_data.get("job_location", {}).get("value"),
            registration_deadline=registration_deadline,
            registration_link=ext_data.get("registration_link", {}).get("value"),
            jd_text=email_text
        )
        db.add(new_company)
        db.commit()
        db.refresh(new_company)
        bump_companies_list_version()
        return {"message": "Email imported successfully", "company": new_company}


    elif import_type == "jd":
        if not company_id:
            raise HTTPException(status_code=400, detail="company_id is required for JD imports.")
        
        background_tasks.add_task(process_jd_background, company_id, file_bytes)
        return {"message": "Job description parsing started in background"}


    elif import_type == "shortlist":
        if not company_id:
            raise HTTPException(status_code=400, detail="company_id is required for shortlist imports.")
            
        background_tasks.add_task(process_shortlist_background, company_id, file_bytes, current_user.id, x_client_key)
        
        return {
            "message": "Shortlist parsing started in background"
        }

    else:
        raise HTTPException(status_code=400, detail="Invalid import_type. Must be 'email', 'jd', or 'shortlist'.")

class CachedCompanyMock:
    def __init__(self, eligibility_rules):
        self.eligibility_rules = eligibility_rules

@router.get("", response_model=List[CompanyWithEligibilityOut])
def list_companies(
    skip: int = 0,
    limit: int = 100,
    x_client_key: Optional[str] = Header(None, alias="X-Client-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    list_version = get_companies_list_version()
    cache_key = f"nextup:cache:companies:list:v{list_version}:s{skip}:l{limit}"
    cached_list = get_cache(cache_key)
    
    if cached_list is None:
        companies = db.query(Company).all()
        def get_sort_key(c):
            dt = c.latest_event.timestamp if c.latest_event and c.latest_event.timestamp else c.created_at
            if dt is None:
                return 0.0
            if dt.tzinfo is not None:
                dt = dt.replace(tzinfo=None)
            return dt.timestamp()

        companies = sorted(
            companies,
            key=get_sort_key,
            reverse=True
        )
        
        # Apply pagination after sorting
        paginated_companies = companies[skip : skip + limit]
        
        # Cache raw company data without eligibility check
        cached_list = [CompanyOut.from_orm(company).dict() for company in paginated_companies]
        set_cache(cache_key, cached_list, expire_seconds=600) # 10 min TTL

    results = []
    for company_data in cached_list:
        mock_company = CachedCompanyMock(company_data.get("eligibility_rules"))
        if current_user.profile:
            status, reason, explanation = check_eligibility(current_user.profile, mock_company)
        else:
            status, reason, explanation = "CHECK", "Student profile not set up.", None
        
        # Merge eligibility fields
        comp_res = dict(company_data)
        comp_res["eligibility_status"] = status
        comp_res["eligibility_reason"] = reason
        comp_res["eligibility_explanation"] = explanation
        
        latest_evt = comp_res.get("latest_event")
        if latest_evt and latest_evt.get("parsed_metadata"):
            comp_res["deadline_label"] = latest_evt["parsed_metadata"].get("deadline_label")
        if not comp_res.get("deadline_label") and comp_res.get("registration_deadline"):
            comp_res["deadline_label"] = "Registration Deadline"
            
        results.append(comp_res)
    return results

@router.get("/{id}", response_model=CompanyWithEligibilityOut)
def get_company(
    id: UUID,
    x_client_key: Optional[str] = Header(None, alias="X-Client-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    company_version = get_company_version(id)
    cache_key = f"nextup:cache:company:{id}:v{company_version}"
    cached_company = get_cache(cache_key)
    
    if cached_company is None:
        company = db.query(Company).filter(Company.id == id).first()
        if not company:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Company not found."
            )
        cached_company = CompanyOut.from_orm(company).dict()
        set_cache(cache_key, cached_company, expire_seconds=600) # 10 min TTL

    mock_company = CachedCompanyMock(cached_company.get("eligibility_rules"))
    if current_user.profile:
        status_elig, reason_elig, explanation_elig = check_eligibility(current_user.profile, mock_company)
    else:
        status_elig, reason_elig, explanation_elig = "CHECK", "Student profile not set up.", None
        
    company_res = dict(cached_company)
    company_res["eligibility_status"] = status_elig
    company_res["eligibility_reason"] = reason_elig
    company_res["eligibility_explanation"] = explanation_elig
    
    latest_evt = company_res.get("latest_event")
    if latest_evt and latest_evt.get("parsed_metadata"):
        company_res["deadline_label"] = latest_evt["parsed_metadata"].get("deadline_label")
    if not company_res.get("deadline_label") and company_res.get("registration_deadline"):
        company_res["deadline_label"] = "Registration Deadline"
        
    return company_res


@router.get("/{id}/events")
def get_company_events(
    id: UUID,
    cursor: Optional[datetime] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    comp_version = get_company_version(id)
    user_version = get_user_version(current_user.id)
    cache_key = f"nextup:cache:user:{current_user.id}:company:{id}:events:cv{comp_version}:uv{user_version}:c{cursor}:l{limit}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    query = (
        db.query(CompanyEvent)
        .filter(CompanyEvent.company_id == id)
    )
    if cursor:
        query = query.filter(CompanyEvent.timestamp < cursor)
        
    events = query.order_by(CompanyEvent.timestamp.desc()).limit(limit).all()
    
    event_ids = [e.id for e in events]
    audit_map = defaultdict(dict)
    if event_ids:
        audit_logs = db.query(IngestionAuditLog).filter(IngestionAuditLog.company_event_id.in_(event_ids)).all()
        for log in audit_logs:
            audit_map[log.company_event_id][log.field_name] = float(log.confidence_score) if log.confidence_score else 0.0
            
    notif_map = {}
    if event_ids:
        notifications = db.query(Notification).filter(
            Notification.company_event_id.in_(event_ids),
            Notification.user_id == current_user.id
        ).all()
        for n in notifications:
            notif_map[n.company_event_id] = n.message
            
    results = []
    for e in events:
        results.append({
            "id": str(e.id),
            "company_id": str(e.company_id),
            "event_type": e.event_type,
            "subject": e.subject,
            "sender": e.sender,
            "body": e.body,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
            "confidence_scores": audit_map[e.id],
            "user_notification_msg": notif_map.get(e.id)
        })
        
    set_cache(cache_key, results, expire_seconds=600)
    return results
