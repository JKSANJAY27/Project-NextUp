from fastapi import APIRouter, Depends, Header, HTTPException, status, File, UploadFile, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
import io

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Company, Application, RoundEvent
from app.schemas.schemas import CompanyCreate, CompanyOut, CompanyWithEligibilityOut
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
        
        # Create company
        new_company = Company(
            name=parsed["company"],
            role=parsed["role"],
            category=parsed["category"],
            ctc=parsed["ctc"],
            stipend=parsed["stipend"],
            eligible_branches=parsed.get("eligible_branches"),
            min_cgpa=parsed.get("min_cgpa"),
            requires_no_arrears=parsed["requires_no_arrears"],
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
            student = db.query(User).filter(User.id == app.user_id).first()
            if student:
                # Decrypt CGPA if x_client_key is provided
                student_cgpa = None
                if x_client_key and student.cgpa_enc:
                    try:
                        student_cgpa = float(decrypt_field(student.cgpa_enc, x_client_key))
                    except Exception:
                        pass
                
                score = calculate_match_score(
                    student_skills=student.skills or [],
                    jd_required_skills=company.jd_required_skills or [],
                    student_cgpa=student_cgpa,
                    company_min_cgpa=float(company.min_cgpa) if company.min_cgpa else None
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
        if x_client_key and current_user.neo_id_enc:
            try:
                decrypted_neo = decrypt_field(current_user.neo_id_enc, x_client_key).upper().strip()
                if decrypted_neo in extracted_ids:
                    is_shortlisted = True
                    
                    # Update application tracker status
                    app = db.query(Application).filter(
                        Application.user_id == current_user.id,
                        Application.company_id == company_id
                    ).first()
                    
                    enc_status = encrypt_field("Shortlisted", x_client_key)
                    
                    if app:
                        app.status_enc = enc_status
                        app.current_round = "Shortlisted"
                    else:
                        app = Application(
                            user_id=current_user.id,
                            company_id=company_id,
                            status_enc=enc_status,
                            current_round="Shortlisted",
                            match_score=0
                        )
                    db.add(app)
                    db.flush() # get app ID
                    
                    # Create Round Event
                    round_event = RoundEvent(
                        application_id=app.id,
                        round_name="Shortlisted from CDC email",
                        scheduled_at=None,
                        status="completed",
                        result_enc=encrypt_field("cleared", x_client_key)
                    )
                    db.add(round_event)
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
        status, reason = check_eligibility(current_user, company, x_client_key)
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
    status_elig, reason_elig = check_eligibility(current_user, company, x_client_key)
    company_data = CompanyOut.from_orm(company).dict()
    company_data["eligibility_status"] = status_elig
    company_data["eligibility_reason"] = reason_elig
    return company_data
