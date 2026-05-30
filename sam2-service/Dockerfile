# SAM 2 Segmentation Service — Optimized for Render Starter build plan
#
# Uses python:3.12-slim base with staged pip install to handle
# large packages (torch, torchvision, sam2) without OOM.

FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Skip CUDA extension build — Render runs CPU-only
ENV SAM2_BUILD_CUDA=0
ENV SAM2_BUILD_ALLOW_ERRORS=1

# Minimal system deps for OpenCV + git (for sam2 pip install)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git gcc libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Install torch in stages to limit peak memory:
# 1. numpy first (small, needed by torch)
RUN pip install --no-cache-dir numpy==2.1.2

# 2. torch CPU-only with --no-deps (we install deps separately below)
RUN pip install --no-cache-dir --no-deps \
    torch==2.5.1 \
    --index-url https://download.pytorch.org/whl/cpu

# 3. torch runtime deps (small packages, won't pull CUDA libs)
RUN pip install --no-cache-dir \
    filelock>=3.5.0 \
    jinja2>=3.0 \
    networkx>=3.0 \
    fsspec>=2023.1 \
    sympy>=1.13.1 \
    mpmath>=1.1.0 \
    MarkupSafe>=2.0

# 4. torchvision CPU-only with --no-deps
RUN pip install --no-cache-dir --no-deps \
    torchvision==0.20.1 \
    --index-url https://download.pytorch.org/whl/cpu

# 5. SAM 2 from GitHub (main branch) — --no-deps to avoid torch reinstall
RUN pip install --no-cache-dir --no-deps \
    git+https://github.com/facebookresearch/sam2.git

# 6. SAM 2 runtime deps (excluding torch/torchvision/numpy already installed)
RUN pip install --no-cache-dir \
    tqdm>=4.66.1 \
    hydra-core>=1.3.2 \
    iopath>=0.1.10 \
    omegaconf>=2.3.0

# 7. HuggingFace Hub — needed by build_sam2_hf() to download checkpoints
RUN pip install --no-cache-dir huggingface_hub>=0.30.2

# 8. Remaining app deps (fastapi, uvicorn, opencv, etc.)
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy app code
WORKDIR /app
COPY main.py /app/main.py

# Model cache directory — HF downloads checkpoints here
ENV SAM2_CACHE_DIR=/app/.cache
RUN mkdir -p /app/.cache

# Render injects PORT env var (default 10000 for web services)
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-10000}/health')" || exit 1

CMD ["python3", "main.py"]
