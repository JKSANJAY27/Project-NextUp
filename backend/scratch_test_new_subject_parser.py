import re

subjects = [
    "Congratulations!! Murf.AI Super Dream Internship Selection List 2027 batch !!",
    "Rubrik Super Dream Internship Registration - 2027 Batch",
    "Congratulations !! SES Global Technology India Pvt Ltd Super dream Internship selection list 2027 batch !! SET-1",
    "Powerschool next round of selection process is scheduled on 11th june 2026 - own location",
    "Updated timings & Instructions : NOKIA Online Test is Scheduled on 14th June 2026 by (12:30 PM to 1:30 PM) - Virtual mode @ Own location",
    "Congratulations!! Power School Dream internship selection list 2027 Batch",
    "Update (Registration Form in Neo Pat) : Ziptrrip Registration : \u200bRegular Internship - 2027 Batch",
    "Congratulations!! Philips Super Dream Internship selection list 2027 Batch",
    "Ziptrrip Registration : \u200bDream Internship - 2027 Batch",
    "WarpDrive - Online test is scheduled on 18-06-2026 at 10 am @ Own location",
    "Congratulations !! Ninestar Technologies Dream Internship selection list 2027 batch !!",
    "Gentle Reminder : Bazaarvoice PPT & online test is scheduled on 15th June 2026 by 1:00 Pm - PRP 717 VIT Vellore campus",
    "Ninestar Technologies (PPT, Online test & entire interview process) is scheduled on 18th June 2026 & 19th June 2026 by 9:00 AM at Anna Auditorium - VIT Vellore campus",
    "Report\xa0Immediately : Bazaarvoice Interview process is scheduled on 16th June 2026 by 8:15 Am - SJT 717 CDC Office VIT Vellore campus",
    "Update : WarpDrive - Online test is scheduled on 18-06-2026 at 4 pm @ Own location",
    "Re: kind attention!! Smith & Nephew Healthcare applied students",
    "Green Tiger Mobility Dream Internship Registration \u2013 2027 Batch.",
    "Congratulations !! Bosch Global Software Technologies Dream Internship selection list 2027 batch - Set - 2 !!",
    "WarpDrive Regular Internship Registration - 2027 Batch",
    "Datagrokr Dream Internship Registration - 2027 Batch",
    "Report Immediately : Murf.ai online coding test is scheduled on 11th June 2026 by 9.30 am at PRP 717 @ VIT Vellore campus",
    "Molecular connections next round of the selection process is scheduled on 23rd June as per the timings mentioned below",
    "ZF Group Tech talk \u200bis scheduled between \u200b22nd- 26th June 2026 - Virtual Mode-2027 Batch",
    "Re: Updated : Ninestar Technologies (PPT, Online test & entire interview process) is scheduled on 18th June 2026 & 19th June 2026 by 9:00 AM at Anna Auditorium - VIT Vellore campus",
    "Gentle Reminder : ZF Group Tech talk \u200bis scheduled on \u200b23rd June 2026 by 2:45Pm- Virtual Mode- 2027 Batch",
    "Congratulations Bazaarvoice Super Dream Internship !!",
    "Congratulations!! Wabtec Dream Internship selection list 2027 batch - Set 6",
    "Reminder : Ninestar Technologies (PPT, Online test & entire interview process) is scheduled on 18th June 2026 & 19th June 2026 by 9:00 AM at Anna Auditorium - VIT Vellore campus",
    "Bazaarvoice Interview process is scheduled on 16th June 2026 by 8:15 Am - SJT 717 CDC Office VIT Vellore campus",
    "Apex Neural next round of selection process Additional Shortlist -Reg",
    "Matrecomm online test is scheduled on 23rd June 2026 by 2:30 PM at Pearl Research Park (PRP 717) - VIT Vellore campus",
    "ZF Group Tech talk \u200bis scheduled on \u200b23rd June 2026 by 3:00Pm- Virtual Mode- 2027 Batch",
    "Mergerware assignment round is scheduled from (17th June 2026 -12 PM) to (18th June 2026 - 4 PM) - Virtual mode @ Own location",
    "Webinar : Ericsson Edge 3.0_VIT Vellore (Engineering College) 2027 Batch",
    "Resmed super dream internship registration 2027 Batch",
    "JW Consultants Dream Core Internship Offer Registration - 2027 Batch.",
    "Blue Star Limited Dream Core Internship - 2027 Batch",
    "Tube Products of India - Regular Internship - 2027 Batch - MCA",
    "Hindustan Unilever Limited | STEM Internships 2027 Batch",
    "Cisco: FY27 Pre-Placement Connect is scheduled on 24.06.2026 by 5:00 pm",
    "WSP online test is scheduled on 25-06-2026 by 2:30 pm @PRP - 717",
    "Credence Automation and Control Systems Pvt. Ltd : Regular Internship Registration-2027 Batch",
    "Clayfin Regular Internship Registration - 2027 Batch",
    "Ericsson - Online test is scheduled on 23-06-2026 @ Own location"
]

