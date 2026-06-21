import os
import io
import re
import json
import logging
import html
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

def extract_text_with_links_fitz(file_bytes: bytes) -> str:
    text = ""
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            
            # Get links and words
            links = page.get_links()
            words = page.get_text("words")
            
            if not words:
                # Fallback to standard text extraction if no word positions
                page_text = page.get_text("text")
                if page_text:
                    text += page_text + "\n"
                continue
                
            rect_links = []
            for l in links:
                if "uri" in l and "from" in l:
                    rect_links.append((fitz.Rect(l["from"]), l["uri"]))
            
            # Group words by block and line
            lines_dict = {}
            for w in words:
                x0, y0, x1, y1, word, block_no, line_no, word_no = w
                key = (block_no, line_no)
                if key not in lines_dict:
                    lines_dict[key] = []
                lines_dict[key].append(w)
                
            sorted_keys = sorted(lines_dict.keys(), key=lambda k: (lines_dict[k][0][1], lines_dict[k][0][0]))
            
            # Track link rects that have already been inlined (as rounded-tuple keys)
            used_link_rect_keys: set = set()
            
            page_text_lines = []
            for key in sorted_keys:
                line_words = sorted(lines_dict[key], key=lambda w: w[0])
                line_text = ""
                i = 0
                while i < len(line_words):
                    w = line_words[i]
                    x0, y0, x1, y1, word, _, _, _ = w
                    word_rect = fitz.Rect(x0, y0, x1, y1)
                    
                    matched_uri = None
                    matched_rect = None
                    matched_rect_key = None
                    for l_rect, uri in rect_links:
                        # Check intersection
                        if word_rect.intersects(l_rect) or l_rect.contains(word_rect):
                            matched_uri = uri
                            matched_rect = l_rect
                            # Use a rounded tuple as a stable dict key for this rect
                            matched_rect_key = (round(l_rect.x0, 1), round(l_rect.y0, 1), round(l_rect.x1, 1), round(l_rect.y1, 1))
                            break
                            
                    if matched_uri and matched_rect_key not in used_link_rect_keys:
                        # First time we encounter this link: consume all words inside this rect
                        linked_words = [word]
                        j = i + 1
                        while j < len(line_words):
                            nw = line_words[j]
                            nx0, ny0, nx1, ny1, nword, _, _, _ = nw
                            nword_rect = fitz.Rect(nx0, ny0, nx1, ny1)
                            if nword_rect.intersects(matched_rect) or matched_rect.contains(nword_rect):
                                linked_words.append(nword)
                                j += 1
                            else:
                                break
                        
                        phrase = " ".join(linked_words)
                        clean_uri = matched_uri.strip()
                        # Avoid duplicating if the text is already the URL
                        if phrase.strip().lower() == clean_uri.lower() or phrase.strip().lower() in clean_uri.lower():
                            line_text += f"{phrase} "
                        else:
                            line_text += f"{phrase} ({clean_uri}) "
                        # Mark this link rect as consumed — do NOT inline again
                        used_link_rect_keys.add(matched_rect_key)
                        i = j
                    elif matched_uri and matched_rect_key in used_link_rect_keys:
                        # Same link rect already inlined — just output the plain word
                        line_text += f"{word} "
                        i += 1
                    else:
                        line_text += f"{word} "
                        i += 1
                page_text_lines.append(line_text.strip())
            text += "\n".join(page_text_lines) + "\n"
        doc.close()
    except Exception as e:
        logger.warning(f"fitz text+links extraction failed: {str(e)}")
    return text

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """
    Extracts text from PDF bytes.
    First tries PyMuPDF (fitz) with link inlining.
    If that returns empty/no text, falls back to pdfplumber.
    If extracted text length is < 100 characters, falls back to PyMuPDF + pytesseract OCR (scanned PDF).
    """
    text = ""
    # Try fitz with link inlining first
    text = extract_text_with_links_fitz(file_bytes)
    
    # Fallback to pdfplumber if fitz returned nothing
    if not text.strip():
        logger.info("fitz extraction returned empty text. Falling back to pdfplumber...")
        try:
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
    # Clean HTML/XML tags (replace with space to preserve word separation)
    if text:
        # Decode HTML entities (e.g. &lt; -> <, &amp; -> &)
        text = html.unescape(text)
        # Strip fully-formed HTML tags
        text = re.sub(r'<[^>]*>', ' ', text)
        # Strip any dangling/broken HTML tag formats (e.g. <span style=, </span)
        text = re.sub(r'</?\w+\b[^>]*>?', ' ', text)
        text = re.sub(r'\b(style|class|id|href|src|align|valign|width|height|color|font|family|size|target|rel)=["\'][^"\']*["\']', ' ', text)
        # Remove common HTML tag/component identifiers if they got extracted as words
        text = re.sub(r'\b(strong|span|style|br|div|li|ul|p|ol|html|body|head|titleDescription)\b', ' ', text, flags=re.IGNORECASE)
        # Strip any stray angle brackets
        text = text.replace('<', ' ').replace('>', ' ')
        # Clean multiple spaces/tabs/newlines
        text = re.sub(r'[ \t]+', ' ', text)

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
