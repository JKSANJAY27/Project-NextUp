import logging
from typing import Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.models import Application, Company, CompanyEvent, CalendarEvent, OpportunityState

logger = logging.getLogger(__name__)

def map_event_type(company_event_type: str, stage: Optional[str] = None) -> str:
    """
    Maps company_event_type and stage from raw emails/notifications/milestones to clean calendar event types:
    'registration_deadline', 'online_assessment', 'interview', 'offer_result', 'manual'
    """
    if stage:
        stage_upper = stage.upper()
        if stage_upper == 'REGISTRATION':
            return 'registration_deadline'
        elif stage_upper == 'ONLINE_ASSESSMENT':
            return 'online_assessment'
        elif stage_upper in ('TECHNICAL_INTERVIEW', 'HR_INTERVIEW', 'PRE_PLACEMENT_TALK'):
            return 'interview'
        elif stage_upper == 'OFFER':
            return 'offer_result'

    cet_upper = company_event_type.upper()
    if cet_upper in ('REGISTRATION', 'DEADLINE', 'DEADLINE_EXTENSION'):
        return 'registration_deadline'
    elif cet_upper in ('OA', 'ONLINE_ASSESSMENT', 'TEST'):
        return 'online_assessment'
    elif cet_upper in ('INTERVIEW', 'TECHNICAL', 'HR', 'GD'):
        return 'interview'
    elif cet_upper in ('OFFER', 'REJECTION', 'SHORTLIST', 'OA_RESULT', 'INTERVIEW_RESULT'):
        return 'offer_result'
    else:
        return 'manual'

def is_rejected_status(status: Optional[str]) -> bool:
    """Returns True if the application status indicates rejection/ineligibility."""
    if not status:
        return False
    s = status.strip().lower()
    return 'reject' in s or s in ('declined', 'ineligible', 'likely rejected', 'likely_rejected')

