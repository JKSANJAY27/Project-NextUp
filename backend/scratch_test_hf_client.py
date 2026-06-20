import os
from dotenv import load_dotenv
load_dotenv("d:/Sanjay/B.Tech CSE/nextup/backend/.env")

try:
    from huggingface_hub import InferenceClient
    client = InferenceClient(api_key=os.getenv("HF_API_TOKEN"))
    
    print("Calling InferenceClient.chat.completions...")
    response = client.chat.completions.create(
        model="Qwen/Qwen2.5-72B-Instruct",
        messages=[{"role": "user", "content": "Hello"}],
        max_tokens=20
    )
    print("Success!")
    print(response.choices[0].message.content)
except Exception as e:
    print("Error:", e)