def new_extract_company_from_subject(subject: str) -> str:
    if not subject:
        return "Unknown Company"
    
    # Remove zero-width spaces and clean outer whitespace
    s = subject.replace('\u200b', '').replace('\xa0', ' ').replace('_', ' ').strip()
    
    # Prefix patterns to completely discard at the start of subject
    # Loop to strip nested prefixes
    prev_s = None
    while s != prev_s:
        prev_s = s
        s = re.sub(
            r'^(?:congratulations|congrats|kind\s+attn|kind\s+attention|summer\s+sem|updated|update|re|fwd|urgnt|urgent|notice|report\s+immediately|reminder|gentle\s+reminder|webinar)\b[:\s!]*',
            '',
            s,
            flags=re.I
        ).strip()
        s = re.sub(r'^[:\s!]+', '', s)
        
    # Split by colon, dash, or pipe, but ignore if it's within a date/time (e.g. 10:00 AM) or a decimal (e.g. 3.0)
    # Let's split by major separators: ':', '|', '-'
    # But only split on ':' if it is not followed by digits (like 10:00)
    parts = []
    colon_parts = re.split(r':(?!\d)', s)
    if len(colon_parts) > 1:
        # Check if the first part is a generic instructions prefix, like "Updated timings & Instructions"
        p0_lower = colon_parts[0].lower()
        generic_words = ["timings", "instructions", "update", "registration form", "schedule", "scheduled", "venue", "details", "webinar"]
        is_generic = any(w in p0_lower for w in generic_words)
        if is_generic:
            s = ":".join(colon_parts[1:]).strip()
        else:
            s = colon_parts[0].strip()
            
    # Now split on other separators: '|', '-' (but only if surrounded by spaces)
    s = s.split('|')[0].strip()
    s = re.split(r'\s+[-–—]\s+', s)[0].strip()
    
    # If there is a '(' at the start of any suffix, split there
    s = s.split('(')[0].strip()

    # Clean up standard suffix keywords (e.g. "online test", "selection list", "hiring", etc.)
    suffix_pattern = r'\b(?:next\s+round|tech\s+talk|super\s+dream|dream|regular|mass|recruitment|recruiter|drive|drives|internship|placement|hiring|registration|selection|shortlist|online\s+test|online\s+coding\s+test|coding\s+test|assignment\s+round|assignment|round|oa|interview|offers?|applied|announcement|results?|list|batch|pre-placement|connect|is\s+scheduled|scheduled|ppt|presentation|talk|webinar|test)\b.*$'
    clean = re.sub(suffix_pattern, '', s, flags=re.I).strip()
    
    # Strip campus names and other VIT specific words
    campus_pattern = r'\b(?:vit\s+vellore|vit\s+vellore\s+campus|vit|vellore|chennai\s+campus|chennai|campus|engineering\s+college|college|university)\b'
    clean = re.sub(campus_pattern, '', clean, flags=re.I).strip()
    
    # Clean up trailing date or year patterns (e.g., 2027 batch)
    clean = re.sub(r'\b(?:202\d|fy2\d)\b.*$', '', clean, flags=re.I).strip()
    
    # Strip any leftover punctuation / markdown / symbols / operators (but keep &)
    clean = re.sub(r'[*_#/\-–—]', ' ', clean).strip()
    clean = re.sub(r'\s+', ' ', clean).strip()
    
    # Clean up trailing ampersands or spaces
    clean = re.sub(r'\s+[&]\s*$', '', clean).strip()
    
    if len(clean) >= 2:
        return clean
    
    # Final fallbacks
    s_clean = re.sub(r'[*_#]', '', s).strip()
    if len(s_clean) >= 2:
        return s_clean
    return "Unknown Company"

for sub in subjects:
    res = new_extract_company_from_subject(sub)
    print(f"Subject: {sub!r}\n -> Company: {res!r}\n")
