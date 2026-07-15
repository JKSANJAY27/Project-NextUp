#!/bin/bash
set -e

MODEL="${SPACE_MODEL:-qwen2.5:3b}"

# CRITICAL ORDER: uvicorn must bind port 7860 FIRST. Hugging Face kills the
# Space ("Launch timed out, workload was not healthy after 30 min") when
# nothing answers on the app port — and a cold `ollama pull` of ~2GB on
# free-tier hardware takes far longer than 30 minutes. Ollama therefore
# bootstraps in the background; /api/generate returns 503 until the model is
# ready and the backend gateway treats that as "busy, try next provider".
echo "Starting FastAPI on port 7860 (Ollama bootstraps in background)..."
uvicorn app:app --host 0.0.0.0 --port 7860 --timeout-keep-alive 75 &
UVICORN_PID=$!

(
  echo "Starting Ollama server..."
  ollama serve &

  echo "Waiting for Ollama to become ready..."
  for i in $(seq 1 90); do
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
  curl -s --max-time 600 http://localhost:11434/api/generate \
    -d "{\"model\": \"$MODEL\", \"prompt\": \"OK\", \"stream\": false, \"options\": {\"num_predict\": 1}}" \
    > /dev/null || true
  echo "Warm-up complete."
) &

# Container lives (and dies) with uvicorn.
wait $UVICORN_PID
