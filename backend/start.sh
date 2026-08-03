#!/bin/bash
export PYTHONUNBUFFERED=1

# Start Ollama service in the background ONLY if OLLAMA_BASE_URL points to localhost/127.0.0.1 and DISABLE_OLLAMA is not true
OLLAMA_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
if [ "$DISABLE_OLLAMA" != "true" ] && ( [[ "$OLLAMA_URL" == *"localhost"* ]] || [[ "$OLLAMA_URL" == *"127.0.0.1"* ]] ); then
    echo "Starting local Ollama service..."
    ollama serve &
    sleep 3
else
    echo "Skipping local Ollama service (OLLAMA_BASE_URL=$OLLAMA_URL, DISABLE_OLLAMA=${DISABLE_OLLAMA:-false})."
fi

# Start the FastAPI backend on the port expected by environment or fallback to 7860
PORT=${PORT:-7860}
echo "Starting FastAPI backend on port $PORT..."
exec uvicorn app.main:app --host 0.0.0.0 --port $PORT

