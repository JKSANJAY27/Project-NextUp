#!/bin/bash

# Start Ollama server in the background
echo "Starting Ollama server..."
ollama serve &

# Wait for Ollama to spin up
sleep 6

# Pull Qwen 2.5 3B model locally inside the container
echo "Pulling qwen2.5:3b model..."
ollama pull qwen2.5:3b

# Start FastAPI application using gunicorn/uvicorn on port 7860
echo "Starting FastAPI application..."
gunicorn -w 1 -k uvicorn.workers.UvicornWorker app:app --bind 0.0.0.0:7860 --timeout 120
