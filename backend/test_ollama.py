import requests
import os
from dotenv import load_dotenv

load_dotenv()

ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip('/')
model = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")

print(f"Ollama URL: {ollama_url}")
print(f"Ollama Model: {model}")

try:
    # 1. Test base URL / health check
    res = requests.get(ollama_url, timeout=10)
    print(f"Health response code: {res.status_code}")
    print(f"Health response text: {res.text[:200]}")
    
    # 2. Test generation API with a simple prompt
    payload = {
        "model": model,
        "prompt": "Hello",
        "stream": False,
        "options": {
            "temperature": 0.0
        }
    }
    print("Testing generate API...")
    res_gen = requests.post(f"{ollama_url}/api/generate", json=payload, timeout=20)
    print(f"Generate response code: {res_gen.status_code}")
    print(f"Generate response text: {res_gen.text[:500]}")
    
except Exception as e:
    print(f"Error connecting to Ollama: {str(e)}")
