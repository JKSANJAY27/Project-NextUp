FROM python:3.9-slim

# Install curl and zstd to download and extract Ollama binary
RUN apt-get update && apt-get install -y curl zstd && rm -rf /var/lib/apt/lists/*

# Install Ollama using official installer script
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /code

COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY . .

# Ensure start script has executable permissions
RUN chmod +x start.sh

CMD ["./start.sh"]
