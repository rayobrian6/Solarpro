# Geometry Reconstruction Worker — Render Background Service

FROM node:20-slim

WORKDIR /app

# Copy everything
COPY . ./

# Install dependencies
RUN npm install

# Build the worker
RUN npx tsc -p worker/tsconfig.json

# Run the worker
CMD ["node", "worker/dist/worker/main.js"]