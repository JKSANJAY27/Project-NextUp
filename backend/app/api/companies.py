from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Company
from app.schemas.schemas import CompanyCreate, CompanyOut, CompanyWithEligibilityOut
from app.services.eligibility import check_eligibility

router = APIRouter(prefix="/companies", tags=["companies"])

@router.post("", response_model=CompanyOut)
def create_company(
    company_in: CompanyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) # Secure: Only logged in users can create/view
):
    new_company = Company(**company_in.dict())
    db.add(new_company)
    db.commit()
    db.refresh(new_company)
    return new_company

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
