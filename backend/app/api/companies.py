from fastapi import APIRouter, Depends, Header, HTTPException, status, File, UploadFile, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
import io

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
    return new_company

@router.post("/import")
async def import_placement_file(
    import_type: str = Form(...), # 'email', 'jd', 'shortlist'
    company_id: Optional[UUID] = Form(None),
    file: UploadFile = File(...),
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
            
        parsed = parse_placement_email(email_text)
        
        # Set up eligibility rules JSONB
        eligibility_rules = {
            "min_cgpa": parsed.get("min_cgpa"),
            "min_tenth_marks": None,
            "min_twelfth_marks": None,
            "requires_no_arrears": parsed.get("requires_no_arrears", False)
        }
        
        # Create company
        new_company = Company(
            name=parsed["company"],
            role=parsed["role"],
            category=parsed["category"],
            ctc=parsed["ctc"],
            stipend=parsed["stipend"],
            eligible_branches=parsed.get("eligible_branches"),
            eligibility_rules=eligibility_rules,
            job_location=parsed.get("job_location"),
            registration_deadline=parsed.get("deadline_iso"),
            registration_link=parsed.get("registration_link"),
            jd_text=parsed.get("jd_text")
        )
        db.add(new_company)
        db.commit()
        db.refresh(new_company)
        return {"message": "Email imported successfully", "company": new_company}

    elif import_type == "jd":
        if not company_id:
            raise HTTPException(status_code=400, detail="company_id is required for JD imports.")
        company = db.query(Company).filter(Company.id == company_id).first()
        if not company:
            raise HTTPException(status_code=404, detail="Company not found.")
            
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
        return {"message": "Job description parsed and matched successfully", "skills_extracted": company.jd_required_skills}

    elif import_type == "shortlist":
        if not company_id:
            raise HTTPException(status_code=400, detail="company_id is required for shortlist imports.")
        company = db.query(Company).filter(Company.id == company_id).first()
        if not company:
            raise HTTPException(status_code=404, detail="Company not found.")
            
        extracted_ids = extract_neo_ids_from_excel(file_bytes)
        
        # Check if current user is in the shortlist
        is_shortlisted = False
        profile = current_user.profile
        if x_client_key and profile and profile.neo_id_enc:
            try:
                decrypted_neo = decrypt_field(profile.neo_id_enc, x_client_key).upper().strip()
                app = db.query(Application).filter(
                    Application.user_id == current_user.id,
                    Application.company_id == company_id
                ).first()
                
                if decrypted_neo in extracted_ids:
                    is_shortlisted = True
                    
                    # Update application tracker status
                    if app:
                        app.status = "Shortlisted"
                        app.recruitment_state = "Shortlisted"
                        app.current_round = "Shortlisted"
                    else:
                        app = Application(
                            user_id=current_user.id,
                            company_id=company_id,
                            status="Shortlisted",
                            recruitment_state="Shortlisted",
                            current_round="Shortlisted",
                            match_score=0
                        )
                    db.add(app)
                    db.commit()
                else:
                    # User not in shortlist, set status to Likely Rejected if they were previously active
                    if app and app.status in ('Applied', 'Shortlisted', 'OA', 'Interview'):
                        app.status = "Likely Rejected"
                        db.add(app)
                        db.commit()
            except Exception as e:
                logger.error(f"Failed to decrypt user neo_id or shortlist check: {str(e)}")
                
        return {
            "message": "Shortlist parsed successfully",
            "is_shortlisted": is_shortlisted,
            "total_shortlisted_students": len(extracted_ids),
            "shortlisted_ids": extracted_ids[:10] # return top 10 for preview
        }

    else:
        raise HTTPException(status_code=400, detail="Invalid import_type. Must be 'email', 'jd', or 'shortlist'.")

@router.get("", response_model=List[CompanyWithEligibilityOut])
def list_companies(
    x_client_key: Optional[str] = Header(None, alias="X-Client-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    companies = db.query(Company).all()
    results = []
    for company in companies:
        if current_user.profile:
            status, reason = check_eligibility(current_user.profile, company)
        else:
            status, reason = "CHECK", "Student profile not set up."
        # Create a dict compatible with CompanyWithEligibilityOut
        company_data = CompanyOut.from_orm(company).dict()
        company_data["eligibility_status"] = status
        company_data["eligibility_reason"] = reason
        results.append(company_data)
    return results

@router.get("/{id}", response_model=CompanyWithEligibilityOut)
def get_company(
    id: UUID,
    x_client_key: Optional[str] = Header(None, alias="X-Client-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    company = db.query(Company).filter(Company.id == id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found."
        )
    if current_user.profile:
        status_elig, reason_elig = check_eligibility(current_user.profile, company)
    else:
        status_elig, reason_elig = "CHECK", "Student profile not set up."
    company_data = CompanyOut.from_orm(company).dict()
    company_data["eligibility_status"] = status_elig
    company_data["eligibility_reason"] = reason_elig
    return company_data


@router.get("/{id}/events")
def get_company_events(
    id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    events = (
        db.query(CompanyEvent)
        .filter(CompanyEvent.company_id == id)
        .order_by(CompanyEvent.timestamp.desc())
        .all()
    )
    
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
        
    return results
