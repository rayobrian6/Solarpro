#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# services/vision/start.sh
# Entrypoint for the SolarVision inference container / local dev server.
#
# Usage:
#   ./start.sh                    # start API server (default)
#   ./start.sh server             # same as above
#   ./start.sh train              # run training
#   ./start.sh validate           # run validation
#   ./start.sh bash               # drop into shell (dev/debug)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── config (all overridable via env) ─────────────────────────────────────────
VISION_PORT="${VISION_PORT:-8001}"
VISION_HOST="${VISION_HOST:-0.0.0.0}"
VISION_WORKERS="${VISION_WORKERS:-1}"
VISION_LOG_LEVEL="${VISION_LOG_LEVEL:-info}"
MODEL_PATH="${VISION_MODEL_PATH:-}"

CMD="${1:-server}"

echo "════════════════════════════════════════════════════════"
echo "  SolarVision Vision Service"
echo "  Command  : ${CMD}"
echo "  Port     : ${VISION_PORT}"
echo "  Workers  : ${VISION_WORKERS}"
if [[ -n "${MODEL_PATH}" ]]; then
  echo "  Model    : ${MODEL_PATH}"
else
  echo "  Model    : auto-detect (models/solarvision.pt or yolov8n.pt)"
fi
echo "════════════════════════════════════════════════════════"

# ── wait for model file to be available (if MODEL_PATH is set) ───────────────
if [[ -n "${MODEL_PATH}" && ! -f "${MODEL_PATH}" ]]; then
  echo "[start.sh] WARNING: VISION_MODEL_PATH=${MODEL_PATH} not found."
  echo "[start.sh]          Continuing — server will fall back to yolov8n.pt"
fi

case "${CMD}" in
  server)
    echo "[start.sh] Starting FastAPI server..."
    exec uvicorn server:app \
      --host "${VISION_HOST}" \
      --port "${VISION_PORT}" \
      --workers "${VISION_WORKERS}" \
      --log-level "${VISION_LOG_LEVEL}" \
      --no-access-log
    ;;

  train)
    echo "[start.sh] Starting YOLOv8 training..."
    exec python3 train.py "${@:2}"
    ;;

  validate)
    echo "[start.sh] Running validation..."
    exec python3 validate.py --save-json "${@:2}"
    ;;

  bash|shell)
    echo "[start.sh] Dropping into bash shell..."
    exec /bin/bash
    ;;

  *)
    echo "[start.sh] ERROR: Unknown command '${CMD}'"
    echo "[start.sh]        Valid commands: server | train | validate | bash"
    exit 1
    ;;
esac