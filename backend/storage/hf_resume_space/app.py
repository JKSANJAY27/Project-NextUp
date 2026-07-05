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

    from huggingface_hub import InferenceClient
    model_id = req.model or "Qwen/Qwen2.5-7B-Instruct"
    
    try:
        messages = []
        if req.system:
            messages.append({"role": "system", "content": req.system})
        messages.append({"role": "user", "content": req.prompt})

        client = InferenceClient(token=hf_token)
        response = client.chat_completion(
            messages=messages,
            model=model_id,
            max_tokens=req.max_tokens or 1024,
            temperature=req.temperature or 0.2,
        )
        generated_text = response.choices[0].message.content or ""
        return {"text": generated_text.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
