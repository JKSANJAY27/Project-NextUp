import os
import io
import re
import json
import logging
from typing import Dict, Any, List
import pdfplumber
import fitz  # PyMuPDF
from PIL import Image
import pytesseract

logger = logging.getLogger(__name__)

# Try to load the skills dictionary
SKILLS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "skills_dictionary.json")
try:
    with open(SKILLS_FILE, "r") as f:
        SKILLS_LIST = json.load(f)
except Exception as e:
    logger.error(f"Failed to load skills dictionary from {SKILLS_FILE}: {str(e)}")
    SKILLS_LIST = []

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """
    Extracts text from PDF bytes.
    First tries pdfplumber (text-based PDF).
    If extracted text length is < 100 characters, falls back to PyMuPDF + pytesseract OCR (scanned PDF).
    """
    text = ""
    try:
        # Try pdfplumber
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        logger.warning(f"pdfplumber text extraction failed: {str(e)}")

    # OCR Fallback if text is empty or too short (scanned PDF)
    if len(text.strip()) < 100:
        logger.info("Text-based PDF extraction returned empty/short text. Running OCR fallback...")
        text = ""
        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)
                # Render page to PNG pixmap
                pix = page.get_pixmap(dpi=150)
                img_data = pix.tobytes("png")
                
                # Run OCR via pytesseract
                img = Image.open(io.BytesIO(img_data))
                page_text = pytesseract.image_to_string(img)
                if page_text:
                    text += page_text + "\n"
            doc.close()
        except Exception as e:
            logger.error(f"pytesseract OCR fallback failed: {str(e)}")

    return text

def extract_skills_from_text(text: str) -> List[str]:
    """
    Scans text against the skills dictionary and returns matched skills.
    Uses regex word boundaries to prevent substring false positives (e.g. 'Go' in 'Google').
    """
    matched_skills = []
    if not text:
        return matched_skills
        
    for skill in SKILLS_LIST:
        # Use word boundaries for matching
        # Special cases like C++, C#, .NET need custom escaping
        escaped_skill = re.escape(skill)
        pattern = rf"\b{escaped_skill}\b"
        
        # Adjust pattern for skills with special trailing characters like C++, C#
        if skill.endswith("++") or skill.endswith("#"):
            pattern = rf"\b{escaped_skill}"
            
        if re.search(pattern, text, re.IGNORECASE):
            matched_skills.append(skill)
            
    return matched_skills

def parse_job_description(file_bytes: bytes) -> Dict[str, Any]:
    """
    Extracts text and matching skills/ATS keywords from a PDF JD.
    """
    text = extract_text_from_pdf(file_bytes)
    skills = extract_skills_from_text(text)
    
    # Simple ATS keyword extractor: high-frequency nouns/words in text (excluding standard stop words)
    stop_words = {"the", "and", "a", "of", "to", "in", "for", "with", "as", "is", "by", "on", "at", "an", "be", "this", "are", "from", "or", "an"}
    words = re.findall(r"\b[a-zA-Z]{3,15}\b", text.lower())
    freq: Dict[str, int] = {}
    for w in words:
        if w not in stop_words:
            freq[w] = freq.get(w, 0) + 1
            
    # Get top 15 words as ATS keywords
    ats_keywords = sorted(freq.keys(), key=lambda x: freq[x], reverse=True)[:15]
    
    return {
        "jd_text": text,
        "skills": skills,
        "ats_keywords": ats_keywords
    }
