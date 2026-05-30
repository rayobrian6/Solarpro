# SAM 2 Segmentation Service — Optimized for Render Performance build plan
#
# Uses python:3.12-slim base with staged pip install to handle
# large packages (torch, torchvision, sam2) without OOM.

FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Minimal system deps for OpenCV + git (for sam2 pip install)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git gcc libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Install torch in stages to limit peak memory:
# 1. numpy first (small, needed by torch)
RUN pip install --no-cache-dir numpy==2.1.2

# 2. torch CPU-only with --no-deps
RUN pip install --no-cache-dir --no-deps \
    torch==2.5.1 \
    --index-url https://download.pytorch.org/whl/cpu

# 3. torchvision CPU-only with --no-deps
RUN pip install --no-cache-dir --no-deps \
    torchvision==0.20.1 \
    --index-url https://download.pytorch.org/whl/cpu

# 4. SAM 2 from GitHub
RUN pip install --no-cache-dir \
    git+https://github.com/facebookresearch/sam2.git@v1.1.0

# 5. Remaining deps (fastapi, uvicorn, etc.)
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy app code
WORKDIR /app
COPY main.py /app/main.py

# Model cache directory
ENV SAM2_CACHE_DIR=/app/.cache
RUN mkdir -p /app/.cache

# Render injects PORT env var (default 10000 for web services)
# Do NOT hardcode PORT here — let Render control it
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-10000}/health')" || exit 1

CMD ["python3", "main.py"]
