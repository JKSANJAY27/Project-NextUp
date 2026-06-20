import sys
sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import User, StudentProfile, Company, CompanyEvent, Notification, Application, RawIngestionJob

db = SessionLocal()
try:
    print("--- Students ---")
    users = db.query(User).all()
    for u in users:
        print(f"User ID: {u.id}, Email: {u.email}")
        if u.profile:
            p = u.profile
            print(f"  Profile Name: {p.full_name}, Branch: {p.branch}, CGPA: {p.cgpa}")
            
    print("\n--- Companies ---")
    comps = db.query(Company).all()
    for c in comps:
        print(f"Company ID: {c.id}, Company: {c.name}, Role: {c.role}, Eligible: {c.eligible_branches}, Reg Deadline: {c.registration_deadline}")
        
    print("\n--- Company Events ---")
    evts = db.query(CompanyEvent).all()
    for e in evts:
        print(f"Event ID: {e.id}, Company ID: {e.company_id}, Company: {e.company.name if e.company else 'None'}, Event Type: {e.event_type}, Subject: {e.subject}")
        print(f"  Body length: {len(e.body) if e.body else 0}")
        
    print("\n--- Applications ---")
    apps = db.query(Application).all()
    for app in apps:
        print(f"App User: {app.user.email}, Company ID: {app.company_id}, Company: {app.company.name}, Status: {app.status}, Recruitment State: {app.recruitment_state}")

    print("\n--- Notifications ---")
    notifs = db.query(Notification).all()
    for n in notifs:
        print(f"Notif for: {n.user.email}, Message: {n.message}, Event ID: {n.company_event_id}")

finally:
    db.close()
