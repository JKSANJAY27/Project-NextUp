import sys
sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import (
    Company, CompanyEvent, Application, Notification, OpportunityState
)
from app.services.email_parser import is_generic_company_name

def fix_mechanical_and_zomato():
    db = SessionLocal()
    try:
        print("=== FIXING MECHANICAL & MERGING TO ETERNAL (ZOMATO) ===")
        all_companies = db.query(Company).all()
        
        mechanical_company = None
        eternal_company = None

        for c in all_companies:
            name_upper = c.name.upper().strip()
            if name_upper == "MECHANICAL":
                mechanical_company = c
            elif "ETERNAL" in name_upper and "ZOMATO" in name_upper:
                eternal_company = c
            elif "ETERNAL" in name_upper and not eternal_company:
                eternal_company = c
            elif "ZOMATO" in name_upper and not eternal_company:
                eternal_company = c

        print(f"Mechanical company found: {mechanical_company.name if mechanical_company else 'None'} (ID: {mechanical_company.id if mechanical_company else 'None'})")
        print(f"Eternal company found: {eternal_company.name if eternal_company else 'None'} (ID: {eternal_company.id if eternal_company else 'None'})")

        if mechanical_company and eternal_company:
            print(f"\nMoving events from '{mechanical_company.name}' to '{eternal_company.name}'...")
            mech_events = db.query(CompanyEvent).filter(CompanyEvent.company_id == mechanical_company.id).all()
            print(f"  Found {len(mech_events)} events to move.")
            for ev in mech_events:
                ev.company_id = eternal_company.id
                print(f"    Moved event '{ev.subject[:60]}...' -> {eternal_company.name}")

            # Re-assign / delete applications
            mech_apps = db.query(Application).filter(Application.company_id == mechanical_company.id).all()
            for app in mech_apps:
                existing_app = db.query(Application).filter(
                    Application.user_id == app.user_id,
                    Application.company_id == eternal_company.id
                ).first()
                if existing_app:
                    db.delete(app)
                else:
                    app.company_id = eternal_company.id

            # Delete opportunity states
            db.query(OpportunityState).filter(OpportunityState.company_id == mechanical_company.id).delete()

            # Delete company Mechanical
            db.delete(mechanical_company)
            print(f"  Successfully deleted company '{mechanical_company.name}'!")

        # Also purge any other generic/branch companies like 'Data Science & Business Statistics'
        all_cos_refresh = db.query(Company).all()
        for c in all_cos_refresh:
            if is_generic_company_name(c.name):
                print(f"\nPurging generic/branch company: '{c.name}' (ID: {c.id})")
                evs = db.query(CompanyEvent).filter(CompanyEvent.company_id == c.id).all()
                for ev in evs:
                    db.query(Notification).filter(Notification.company_event_id == ev.id).delete()
                    db.delete(ev)
                db.query(Application).filter(Application.company_id == c.id).delete()
                db.query(OpportunityState).filter(OpportunityState.company_id == c.id).delete()
                db.delete(c)
                print(f"  Deleted '{c.name}'.")

        db.commit()
        print("\n=== MIGRATION & CLEANUP COMPLETE ===")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    fix_mechanical_and_zomato()
