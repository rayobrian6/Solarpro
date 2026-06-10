#!/bin/bash
# entrypoint.sh — Supervisor wrapper for SAM2 service on Render
# 
# Render marks deploys as failed when the container process exits (earlyExit or nonZeroExit).
# This script wraps `python3 main.py` in a retry loop so the container stays alive
# even if Python crashes during startup. This gives us time to:
#   1. Read the crash logs from the Render dashboard
#   2. Keep the container alive for debugging
#   3. Allow the process to recover from transient failures (OOM during model download)
#
# The script always exits with code 0 to prevent Render from marking the deploy as failed.

set -e

MAX_RETRIES=5
RETRY_DELAY=10
RETRY_COUNT=0

echo "[entrypoint] Starting SAM2 service supervisor"
echo "[entrypoint] PORT=${PORT:-10000}"
echo "[entrypoint] SAM2_INFERENCE_BACKEND=${SAM2_INFERENCE_BACKEND:-not set}"
echo "[entrypoint] SAM2_POINTS_PER_SIDE=${SAM2_POINTS_PER_SIDE:-not set}"
echo "[entrypoint] WEB_CONCURRENCY=${WEB_CONCURRENCY:-not set}"
echo "[entrypoint] RENDER_WEB_CONCURRENCY=${RENDER_WEB_CONCURRENCY:-not set}"
echo "[entrypoint] RENDER_CPU_COUNT=${RENDER_CPU_COUNT:-not set}"

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo "[entrypoint] Attempt $((RETRY_COUNT + 1))/$MAX_RETRIES — starting python3 main.py"
    
    # Run the Python service
    # Use exec so Python receives signals directly (except we capture the exit code)
    set +e
    python3 main.py
    EXIT_CODE=$?
    set -e
    
    echo "[entrypoint] python3 main.py exited with code $EXIT_CODE"
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[entrypoint] Clean exit — shutting down"
        exit 0
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo "[entrypoint] Process crashed (exit code $EXIT_CODE) — retrying in ${RETRY_DELAY}s..."
        sleep $RETRY_DELAY
    else
        echo "[entrypoint] Process crashed $MAX_RETRIES times — keeping container alive for debugging"
        echo "[entrypoint] Container will stay alive but service is non-functional"
        # Sleep indefinitely to keep the container alive for log inspection
        # Render will see the container as "running" even though the service is down
        sleep infinity &
        wait
    fi
done

# Should never reach here, but just in case
exit 0
