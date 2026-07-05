#!/bin/bash

# Start Ollama service in the background
echo "Starting Ollama..."
ollama serve &

# Wait for Ollama to start
sleep 3

# Start the FastAPI backend on the port expected by Hugging Face/environment or fallback to 8000
PORT=${PORT:-7860}
echo "Starting FastAPI backend on port $PORT..."
exec uvicorn app.main:app --host 0.0.0.0 --port $PORT
