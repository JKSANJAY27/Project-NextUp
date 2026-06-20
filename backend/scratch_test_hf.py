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
    "model": "Qwen/Qwen2.5-72B-Instruct",
    "messages": [
        {"role": "system", "content": "You are a structured data extractor. Output only valid JSON. No markdown."},
        {"role": "user", "content": prompt}
    ],
    "max_tokens": 1500,
    "temperature": 0.1,
    "response_format": {"type": "json_object"}
}

# Test 1: Standard model endpoint
url1 = "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-72B-Instruct/v1/chat/completions"
print("Calling standard Qwen2.5-72B...")
try:
    resp = requests.post(url1, headers=headers, json=payload, timeout=30)
    print("Standard Qwen2.5-72B Status:", resp.status_code)
    print("Standard Qwen2.5-72B Content:", resp.text[:500])
except Exception as e:
    print("Error url1:", e)

# Test 2: Llama-3.3-70B on router
payload_llama = payload.copy()
payload_llama["model"] = "meta-llama/Llama-3.3-70B-Instruct"
url2 = "https://router.huggingface.co/hf-inference/v1/chat/completions"
print("\nCalling Llama-3.3-70B on router...")
try:
    resp = requests.post(url2, headers=headers, json=payload_llama, timeout=30)
    print("Llama router Status:", resp.status_code)
    print("Llama router Content:", resp.text[:500])
except Exception as e:
    print("Error url2:", e)

# Test 3: Llama-3.3-70B on standard URL
url3 = "https://api-inference.huggingface.co/models/meta-llama/Llama-3.3-70B-Instruct/v1/chat/completions"
print("\nCalling Llama-3.3-70B on standard URL...")
try:
    resp = requests.post(url3, headers=headers, json=payload_llama, timeout=30)
    print("Llama standard Status:", resp.status_code)
    print("Llama standard Content:", resp.text[:500])
except Exception as e:
    print("Error url3:", e)
