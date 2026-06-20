import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

def extract_company_from_subject(subject: str) -> str:
    if not subject:
        return "Unknown Company"
        
    # Remove zero-width spaces and clean whitespace
    s = subject.replace('\u200b', '').strip()
    
    # Repeatedly remove common prefix/suffix words at the beginning
    prev_s = None
    while s != prev_s:
        prev_s = s
        s = re.sub(
            r'^(?:congratulations|congrats|kind\s+attn|kind\s+attention|summer\s+sem|updated|update|re|fwd|urgnt|urgent|notice|report\s+immediately)\b[:\s!]*',
            '',
            s,
            flags=re.I
        ).strip()
        s = re.sub(r'^[:\s!]+', '', s) # clean leading punctuation
    
    # Split by common delimiters and take the first block
    parts = re.split(r'[-–—|:(]', s)
    first_part = parts[0].strip()
    
    # Clean up known placement keywords and everything after them from the first part
    clean = re.sub(
        r'\b(?:next\s+round|tech\s+talk|super\s+dream|dream|regular|mass|recruiter|internship|placement|hiring|registration|selection|shortlist|online\s+test|oa|interview|offers?|applied|announcement|results?|list|batch|\d{4})\b.*$',
        '',
        first_part,
        flags=re.I
    ).strip()
    
    # Remove any extra symbols
    clean = re.sub(r'[*_#]', '', clean).strip()
    
    # If the clean version is empty or too short, fallback to first_part
    if len(clean) >= 2:
        return clean
    if len(first_part) >= 2:
        return first_part
    return "Unknown Company"

subjects = [
    "Apex Neural next round of selection process Additional Shortlist -Reg",
    "ZF Group Tech talk \u200bis scheduled on \u200b23rd June 2026 by 2:45Pm- Virtual Mode- 2027 Batch",
    "Congratulations!! Power School Dream internship selection list 2027 Batch",
    "\u200bKind Attn: TCS Applied Students - 2027 Batch - New ID Required",
    "kind attention!! summer sem - Re- Mid term exam 2027 Batch",
    "Congratulations !! SES Global Technology India Pvt Ltd Super dream Internship selection list 2027 batch !! SET-1",
    "Update : WarpDrive - Online test is scheduled on 18-06-2026 at 4 pm @ Own location",
    "Green Tiger Mobility Dream Internship Registration \u2013 2027 Batch.",
    "Re: Updated : Ninestar Technologies (PPT, Online test & entire interview process) is scheduled on ...",
    "Resmed super dream internship registration 2027 Batch",
    "Ericsson Dream Internship Registration - 2027 Batch",
    "Datagrokr Dream Internship Registration - 2027 Batch",
    "JW Consultants Dream Core Internship Offer Registration - 2027 Batch.",
    "Blue Star Limited Dream Core Internship - 2027 Batch",
    "Tube Products of India - Regular Internship - 2027 Batch - MCA"
]

for sub in subjects:
    print(f"Subject: {sub}")
    print(f"  Parsed: {extract_company_from_subject(sub)}")
