import os
import requests
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HF_API_TOKEN", "")

models = [
    "meta-llama/Llama-3.2-3B-Instruct",
    "meta-llama/Llama-3.1-8B-Instruct",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
    "google/gemma-2-9b-it"
]

headers = {"Authorization": f"Bearer {token}"}

for model in models:
    url = f"https://router.huggingface.co/hf-inference/models/{model}"
    try:
        # Send a minimal dummy input to check if supported
        res = requests.post(url, headers=headers, json={"inputs": "test"}, timeout=10)
        print(f"Model: {model}")
        print(f"  Status: {res.status_code}")
        print(f"  Response: {res.text[:200]}")
    except Exception as e:
        print(f"Model: {model} failed with: {str(e)}")
