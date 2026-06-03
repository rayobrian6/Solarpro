# Geometry Reconstruction Worker — Render Background Service
#
# Runs the Pipeline B worker that polls Neon DB for queued jobs,
# claims them atomically, and executes the full reconstruction pipeline
# (segmentation → line extraction → vanishing points → depth → planes →
# multi-view fusion → photogrammetry).
#
# Build context: repo root (needs access to lib/ and worker/ directories)
# Build:  docker build -f worker/Dockerfile -t geom-recon-worker .
# Run:    docker run --env-file .env geom-recon-worker

FROM node:20-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts && \
    npm install --save-dev typescript @types/node

# Copy source files needed for worker compilation
COPY lib/ lib/
COPY worker/ worker/
COPY tsconfig.json ./

# Build the worker
RUN npx tsc -p worker/tsconfig.json

# Remove dev dependencies after build to reduce image size
RUN npm prune --omit=dev 2>/dev/null || true

# Health check — verify the worker process is running
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep -f "node worker/dist/worker/main.js" > /dev/null || exit 1

# Run the worker
CMD ["node", "worker/dist/worker/main.js"]
