import sys
import os
import re

sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import (
    Company, CompanyEvent, Application, Notification, OpportunityState, PendingCompanyEvent, RawIngestionJob
)
from app.services.email_parser import is_generic_company_name

def run_cleanup():
    db = SessionLocal()
    try:
        print("=== NEXTUP DATABASE CLEANUP & DRIVE MERGE ===")
        all_companies = db.query(Company).all()
        print(f"Total companies currently in DB: {len(all_companies)}")
        for c in all_companies:
            print(f"  - [{c.id}] {c.name} (Role: {c.role}, Category: {c.category})")

        # -------------------------------------------------------------------------
        # 1. MERGE ZOMATO PPT & ONLINE -> ETERNAL (ZOMATO)
        # -------------------------------------------------------------------------
        eternal_company = None
        zomato_ppt_company = None

        for c in all_companies:
            name_upper = c.name.upper()
            if "ETERNAL" in name_upper and "ZOMATO" in name_upper:
                eternal_company = c
            elif "ETERNAL" in name_upper:
                eternal_company = c
            elif "ZOMATO PPT" in name_upper or (name_upper == "ZOMATO" and c != eternal_company):
                zomato_ppt_company = c

        # Fallback search if exact names differ slightly
        if not eternal_company:
            for c in all_companies:
                if "ZOMATO" in c.name.upper() and c != zomato_ppt_company:
                    eternal_company = c
                    break

        if eternal_company and zomato_ppt_company:
            print(f"\n[1] Merging '{zomato_ppt_company.name}' (ID: {zomato_ppt_company.id}) into '{eternal_company.name}' (ID: {eternal_company.id})...")
            
            # Re-assign events
            events = db.query(CompanyEvent).filter(CompanyEvent.company_id == zomato_ppt_company.id).all()
            print(f"  - Moving {len(events)} events...")
            for ev in events:
                ev.company_id = eternal_company.id
                
            # Re-assign applications
            apps = db.query(Application).filter(Application.company_id == zomato_ppt_company.id).all()
            print(f"  - Moving {len(apps)} applications...")
            for app in apps:
                # Check if target already has an app record
                existing_app = db.query(Application).filter(
                    Application.user_id == app.user_id,
                    Application.company_id == eternal_company.id
                ).first()
                if existing_app:
                    db.delete(app)
                else:
                    app.company_id = eternal_company.id

            # Re-assign opportunity states
            opp_states = db.query(OpportunityState).filter(OpportunityState.company_id == zomato_ppt_company.id).all()
            print(f"  - Moving {len(opp_states)} opportunity states...")
            for state in opp_states:
                existing_state = db.query(OpportunityState).filter(
                    OpportunityState.user_id == state.user_id,
                    OpportunityState.company_id == eternal_company.id
                ).first()
                if existing_state:
                    db.delete(state)
                else:
                    state.company_id = eternal_company.id

            # Update registration deadline / details on parent if new info came with update
            if zomato_ppt_company.registration_deadline and not eternal_company.registration_deadline:
                eternal_company.registration_deadline = zomato_ppt_company.registration_deadline

            # Delete the duplicate company
            db.delete(zomato_ppt_company)
            print(f"  Successfully merged '{zomato_ppt_company.name}' into '{eternal_company.name}' and removed duplicate!")
        else:
            print(f"\n[1] Zomato merge skipped. Eternal company found: {bool(eternal_company)}, Zomato PPT found: {bool(zomato_ppt_company)}")

        # -------------------------------------------------------------------------
        # 2. PURGE THE 3 GARBAGE DRIVES
        # -------------------------------------------------------------------------
        garbage_targets = []
        all_companies_refresh = db.query(Company).all()
        for c in all_companies_refresh:
            name_upper = c.name.upper()
            if (
                "NEO ID REG" in name_upper or 
                "KHUSHI AGARWAL" in name_upper or 
                "F3M5W9J9" in name_upper or 
                "B5K6G7Q6" in name_upper or
                is_generic_company_name(c.name)
            ):
                garbage_targets.append(c)

        print(f"\n[2] Found {len(garbage_targets)} garbage drive(s) to purge:")
        for g in garbage_targets:
            print(f"  - Purging garbage company: '{g.name}' (ID: {g.id})")
            
            # Delete/clean associated events
            g_events = db.query(CompanyEvent).filter(CompanyEvent.company_id == g.id).all()
            for ev in g_events:
                # Delete notifications linked to event
                db.query(Notification).filter(Notification.company_event_id == ev.id).delete()
                db.delete(ev)
                
            # Delete applications
            db.query(Application).filter(Application.company_id == g.id).delete()
            
            # Delete opportunity states
            db.query(OpportunityState).filter(OpportunityState.company_id == g.id).delete()
            
            # Delete company record
            db.delete(g)
            print(f"    Deleted '{g.name}' and all associated records.")

        db.commit()
        print("\n=== CLEANUP COMPLETED SUCCESSFULLY ===")

    except Exception as e:
        db.rollback()
        print(f"\nERROR during cleanup: {e}")
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    run_cleanup()
