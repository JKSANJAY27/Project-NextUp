import os
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="NextUp Resume Generation Space")

class GenerateRequest(BaseModel):
    prompt: str
    system: Optional[str] = ""
    model: Optional[str] = "qwen2.5:3b"
    max_tokens: Optional[int] = 1024
    temperature: Optional[float] = 0.2
    json: Optional[bool] = False

@app.get("/health")
def health():
    return {"status": "up", "model": "qwen2.5:3b"}

@app.post("/api/generate")
def generate(req: GenerateRequest):
    # Call the local Ollama instance running inside the container
    ollama_url = "http://localhost:11434/api/generate"
    
    # Format the prompt with system instruction
    full_prompt = f"{req.system}\n\n{req.prompt}" if req.system else req.prompt
    
    payload = {
        "model": "qwen2.5:3b",
        "prompt": full_prompt,
        "stream": False,
        "options": {
            "temperature": req.temperature or 0.2,
            "num_predict": req.max_tokens or 1024,
        }
    }
    
    if req.json:
        payload["format"] = "json"

    try:
        response = requests.post(ollama_url, json=payload, timeout=180)
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        
        response_data = response.json()
        generated_text = response_data.get("response", "").strip()
        return {"text": generated_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
