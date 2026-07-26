"""
Cleanup script:
1. Merge events from phantom company 'PPT & Online' into real company 'Sabre Corporation'. Delete 'PPT & Online'.
2. Delete phantom company 'Govt' and its events.
3. Advance Application state/status for 'Tekion India Pvt Ltd' and 'Sabre Corporation' to 'OA' so they display under ONLINE ASSESSMENT in Active Tracking.
4. Bump cache versions.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from app.core.database import SessionLocal
from app.models.models import Company, CompanyEvent, Application, Notification, PendingCompanyEvent
from app.core.redis import bump_companies_list_version, bump_company_version, bump_user_version

def run_cleanup():
    db = SessionLocal()
    try:
        # 1. Sabre Corporation & PPT & Online
        sabre = db.query(Company).filter(Company.name.ilike("%Sabre Corporation%")).first()
        if not sabre:
            sabre = db.query(Company).filter(Company.name.ilike("%Sabre%")).first()

        ppt_company = db.query(Company).filter(Company.name.ilike("%PPT & Online%")).first()

        if sabre and ppt_company:
            print(f"Merging events from '{ppt_company.name}' ({ppt_company.id}) into '{sabre.name}' ({sabre.id})...")
            ppt_events = db.query(CompanyEvent).filter(CompanyEvent.company_id == ppt_company.id).all()
            for evt in ppt_events:
                evt.company_id = sabre.id
                db.add(evt)
            
            # Delete notifications linked to ppt_company events or re-link them
            db.delete(ppt_company)
            db.commit()
            print("Successfully merged Sabre events and deleted 'PPT & Online'.")
        elif ppt_company:
            print("Deleting orphaned 'PPT & Online' company...")
            db.delete(ppt_company)
            db.commit()

        # 2. Delete phantom company 'Govt'
        govt_company = db.query(Company).filter(Company.name.ilike("Govt")).first()
        if govt_company:
            print(f"Deleting phantom company '{govt_company.name}' ({govt_company.id})...")
            db.delete(govt_company)
            db.commit()
            print("Successfully deleted phantom company 'Govt'.")

        # 3. Advance Tekion and Sabre applications to 'OA'
        tekion = db.query(Company).filter(Company.name.ilike("%Tekion%")).first()
        target_companies = [c for c in [tekion, sabre] if c is not None]

        for company in target_companies:
            apps = db.query(Application).filter(Application.company_id == company.id).all()
            for app in apps:
                print(f"Updating Application {app.id} for {company.name}: status {app.status} -> 'OA', state {app.recruitment_state} -> 'OA'")
                app.status = "OA"
                app.recruitment_state = "OA"
                app.current_round = "OA"
                db.add(app)
                bump_user_version(app.user_id)

            bump_company_version(company.id)

        db.commit()
        bump_companies_list_version()
        print("DATABASE CLEANUP AND REPAIR COMPLETE!")

    except Exception as e:
        db.rollback()
        print(f"Error during cleanup: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    run_cleanup()
