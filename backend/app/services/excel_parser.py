import io
import re
import logging
from typing import List
import pandas as pd

logger = logging.getLogger(__name__)

# User's pattern: Alternating letter and digit, length 8. E.g. K9B8C7D6
NEO_ID_PATTERN = re.compile(r"^[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d$")

def extract_neo_ids_from_excel(file_bytes: bytes) -> List[str]:
    """
    Parses shortlist Excel spreadsheet in-memory.
    Detects the Neo ID column by scanning headers and column values.
    Returns a list of clean uppercase Neo IDs.
    """
    neo_ids = []
    try:
        # Load the spreadsheet
        df = pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl")
        
        # 1. Clean column headers
        df.columns = [str(c).strip() for c in df.columns]
        
        neo_col_name = None
        
        # 2. Strategy A: Check header names
        header_keywords = ["neo id", "neo_id", "neoid", "registration number", "reg number", "reg. no", "reg no", "student id", "student_id", "register number"]
        for col in df.columns:
            if col.lower() in header_keywords:
                neo_col_name = col
                break
                
        # 3. Strategy B: Scan column contents for alternating Neo ID pattern
        if not neo_col_name:
            for col in df.columns:
                # Get non-null values from column, convert to string
                samples = df[col].dropna().astype(str).str.strip().tolist()
                
                # Check if at least 40% of the sample cells match the Neo ID regex pattern
                match_count = 0
                check_limit = min(len(samples), 30) # check up to 30 rows
                if check_limit > 0:
                    for val in samples[:check_limit]:
                        if NEO_ID_PATTERN.match(val):
                            match_count += 1
                            
                    if (match_count / check_limit) >= 0.4:
                        neo_col_name = col
                        break

        # 4. Extract values if a column is detected
        if neo_col_name is not None:
            raw_ids = df[neo_col_name].dropna().astype(str).str.strip().str.upper().tolist()
            # Clean and filter to only match the pattern
            for rid in raw_ids:
                if NEO_ID_PATTERN.match(rid):
                    neo_ids.append(rid)
            logger.info(f"Successfully detected Neo ID column '{neo_col_name}'. Extracted {len(neo_ids)} IDs.")
        else:
            logger.warning("Could not automatically locate a Neo ID column in the spreadsheet.")

    except Exception as e:
        logger.error(f"Excel parsing failed: {str(e)}")

    return list(set(neo_ids))
