# SolarPro External OpenCV Photo Vision Worker — Stage 1

This Dockerized service is the Stage 1 external worker boundary for SolarPro photo vision. It processes authorized survey photo URLs sent by the Next.js app, fetches actual image bytes, runs OpenCV edge/line/contour/rectangle extraction, and returns review-only candidates.

The worker never connects to the SolarPro database and never writes canonical evidence, CAD geometry, permit inputs, BOM inputs, engineering facts, or homeowner-facing outputs. SolarPro remains responsible for authorization, job creation, result validation, persistence, and review UI.

Run locally:

```bash
docker build -t solarpro-opencv-photo-vision external-workers/opencv-photo-vision
docker run --rm -p 8080:8080 solarpro-opencv-photo-vision
curl http://localhost:8080/health
```

Configure the Next.js app with:

```bash
OPEN_SOURCE_PHOTO_VISION_WORKER_URL=http://localhost:8080
OPEN_SOURCE_PHOTO_VISION_WORKER_TIMEOUT_MS=30000
```

API:

- `GET /health` returns worker/tool availability.
- `POST /v1/photo-vision/jobs` accepts `solarpro_external_photo_vision_job_v1` jobs and returns `solarpro_external_photo_vision_result_v1` review-only results.
