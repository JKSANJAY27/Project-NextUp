from datetime import datetime, timedelta
from typing import List
from app.models.models import Application, Company, CompanyEvent

def calculate_priority_score(app: Application, company: Company, events: List[CompanyEvent]) -> int:
    """
    Calculates dynamic priority score:
    Priority = Stage Weight + Deadline Weight + Recent Update Weight + User Focus Weight
    """
    # 1. Manual Pin Override
    if app.workspace_priority_override == 'pinned':
        # Add 1000 to keep pinned items at the absolute top of the queue
        return 1000 + calculate_baseline_priority(app, company, events)
    return calculate_baseline_priority(app, company, events)

def calculate_baseline_priority(app: Application, company: Company, events: List[CompanyEvent]) -> int:
    score = 0
    
    # 2. Stage Weight
    # Stage Weights: Offer (100) | Interview (80) | Assessment/OA (60) | Applied (40) | Interested (20)
    state = app.recruitment_state or app.status or 'Registration'
    state_lower = state.lower()
    
    if 'offer' in state_lower:
        score += 100
    elif 'interview' in state_lower:
        score += 80
    elif 'oa' in state_lower or 'assessment' in state_lower:
        score += 60
    elif 'applied' in state_lower or 'shortlisted' in state_lower:
        score += 40
    else:
        score += 20
        
    # 3. Deadline Weight
    # Scale up to +50 points as deadlines get closer (e.g. less than 24 hours).
    if company and company.registration_deadline:
        now = datetime.utcnow()
        deadline = company.registration_deadline
        if deadline > now:
            diff = deadline - now
            hours_remaining = diff.total_seconds() / 3600
            if hours_remaining <= 24:
                # Linear scale from +10 to +50
                score += int(10 + 40 * (24 - hours_remaining) / 24)
            elif hours_remaining <= 72:
                score += 10
                
    # 4. Recent Update Weight
    # Temporary boost (+20 points) if the workspace has updates in the last 48 hours.
    now = datetime.utcnow()
    has_recent_update = False
    
    if app.last_user_activity_at and (now - app.last_user_activity_at) <= timedelta(hours=48):
        has_recent_update = True
        
    if events:
        for event in events:
            if event.timestamp and (now - event.timestamp) <= timedelta(hours=48):
                has_recent_update = True
                break
                
    if has_recent_update:
        score += 20
        
    # 5. User Focus Weight
    # Constant boost (+30 points) if marked as focus
    if app.workspace_priority_override == 'focus':
        score += 30
        
    return score
