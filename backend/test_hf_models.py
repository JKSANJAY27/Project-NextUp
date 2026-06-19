import os
import requests
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HF_API_TOKEN", "")

models = [
    "Qwen/Qwen2.5-72B-Instruct",
    "Qwen/Qwen2.5-7B-Instruct",
    "meta-llama/Meta-Llama-3-8B-Instruct",
    "mistralai/Mistral-7B-Instruct-v0.3",
    "microsoft/Phi-3-mini-4k-instruct"
]

headers = {"Authorization": f"Bearer {token}"}

for model in models:
    url = f"https://router.huggingface.co/hf-inference/models/{model}"
    try:
        # Send a minimal dummy input to check if supported
        res = requests.post(url, headers=headers, json={"inputs": "test"}, timeout=5)
        print(f"Model: {model}")
        print(f"  Status: {res.status_code}")
        print(f"  Response: {res.text[:200]}")
    except Exception as e:
        print(f"Model: {model} failed with: {str(e)}")
