import os
import requests
import json
from dotenv import load_dotenv

load_dotenv("d:/Sanjay/B.Tech CSE/nextup/backend/.env")

hf_token = os.getenv("HF_API_TOKEN", "")
headers = {
    "Authorization": f"Bearer {hf_token}",
    "Content-Type": "application/json"
}

email_body = "Subject: Test\nBody: Company: Google\nRole: SWE\nCTC: 35 LPA"
from app.services.email_parser import get_parser_prompt
prompt = get_parser_prompt(email_body)

payload = {
    "model": "meta-llama/Llama-3.3-70B-Instruct",
    "messages": [
        {"role": "system", "content": "You are a structured data extractor. Output only valid JSON. No markdown."},
        {"role": "user", "content": prompt}
    ],
    "max_tokens": 1500,
    "temperature": 0.1,
    "response_format": {"type": "json_object"}
}

url = "https://router.huggingface.co/v1/chat/completions"
print("Calling router.huggingface.co/v1/chat/completions...")
try:
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    print("Status Code:", resp.status_code)
    print("Content:", resp.text[:1000])
except Exception as e:
    print("Error:", e)
