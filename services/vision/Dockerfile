# ─────────────────────────────────────────────────────────────────────────────
# services/vision/Dockerfile
# SolarVision — YOLOv8 inference service
#
# Build:
#   docker build -t solarvision:latest -f services/vision/Dockerfile .
#
# Run (CPU):
#   docker run --rm -p 8001:8001 \
#     -e VISION_MODEL_PATH=/app/models/solarvision.pt \
#     -v $(pwd)/services/vision/models:/app/models:ro \
#     solarvision:latest
#
# Run (GPU — requires nvidia-container-toolkit):
#   docker run --rm --gpus all -p 8001:8001 \
#     -e VISION_MODEL_PATH=/app/models/solarvision.pt \
#     -v $(pwd)/services/vision/models:/app/models:ro \
#     solarvision:latest
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

# system deps needed to build opencv / pillow wheel
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender-dev \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# copy only requirements first (layer caching)
COPY services/vision/requirements.txt .

RUN pip install --upgrade pip && \
    pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

LABEL maintainer="SolarPro Engineering <eng@solarpro.com>" \
      version="1.0.0" \
      description="SolarVision YOLOv8 inference service"

# runtime system libraries (no build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libgomp1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# copy installed Python packages from builder
COPY --from=builder /install /usr/local

# ── app ──────────────────────────────────────────────────────────────────────
WORKDIR /app

# copy inference service source
COPY services/vision/infer.py    ./infer.py
COPY services/vision/server.py   ./server.py
COPY services/vision/validate.py ./validate.py
COPY services/vision/train.py    ./train.py
COPY services/vision/start.sh    ./start.sh

# models directory — mount a volume here for custom checkpoint
RUN mkdir -p /app/models

# non-root user for security
RUN useradd -m -u 1001 vision && chown -R vision:vision /app
USER vision

# ── environment defaults ──────────────────────────────────────────────────────
ENV VISION_PORT=8001 \
    VISION_HOST=0.0.0.0 \
    VISION_WORKERS=1 \
    VISION_LOG_LEVEL=info \
    VISION_CONF_THRESHOLD=0.25 \
    VISION_IOU_THRESHOLD=0.45 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8001

# ── health check ─────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:${VISION_PORT}/health || exit 1

# ── entrypoint ────────────────────────────────────────────────────────────────
RUN chmod +x /app/start.sh
ENTRYPOINT ["/app/start.sh"]