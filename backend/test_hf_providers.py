import os
import requests
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HF_API_TOKEN", "")

tests = [
    {"provider": "together", "model": "meta-llama/Meta-Llama-3-8B-Instruct"},
    {"provider": "together", "model": "Qwen/Qwen2.5-72B-Instruct"},
    {"provider": "sambanova", "model": "meta-llama/Llama-3.1-8B-Instruct"},
    {"provider": "novita", "model": "meta-llama/Llama-3.1-8B-Instruct"},
    {"provider": "nebius", "model": "meta-llama/Llama-3.1-8B-Instruct"}
]

headers = {"Authorization": f"Bearer {token}"}

for test in tests:
    provider = test["provider"]
    model = test["model"]
    url = f"https://router.huggingface.co/{provider}/models/{model}"
    try:
        res = requests.post(url, headers=headers, json={"inputs": "What is the capital of France?"}, timeout=10)
        print(f"Provider: {provider} | Model: {model}")
        print(f"  Status: {res.status_code}")
        print(f"  Response: {res.text[:200]}")
    except Exception as e:
        print(f"Failed: {str(e)}")