def sync_user_calendar_events(db: Session, user_id: UUID, company_id: Optional[UUID] = None):
    """
    Synchronizes company deadlines and company events to user calendar_events table.
    Ensures pure reads in GET /calendar and event-driven updates on mutations.
    """
    try:
        logger.info(f"Syncing calendar events for user {user_id} (company_id filter: {company_id})")

        # 1. Fetch user's opportunity states and applications
        opp_states = db.query(OpportunityState).filter(OpportunityState.user_id == user_id).all()
        opp_state_map = {os.company_id: os.state for os in opp_states}

        apps = db.query(Application).filter(Application.user_id == user_id).all()
        app_map = {a.company_id: a for a in apps}

        # 2. Fetch companies to process
        company_query = db.query(Company)
        if company_id:
            company_query = company_query.filter(Company.id == company_id)
        companies = company_query.all()

        active_company_ids = set()
        tracking_company_ids = set()

        for company in companies:
            state = opp_state_map.get(company.id)
            app = app_map.get(company.id)

            if state in ('archived', 'auto_archived'):
                continue
            # Drives in a rejected status have all calendar events suppressed/cleaned up
            if app and is_rejected_status(app.status):
                continue

            active_company_ids.add(company.id)
            # A company is tracked if its state is tracking or it has an application record with a tracking/interested decision
            is_tracked = (state == 'tracking') or (app and app.user_decision in ('tracking', 'interested'))
            if is_tracked:
                tracking_company_ids.add(company.id)

        # Bulk fetch all relevant calendar events for this user to avoid N+1 queries
        cal_events_query = db.query(CalendarEvent).filter(
            CalendarEvent.user_id == user_id,
            CalendarEvent.source == 'application_timeline'
        )
        if company_id:
            cal_events_query = cal_events_query.filter(CalendarEvent.company_id == company_id)
        
        existing_cal_events = cal_events_query.all()
        cal_event_map = {ev.source_key: ev for ev in existing_cal_events if ev.source_key}

        # 3. Cleanup logic for database calendar events
        if not company_id:
            for cal_ev in existing_cal_events:
                # Delete if company no longer exists or is archived
                if not cal_ev.company_id or cal_ev.company_id not in active_company_ids:
                    db.delete(cal_ev)
                # Delete company milestone events if company is no longer tracked
                elif cal_ev.event_type != 'registration_deadline' and cal_ev.company_id not in tracking_company_ids:
                    db.delete(cal_ev)
            db.flush()
        else:
            # Delete if the specific company is archived or no longer active
            if company_id not in active_company_ids:
                for cal_ev in existing_cal_events:
                    db.delete(cal_ev)
                db.flush()
            # Delete milestones if company is active but no longer tracked
            elif company_id not in tracking_company_ids:
                for cal_ev in existing_cal_events:
                    if cal_ev.event_type != 'registration_deadline':
                        db.delete(cal_ev)
                db.flush()

        # Update our in-memory map of calendar events to exclude deleted ones
        deleted_keys = set()
        if not company_id:
            for cal_ev in existing_cal_events:
                if not cal_ev.company_id or cal_ev.company_id not in active_company_ids:
                    deleted_keys.add(cal_ev.source_key)
                elif cal_ev.event_type != 'registration_deadline' and cal_ev.company_id not in tracking_company_ids:
                    deleted_keys.add(cal_ev.source_key)
        else:
            if company_id not in active_company_ids:
                for cal_ev in existing_cal_events:
                    deleted_keys.add(cal_ev.source_key)
            elif company_id not in tracking_company_ids:
                for cal_ev in existing_cal_events:
                    if cal_ev.event_type != 'registration_deadline':
                        deleted_keys.add(cal_ev.source_key)
        
        for k in deleted_keys:
            if k in cal_event_map:
                del cal_event_map[k]

        # Bulk fetch all relevant company events for tracked companies
        company_events_by_id = {}
        if tracking_company_ids:
            ce_query = db.query(CompanyEvent).filter(
                CompanyEvent.stage.isnot(None),
                CompanyEvent.stage != 'REGISTRATION'
            )
            if company_id:
                if company_id in tracking_company_ids:
                    ce_query = ce_query.filter(CompanyEvent.company_id == company_id)
                else:
                    ce_query = None
            else:
                ce_query = ce_query.filter(CompanyEvent.company_id.in_(list(tracking_company_ids)))
            
            if ce_query:
                company_events = ce_query.all()
                for ce in company_events:
                    company_events_by_id.setdefault(ce.company_id, []).append(ce)

        # 4. Reconcile/Create events
        for company in companies:
            if company.id not in active_company_ids:
                continue

            # A. Registration Deadline Event
            if company.registration_deadline:
                source_key = f"{user_id}:{company.id}:registration_deadline"
                cal_event = cal_event_map.get(source_key)

                if not cal_event:
                    cal_event = CalendarEvent(
                        user_id=user_id,
                        company_id=company.id,
                        title=f"Registration Deadline: {company.name}",
                        company_name=company.name,
                        role=company.role,
                        event_type='registration_deadline',
                        date=company.registration_deadline,
                        completed=False,
                        is_manual=False,
                        is_deleted=False,
                        is_user_modified=False,
                        source='application_timeline',
                        source_key=source_key
                    )
                    db.add(cal_event)
                else:
                    if not cal_event.is_deleted and not cal_event.is_user_modified:
                        cal_event.title = f"Registration Deadline: {company.name}"
                        cal_event.company_name = company.name
                        cal_event.role = company.role
                        cal_event.date = company.registration_deadline

            # B. Company Milestones / Events (only if tracked)
            if company.id in tracking_company_ids:
                company_events = company_events_by_id.get(company.id, [])
                for ce in company_events:
                    source_key = f"{user_id}:{ce.id}:event"
                    cal_event = cal_event_map.get(source_key)
                    mapped_type = map_event_type(ce.event_type, ce.stage)

                    title_str = f"{company.name} - {ce.stage.replace('_', ' ').title()}" if ce.stage else f"{company.name} - {ce.event_type.upper()}"

                    if not cal_event:
                        cal_event = CalendarEvent(
                            user_id=user_id,
                            company_id=company.id,
                            company_event_id=ce.id,
                            title=title_str,
                            company_name=company.name,
                            role=company.role,
                            event_type=mapped_type,
                            date=ce.date or ce.timestamp or datetime.utcnow(),
                            notes=ce.body or ce.subject,
                            completed=False,
                            is_manual=False,
                            is_deleted=False,
                            is_user_modified=False,
                            source='application_timeline',
                            source_key=source_key
                        )
                        db.add(cal_event)
                    else:
                        if not cal_event.is_deleted and not cal_event.is_user_modified:
                            cal_event.title = title_str
                            cal_event.company_name = company.name
                            cal_event.role = company.role
                            cal_event.date = ce.date or ce.timestamp or datetime.utcnow()
                            cal_event.notes = ce.body or ce.subject

        db.commit()
        logger.info(f"Successfully reconciled calendar events for user {user_id}")
    except Exception as e:
        db.rollback()
        logger.error(f"Error syncing calendar events for user {user_id}: {str(e)}", exc_info=True)
