import dateparser
import re

def clean_val(val: str) -> str:
    if not val:
        return None
    val = re.sub(r'[*_#\u00d8]', '', val)
    return val.strip()

dates = [
    "*19th June 2026 (10.00 am)*",
    "19th June 2026 (10.00 am)",
    "*24-06-**2026** (10:00 AM)*",
    "24-06-2026 (10:00 AM)",
    "24-06-2026"
]

for d in dates:
    cleaned = clean_val(d)
    parsed = dateparser.parse(cleaned)
    print(f"Original: {d!r} -> Cleaned: {cleaned!r} -> Parsed: {parsed}")
