# Geometry Reconstruction Worker — Render Background Service
#
# Runs the Pipeline B worker that polls Neon DB for queued jobs,
# claims them atomically, and executes the full reconstruction pipeline.
#
# Build context: repo root (needs access to lib/ and worker/ directories)
# Build:  docker build -f worker/Dockerfile -t geom-recon-worker .
# Run:    docker run --env-file .env geom-recon-worker

FROM node:20-slim

WORKDIR /app

# Install build dependencies for sharp (native image processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy everything
COPY . ./

# Install dependencies
RUN npm install

# Bundle the worker with esbuild (resolves TypeScript path aliases at build time)
# sharp must be --external because it has native binaries that can't be bundled
RUN npx esbuild worker/main.ts \
    --bundle \
    --platform=node \
    --target=node20 \
    --outfile=worker/dist/worker/bundle.js \
    --resolve-extensions=.ts,.js \
    --alias:@=. \
    --external:@neondatabase/serverless \
    --external:uuid \
    --external:sharp \
    --log-level=info

# Run the bundled worker
CMD ["node", "worker/dist/worker/bundle.js"]
