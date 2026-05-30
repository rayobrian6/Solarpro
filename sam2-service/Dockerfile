# SAM 2 Segmentation Service — Ultra-minimal for Render starter build
#
# This Dockerfile is designed specifically for Render's 512MB build plan.
# It uses a tiny base image and installs packages one at a time with
# --no-cache-dir and --no-deps to minimize peak memory usage.

FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Minimal system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    gcc \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install torch in stages to limit memory:
# 1. First install numpy (small, needed by torch)
RUN pip install --no-cache-dir numpy==2.1.2

# 2. Install torch core with --no-deps (we already have numpy)
RUN pip install --no-cache-dir --no-deps \
    torch==2.5.1 \
    --index-url https://download.pytorch.org/whl/cpu

# 3. Install torchvision with --no-deps
RUN pip install --no-cache-dir --no-deps \
    torchvision==0.20.1 \
    --index-url https://download.pytorch.org/whl/cpu

# 4. Install SAM 2
RUN pip install --no-cache-dir \
    git+https://github.com/facebookresearch/sam2.git@v1.1.0

# 5. Install remaining deps
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy app
WORKDIR /app
COPY main.py /app/main.py

ENV SAM2_CACHE_DIR=/app/.cache
RUN mkdir -p /app/.cache

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python3", "main.py"]
