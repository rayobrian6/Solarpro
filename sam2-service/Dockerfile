# SAM 2 Segmentation Service — Docker image for Render deployment
#
# Works on both CPU (standard plan) and GPU (pro+ plan) instances.
# On GPU instances, PyTorch auto-detects CUDA. On CPU, falls back gracefully.
#
# Build: docker build -t sam2-service .
# Run:   docker run -p 8000:8000 sam2-service

# Stage 1: Build dependencies
FROM python:3.11-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install build tools (needed for SAM 2 from source and OpenCV)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch with CUDA 12.4 support.
# On CPU-only hosts, torch.cuda.is_available() returns False and inference
# runs on CPU (~5-10s/image). On GPU hosts, CUDA is auto-detected (~1-2s/image).
RUN pip install --no-cache-dir \
    torch==2.5.1 \
    torchvision==0.20.1 \
    --index-url https://download.pytorch.org/whl/cu124

# Install SAM 2 from GitHub
RUN pip install --no-cache-dir \
    git+https://github.com/facebookresearch/sam2.git@v1.1.0

# Install remaining dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# ---------------------------------------------------------------------------
# Stage 2: Runtime image (smaller, no build tools)
# ---------------------------------------------------------------------------
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install minimal runtime dependencies for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
WORKDIR /app
COPY main.py /app/main.py

# Model cache directory
ENV SAM2_CACHE_DIR=/app/.cache
RUN mkdir -p /app/.cache

# Render sets PORT env var automatically
ENV PORT=8000
EXPOSE 8000

# Health check — Render uses this to verify deployment
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Start the service
CMD ["python3", "main.py"]
