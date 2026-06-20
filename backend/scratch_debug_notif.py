import sys
sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import User, StudentProfile, Company, CompanyEvent, Notification, Application, NotificationJob

db = SessionLocal()
try:
    # Let's inspect a particular job/event
    event = db.query(CompanyEvent).filter(CompanyEvent.subject.like("%Tube Products%")).first()
    print("Event subject:", event.subject)
    print("Event type:", event.event_type)
    company = event.company
    print("Company:", company.name)
    print("Company eligible branches:", company.eligible_branches)
    print("Company cgpa rule:", company.eligibility_rules)
    
    profiles = db.query(StudentProfile).all()
    for profile in profiles:
        print(f"Profile: {profile.user.email}, branch: {profile.branch}")
        if company.eligible_branches:
            user_branch = (profile.branch or "").strip().upper()
            eligible_branches_upper = [b.strip().upper() for b in company.eligible_branches]
            print(f"  Checking branch eligibility: '{user_branch}' in {eligible_branches_upper}")
            if user_branch not in eligible_branches_upper:
                print("    Skipped due to branch")
                continue
        else:
            print("  No company eligible branches")
            
        app = db.query(Application).filter(
            Application.user_id == profile.user_id,
            Application.company_id == company.id
        ).first()
        if app:
            print(f"  Existing app status: {app.status}")
            if app.status in ('Rejected', 'Declined', 'Ignored'):
                print("    Skipped due to status")
                continue
        else:
            print("  No existing application")
            
        # Create notification check
        existing = db.query(Notification).filter(
            Notification.user_id == profile.user_id,
            Notification.company_event_id == event.id
        ).first()
        print(f"  Existing notification in DB: {existing}")
        
finally:
    db.close()
