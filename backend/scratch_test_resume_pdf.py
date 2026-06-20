import os
import sys
import json
sys.stdout.reconfigure(encoding='utf-8')

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.services.resume_parser import parse_resume_pdf

pdf_path = "../test_resume.pdf"
if not os.path.exists(pdf_path):
    # Fallback to local root if path is different
    pdf_path = "D:/Sanjay/B.Tech CSE/nextup/test_resume.pdf"

if not os.path.exists(pdf_path):
    print(f"Error: test_resume.pdf not found at {pdf_path}")
    sys.exit(1)

print(f"Loading PDF from {pdf_path}...")
with open(pdf_path, "rb") as f:
    pdf_bytes = f.read()

print("Parsing PDF...")
# Disable OLLAMA in environment to force fallback/HuggingFace flow
os.environ["DISABLE_OLLAMA"] = "true"
os.environ["HF_API_TOKEN"] = "invalid_token_to_force_regex_fallback"

parsed = parse_resume_pdf(pdf_bytes)
print("Parsing completed successfully!")

print("\n--- Parsed Candidate Information ---")
print(f"Name: {parsed.get('full_name')}")
print(f"Branch: {parsed.get('branch')}")
print(f"Batch Year: {parsed.get('batch_year')}")
print(f"CGPA: {parsed.get('cgpa')}")
print(f"10th Marks: {parsed.get('tenth_marks')}")
print(f"12th Marks: {parsed.get('twelfth_marks')}")

print("\n--- Parsed Resume Data ---")
rd = parsed.get("resume_data", {})
print(f"Summary: {rd.get('summary')}")
print(f"Skills: {rd.get('skills')}")
print(f"Education Count: {len(rd.get('education', []))}")
for i, edu in enumerate(rd.get('education', [])):
    print(f"  Edu {i+1}: {edu['degree']} at {edu['institution']} ({edu['year']}) -> Score: {edu['score']}")

print(f"Experience Count: {len(rd.get('experience', []))}")
for i, exp in enumerate(rd.get('experience', [])):
    print(f"  Exp {i+1}: {exp['role']} at {exp['company']} ({exp['period']})")
    print(f"    Description: {exp['description'][:100]}...")

print(f"Projects Count: {len(rd.get('projects', []))}")
for i, proj in enumerate(rd.get('projects', [])):
    print(f"  Proj {i+1}: {proj['title']} (Tech: {proj['tech']})")
    print(f"    Description: {proj['description'][:100]}...")

print(f"Awards (Patents/Achievements) Count: {len(rd.get('awards', []))}")
for i, aw in enumerate(rd.get('awards', [])):
    print(f"  Award {i+1}: {aw}")
