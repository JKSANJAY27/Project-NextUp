import os
import requests
import json
from dotenv import load_dotenv

load_dotenv("d:/Sanjay/B.Tech CSE/nextup/backend/.env")
token = os.getenv("HF_API_TOKEN", "")
headers = {"Authorization": f"Bearer {token}"}

url = "https://router.huggingface.co/v1/models"
try:
    res = requests.get(url, headers=headers, timeout=10)
    print("Status:", res.status_code)
    if res.status_code == 200:
        models_data = res.json()
        print(f"Total models available: {len(models_data.get('data', []))}")
        # Print first 20 model IDs
        for model in models_data.get('data', [])[:30]:
            print(f"- {model.get('id')}")
    else:
        print("Response:", res.text)
except Exception as e:
    print("Error:", e)
