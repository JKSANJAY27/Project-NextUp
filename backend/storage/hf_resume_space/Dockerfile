FROM python:3.11-slim

# curl for the Ollama installer + healthchecks, zstd for archive extraction
RUN apt-get update && apt-get install -y --no-install-recommends curl zstd procps \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama using the official installer script
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /code

# Keep model weights inside the image (writable path for the Space user)
ENV OLLAMA_MODELS=/code/ollama/models
# Never unload the model between requests — reloading costs ~1 min on 2 vCPU
ENV OLLAMA_KEEP_ALIVE=-1
ENV OLLAMA_NUM_PARALLEL=1
ENV SPACE_MODEL=qwen2.5:3b

COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Bake the model into the image at BUILD time so a Space restart never has to
# re-download ~2GB (which made the first requests after boot time out).
RUN ollama serve & \
    sleep 6 && \
    ollama pull ${SPACE_MODEL} && \
    pkill ollama

COPY . .

RUN chmod +x start.sh

EXPOSE 7860

CMD ["./start.sh"]
