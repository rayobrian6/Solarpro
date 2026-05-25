# SolarPro External CV Photo Vision Worker

This worker is a Dockerized external service for SolarPro review-only computer-vision assistance. It runs outside the Next.js/Vercel app and processes actual survey photo bytes after the SolarPro app has authorized the operator request and supplied survey file URLs.

The worker currently supports Stage 1 OpenCV primitives and Stage 2 YOLO/Supervision semantic object detection. All outputs are review-only, non-authoritative, and not CAD geometry. The worker never connects to the SolarPro database and never mutates canonical geometry, `project_physical_data`, permits, BOM, engineering workflow state, or homeowner-facing final outputs.

## Endpoints

```text
GET  /health
POST /v1/photo-vision/jobs
```

`/health` reports tool availability for OpenCV, YOLO, Supervision, Python, and future-stage tools. YOLO availability includes whether a model was loaded, the configured model path, model/runtime version, device, image size, confidence threshold, max detections, and whether the configured weights look solar-specific.

`/v1/photo-vision/jobs` accepts `solarpro_external_photo_vision_job_v1` jobs with survey/project identifiers, `requestedTools`, and authorized file URLs. The default requested tools are `opencv_primitives` and `yolo_detection`.

## Docker usage

```bash
docker build -t solarpro-opencv-photo-vision external-workers/opencv-photo-vision

docker run --rm -p 8080:8080 \
  -e WORKER_PORT=8080 \
  -e YOLO_MODEL_PATH=yolov8n.pt \
  -e YOLO_DEVICE=cpu \
  solarpro-opencv-photo-vision
```

Configure the Next app with:

```bash
OPEN_SOURCE_PHOTO_VISION_WORKER_URL=http://localhost:8080
OPEN_SOURCE_PHOTO_VISION_WORKER_TIMEOUT_MS=30000
```

## Model setup

By default the worker uses `YOLO_MODEL_PATH=yolov8n.pt`. This is a generic pretrained Ultralytics model, not a solar-specific detector. Generic classes are mapped conservatively into probable review cues only. For example, a generic rectangular wall-mounted equipment class may become a `main_service_panel_candidate`, but it is never an authoritative MSP finding.

For production-quality semantic detection, provide custom-trained solar/electrical/roof weights:

```bash
-e YOLO_MODEL_PATH=/models/solarpro-stage2.pt
```

Recommended custom target classes include:

```text
utility_meter
main_service_panel
disconnect
roof_vent
chimney
skylight
obstruction
roof_edge_candidate
solar_array_candidate
battery_wall_candidate
```

If the model, Ultralytics, or Supervision is unavailable, the worker returns explicit diagnostics and emits no semantic object detections. It does not fabricate fallback objects.

## CPU/GPU notes

The default device is CPU:

```bash
YOLO_DEVICE=cpu
```

GPU execution may be configured by the deployment environment and Ultralytics device syntax, but CPU is the safe default. The current Docker image uses `opencv-python-headless` and is intended to remain lightweight enough for external worker deployment, not for Vercel/Next.js runtime execution.

## Safety and performance limits

Environment variables:

```text
MAX_IMAGE_BYTES=16777216
FETCH_TIMEOUT_SECONDS=12
PROCESSING_TIMEOUT_SECONDS=45
MAX_FILES_PER_JOB=12
YOLO_ENABLED=true
YOLO_MODEL_PATH=yolov8n.pt
YOLO_CONFIDENCE_THRESHOLD=0.35
YOLO_IMAGE_SIZE=640
YOLO_MAX_DETECTIONS=24
YOLO_DEVICE=cpu
```

These defaults limit giant images, slow fetches, large batches, and excessive detections. The Next app also applies a worker request timeout via `OPEN_SOURCE_PHOTO_VISION_WORKER_TIMEOUT_MS`.

## Candidate outputs

OpenCV candidates include edge summaries, dominant lines, roof-edge cues, contour rectangles, and obstruction-like regions.

YOLO/Supervision candidates are emitted as `object_detection` candidates with a semantic category such as `utility_meter_candidate`, `main_service_panel_candidate`, `disconnect_candidate`, `roof_vent_candidate`, `chimney_candidate`, `skylight_candidate`, `obstruction_candidate`, `roof_edge_candidate`, `solar_array_candidate`, or `battery_wall_candidate` when supported by model inference and conservative mapping.

Each candidate includes confidence, deterministic hash, run hash, tool/version provenance, model provenance when applicable, normalized `region`/`bbox` coordinates in `normalized_image_0_1000`, review-required flags, non-authoritative flags, and limitations.

## Limitations

This is NOT CAD reconstruction. This is NOT authoritative engineering geometry. This is semantic review assistance only.

YOLO detections can be wrong, especially when using generic pretrained weights. Generic COCO-class mappings are deliberately conservative and must be reviewed by an operator. The worker does not create roof planes, measurements, permit inputs, BOM inputs, CAD geometry, or engineering truth.

Future stages remain separate and are not completed by this worker change: OCR/Tesseract, multi-photo correlation, scale/reference calibration, geometry candidate synthesis, reviewed promotion workflow, Open3D, and FreeCAD/CAD automation.
