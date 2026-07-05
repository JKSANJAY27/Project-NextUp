#!/bin/bash
set -e

MODEL="${SPACE_MODEL:-qwen2.5:3b}"

echo "Starting Ollama server..."
ollama serve &

# Wait until Ollama actually answers (up to 60s) instead of a blind sleep
echo "Waiting for Ollama to become ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags > /dev/null; then
    echo "Ollama is ready."
    break
  fi
  sleep 2
done

# Model is baked into the image at build time; pull only if somehow missing.
if ! curl -sf http://localhost:11434/api/tags | grep -q "$MODEL"; then
  echo "Model $MODEL missing — pulling (one-time)..."
  ollama pull "$MODEL"
fi

# Warm-up: load weights into RAM now so the first real request doesn't pay
# the ~1 minute model-load cost on top of generation time.
echo "Warming up $MODEL..."
curl -s http://localhost:11434/api/generate \
  -d "{\"model\": \"$MODEL\", \"prompt\": \"OK\", \"stream\": false, \"options\": {\"num_predict\": 1}}" \
  > /dev/null || true
echo "Warm-up complete."

# Plain uvicorn — gunicorn's worker timeout was killing long generations.
echo "Starting FastAPI on port 7860..."
exec uvicorn app:app --host 0.0.0.0 --port 7860 --timeout-keep-alive 75
