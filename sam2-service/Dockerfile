# SAM 2 Segmentation Service — Minimal Docker image for Render
#
# Strategy: Install PyTorch CPU first (small download, ~200MB),
# then SAM 2 and remaining deps. Single-stage to keep it simple.

FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install only what's needed for pip install + OpenCV runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    gcc \
    g++ \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU-only first (smallest possible, ~200MB vs 2GB+ for CUDA)
# This avoids OOM during pip install on Render's starter build plan
RUN pip install --no-cache-dir --no-deps torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir --no-deps torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir numpy==1.26.4 pillow

# Install SAM 2 (depends on torch already installed above)
RUN pip install --no-cache-dir git+https://github.com/facebookresearch/sam2.git@v1.1.0

# Install remaining app dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy application code
WORKDIR /app
COPY main.py /app/main.py

# Model cache directory
ENV SAM2_CACHE_DIR=/app/.cache
RUN mkdir -p /app/.cache

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python3", "main.py"]
