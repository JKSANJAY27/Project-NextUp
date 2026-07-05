import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="NextUp Resume Generation Space Mock")

class GenerateRequest(BaseModel):
    prompt: str
    system: Optional[str] = ""
    model: Optional[str] = ""
    max_tokens: Optional[int] = 1024
    temperature: Optional[float] = 0.2
    json: Optional[bool] = False

@app.get("/health")
def health():
    return {
        "status": "up",
        "model": os.getenv("MODEL_NAME", "Qwen/Qwen2.5-7B-Instruct")
    }

@app.post("/api/generate")
def generate(req: GenerateRequest):
    # This mock space mimics the remote HF space behaviour.
    # It would run local inference or proxy to an LLM provider.
    # For local testing, we return a mock response or use HF serverless client.
    hf_token = os.getenv("HF_API_TOKEN", "")
    if not hf_token:
        # Mock payload if token is missing
        return {"text": '{"optimized_summary": "Tailored summary from mock space.", "optimized_skills": [], "optimized_projects": []}'}

    import requests
    model_id = req.model or "Qwen/Qwen2.5-7B-Instruct"
    api_url = f"https://api-inference.huggingface.co/models/{model_id}"
    headers = {"Authorization": f"Bearer {hf_token}"}
    
    # Compile prompt with system instruction
    full_prompt = f"{req.system}\n\n{req.prompt}" if req.system else req.prompt

    try:
        response = requests.post(
            api_url,
            headers=headers,
            json={
                "inputs": full_prompt,
                "parameters": {
                    "max_new_tokens": req.max_tokens,
                    "temperature": req.temperature,
                    "return_full_text": False
                }
            },
            timeout=30
        )
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)
            
        res_json = response.json()
        if isinstance(res_json, list) and len(res_json) > 0:
            generated_text = res_json[0].get("generated_text", "").strip()
        elif isinstance(res_json, dict):
            generated_text = res_json.get("generated_text", "").strip()
        else:
            generated_text = str(res_json).strip()
            
        return {"text": generated_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
