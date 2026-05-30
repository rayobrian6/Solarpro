# SAM 2 Segmentation Service — Pre-built PyTorch base for Render
#
# Uses the official PyTorch CPU image so torch is ALREADY INSTALLED
# in the base layer. This avoids the OOM issue during pip install torch
# on Render's starter build plan (512MB RAM).
#
# CPU inference: ~5-10s/image. GPU: upgrade to CUDA base image later.

FROM pytorch/pytorch:2.5.1-cpu-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install git (for SAM 2 pip install) + OpenCV runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install SAM 2 from GitHub (torch is already in the base image)
RUN pip install --no-cache-dir \
    git+https://github.com/facebookresearch/sam2.git@v1.1.0

# Install app dependencies (no torch/sam2 in this file — already installed)
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
