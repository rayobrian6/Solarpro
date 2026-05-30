# SAM 2 Segmentation Service — Docker image for Render GPU deployment
#
# Build: docker build -t sam2-service .
# Run:   docker run -p 8000:8000 --gpus all sam2-service
#
# Render deployment: uses this Dockerfile automatically

# Stage 1: Install SAM 2 from source (requires build tools)
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS builder

# Avoid interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    git \
    wget \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set up Python
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

# Install PyTorch with CUDA support
RUN pip3 install --no-cache-dir \
    torch==2.5.1 \
    torchvision==0.20.1 \
    --index-url https://download.pytorch.org/whl/cu124

# Install SAM 2 from GitHub
RUN pip3 install --no-cache-dir \
    git+https://github.com/facebookresearch/sam2.git@v1.1.0

# Install remaining dependencies
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

# ---------------------------------------------------------------------------
# Stage 2: Runtime image (smaller, no build tools)
# ---------------------------------------------------------------------------
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/dist-packages /usr/local/lib/python3.11/dist-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
WORKDIR /app
COPY main.py /app/main.py

# Model cache directory — Render persistent disk mounts here
ENV SAM2_CACHE_DIR=/app/.cache
RUN mkdir -p /app/.cache

# Render sets PORT env var automatically
ENV PORT=8000
EXPOSE 8000

# Health check — Render uses this to verify deployment
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Start the service
CMD ["python3", "main.py"]
