FROM python:3.11-slim

# Install system dependencies, curl, procps (for pkill), tesseract-ocr, zstd, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    procps \
    libpq-dev \
    tesseract-ocr \
    zstd \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Configure Ollama models to reside inside a writable project subfolder
ENV OLLAMA_MODELS=/app/ollama/models

# Never buffer Python stdout/stderr: the last failed deploy showed ZERO
# uvicorn output for 14 minutes — with buffering on, we couldn't tell where
# boot was stuck. Unbuffered logs make the next hang diagnosable in Render.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copy and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend files
COPY . .

# Run Ollama briefly during build time, pull model, and clean up processes so it's baked into the image
RUN ollama serve & \
    sleep 5 && \
    ollama pull qwen2.5:1.5b && \
    pkill ollama

# Expose port 8000 (standard backend port, can be overridden by HF Space $PORT)
EXPOSE 7860

# Add executable permissions to start script
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
# Trigger Hugging Face auto-sync workflow with tracked files only


