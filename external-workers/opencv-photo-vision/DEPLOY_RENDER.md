# Deploying the OpenCV Photo Vision Worker to Render

This guide covers deploying the external OpenCV/YOLO/OCR photo vision worker as a Render Web Service.

## Prerequisites

- A Render account with access to the dashboard
- The `rayobrian6/Solarpro` GitHub repo connected to Render
- The `dev` branch selected as the deploy branch

## Service Configuration

| Setting | Value |
|---|---|
| **Service Type** | Web Service |
| **Name** | `solarpro` |
| **Runtime** | Docker |
| **Root Directory** | `external-workers/opencv-photo-vision` |
| **Branch** | `dev` |
| **Dockerfile Path** | `./Dockerfile` (relative to root dir) |
| **Docker Context** | `.` (relative to root dir) |
| **Plan** | Starter (or higher) |
| **Region** | Oregon (or nearest) |
| **Health Check Path** | `/health` |

## How Render PORT Binding Works

Render injects a `PORT` environment variable at runtime. The Dockerfile CMD respects this with a fallback chain:

```
PORT → WORKER_PORT → 8080
```

- **On Render**: `PORT` is automatically set (typically 10000). The worker binds to it.
- **Locally**: If neither `PORT` nor `WORKER_PORT` is set, it defaults to `8080`.
- **Backward compatible**: You can still set `WORKER_PORT=8080` for local Docker runs.

**Do NOT set `PORT` manually in Render's env vars** — Render manages it automatically.

## Environment Variables

The `render.yaml` at the repo root pre-configures all env vars. If deploying via the Render Dashboard instead, add these:

### Required (with safe defaults)

| Key | Default | Description |
|---|---|---|
| `PYTHONUNBUFFERED` | `1` | Ensures Python logs stream immediately |
| `YOLO_ENABLED` | `true` | Enable/disable YOLO object detection |
| `YOLO_MODEL_PATH` | `yolov8n.pt` | YOLO model weights (COCO nano by default) |
| `YOLO_CONFIDENCE_THRESHOLD` | `0.25` | Minimum detection confidence |
| `YOLO_IMAGE_SIZE` | `640` | Inference image size |
| `YOLO_MAX_DETECTIONS` | `50` | Cap on detections per image |
| `TESSERACT_OCR_ENABLED` | `true` | Enable/disable Tesseract OCR |
| `TESSERACT_OCR_LANGUAGE` | `eng` | Tesseract language pack |
| `TESSERACT_OCR_MIN_CONFIDENCE` | `30` | Minimum OCR confidence (%) |
| `MAX_IMAGE_BYTES` | `20971520` | Max image size in bytes (20 MB) |
| `FETCH_TIMEOUT_SECONDS` | `30` | Timeout for fetching images |
| `MAX_FILES_PER_JOB` | `10` | Max files per job request |
| `PROCESSING_TIMEOUT_SECONDS` | `120` | Overall processing timeout |

### Optional

| Key | Default | Description |
|---|---|---|
| `YOLO_DEVICE` | `cpu` | `cpu` or `cuda` (Starter plan is CPU-only) |
| `TESSERACT_OCR_CONFIG` | — | Custom Tesseract `--oem`/`--psm` flags |
| `TESSERACT_OCR_MAX_CROPS` | `10` | Max YOLO crops to OCR |
| `TESSERACT_OCR_MAX_CANDIDATES` | `20` | Max OCR text candidates |

## System Dependencies (installed in Dockerfile)

The Dockerfile installs these system packages required at runtime:

- `libglib2.0-0` — GLib (needed by OpenCV)
- `libgl1` — OpenGL (needed by OpenCV)
- `tesseract-ocr` — Tesseract OCR engine
- `tesseract-ocr-eng` — English language data for Tesseract

These are pre-installed in the Docker image — no additional Render setup needed.

## Python Packages (installed from requirements.txt)

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | 0.115.6 | Web framework |
| `uvicorn[standard]` | 0.34.0 | ASGI server |
| `opencv-python-headless` | 4.10.0.84 | Image processing (headless, no GUI) |
| `numpy` | 2.2.1 | Numerical computing |
| `Pillow` | 11.0.0 | Image I/O |
| `requests` | 2.32.3 | HTTP client for fetching images |
| `pydantic` | 2.10.4 | Data validation |
| `ultralytics` | 8.3.55 | YOLOv8 object detection |
| `supervision` | 0.25.1 | YOLO result processing |
| `pytesseract` | 0.3.13 | Python wrapper for Tesseract OCR |

## Deployment Steps

### Option A: Using render.yaml (Recommended)

1. Push the `render.yaml` and updated `Dockerfile` to the `dev` branch
2. In the Render Dashboard, click **New** → **Web Service**
3. Connect your GitHub repo and select the `dev` branch
4. Render will auto-detect the `render.yaml` and configure the service
5. Click **Create Web Service** to deploy
6. Wait for the build and health check to pass

### Option B: Manual Dashboard Setup

1. In the Render Dashboard, click **New** → **Web Service**
2. Connect the `rayobrian6/Solarpro` repo
3. Select the `dev` branch
4. Set **Root Directory** to `external-workers/opencv-photo-vision`
5. Set **Runtime** to **Docker**
6. Set **Health Check Path** to `/health`
7. Add the environment variables listed above
8. Click **Create Web Service**

## Post-Deployment Verification

Once deployed, verify the worker is running:

```bash
# Health check
curl https://solarpro.onrender.com/health

# Expected response:
# {
#   "status": "healthy",
#   "schemaVersion": "solarpro_external_photo_vision_health_v1",
#   "tool": "external-opencv-photo-vision-worker",
#   "version": "0.1.0",
#   ...
# }
```

## Connecting to SolarPro Dev

After the worker is deployed and healthy on Render, update the SolarPro dev environment:

1. In Vercel (or `.env.local`), set:
   ```
   OPEN_SOURCE_PHOTO_VISION_WORKER_URL=https://solarpro.onrender.com
   ```
2. Optionally set:
   ```
   OPEN_SOURCE_PHOTO_VISION_WORKER_TIMEOUT_MS=30000
   ```
3. Redeploy the SolarPro dev site if using Vercel env vars
4. Test the "Open-Source Photo Vision Pass" from a site survey page

## Safety Boundaries

This worker is **review-only and non-authoritative**:

- It never mutates the SolarPro database, CAD, permits, BOM, or canonical geometry
- All candidates include `reviewRequired: true` and `nonAuthoritative: true` flags
- Results are persisted as review-only candidates that must be explicitly accepted by a human
- The worker has no access to SolarPro internal systems — it only receives image URLs and returns analysis

## Troubleshooting

| Issue | Solution |
|---|---|
| Build fails at `pip install` | Check `requirements.txt` versions; ensure compatible with Python 3.11 |
| Health check fails | Ensure `PORT` is not manually set in env vars (Render manages it) |
| YOLO model download timeout | First deploy downloads `yolov8n.pt` (~6 MB); subsequent deploys cache it |
| Tesseract not found | Verify Dockerfile includes `tesseract-ocr tesseract-ocr-eng` in apt-get |
| OpenCV import error | Verify `libglib2.0-0` and `libgl1` are in Dockerfile apt-get |
| Worker returns 503 from SolarPro | Check `OPEN_SOURCE_PHOTO_VISION_WORKER_URL` is set and worker is healthy |
