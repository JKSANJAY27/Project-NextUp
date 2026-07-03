import re
import dateparser

_DATE_PATTERN = (
    r"(?:"
    # "8th July 2026", "8 July 2026", "July 8", etc.
    r"\d{1,2}\s*(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*(?:\d{2,4})?"
    r"|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:\s*,?\s*\d{4})?"
    # ISO-like: 2026-07-08, 08-07-2026
    r"|\d{4}[-/]\d{2}[-/]\d{2}"
    r"|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}"
    r")"
    # Optional time part: allows separators like -, @, at, etc.
    r"(?:\s*(?:-|@|at|from|,)?\s*[\(]?\s*\d{1,2}[:.\s]\d{2}\s*(?:am|pm)?[\)]?|\s*(?:-|@|at|from|,)?\s*\d{1,2}\s*(?:am|pm))?"
)

dp_settings = {
    'TIMEZONE': 'Asia/Kolkata',
    'TO_TIMEZONE': 'UTC',
    'RETURN_AS_TIMEZONE_AWARE': True,
    'DATE_ORDER': 'DMY',
    'PREFER_DAY_OF_MONTH': 'first',
}

test_strings = [
    "* Online test: 8th July 2026 ( respective CDC Labs)*",
    "*Pre-Placement & Selection process - 9th July 2026 - 6 pm ( Physical for Vellore Campus )*",
    "*Interview: 10th July 2026 (Physical at VIT Vellore campus for Vellore and Chennai students )*",
    "*04th July 2026 (9**.00 a**m)*",
    "04th July 2026 (9.00 am)"
]

for s in test_strings:
    cleaned = re.sub(r'[*_#]', '', s).strip()
    m = re.search(_DATE_PATTERN, cleaned, re.IGNORECASE)
    if m:
        raw_date = m.group(0).strip()
        parsed = dateparser.parse(raw_date, settings=dp_settings)
        print(f"Original: {s!r}\n  Cleaned: {cleaned!r}\n  Matched: {raw_date!r}\n  Parsed: {parsed}\n")
    else:
        print(f"Original: {s!r}\n  Cleaned: {cleaned!r}\n  NO MATCH\n")
