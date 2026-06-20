import os
import sys
sys.stdout.reconfigure(encoding='utf-8')

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from app.services.pdf_extractor import extract_text_from_pdf

pdf_path = "../test_resume.pdf"
if not os.path.exists(pdf_path):
    pdf_path = "D:/Sanjay/B.Tech CSE/nextup/test_resume.pdf"

with open(pdf_path, "rb") as f:
    pdf_bytes = f.read()

text = extract_text_from_pdf(pdf_bytes)
print("--- Extracted Text ---")
print(text)
print("--- End of Extracted Text ---")
