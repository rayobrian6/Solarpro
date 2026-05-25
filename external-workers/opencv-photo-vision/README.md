# SolarPro External CV Photo Vision Worker

This worker is a Dockerized external service for SolarPro review-only computer-vision assistance. It runs outside the Next.js/Vercel app and processes actual survey photo bytes after the SolarPro app has authorized the operator request and supplied survey file URLs.

The worker supports Stage 1 OpenCV primitives, Stage 2 YOLO/Supervision semantic object detection, and Stage 3 Tesseract OCR text extraction. All outputs are review-only, non-authoritative, and not CAD geometry. The worker never connects to the SolarPro database and never mutates canonical geometry, `project_physical_data`, permits, BOM, engineering workflow state, or homeowner-facing final outputs.

## Endpoints

```text
GET  /health
POST /v1/photo-vision/jobs
```

`/health` reports tool availability for OpenCV, YOLO, Supervision, Tesseract, pytesseract, Python, and future-stage tools. YOLO availability includes model/runtime diagnostics. Tesseract availability includes the discovered binary, Tesseract version, pytesseract version, and OCR language when available.

`/v1/photo-vision/jobs` accepts `solarpro_external_photo_vision_job_v1` jobs with survey/project identifiers, `requestedTools`, and authorized file URLs. The default requested tools are `opencv_primitives`, `yolo_detection`, `tesseract_ocr`, and `ocr_equipment_labels`.

If Tesseract/pytesseract is unavailable, disabled, or not requested, the worker returns explicit diagnostics and emits zero OCR text candidates. It does not fabricate fallback text.

## Docker usage

```bash
docker build -t solarpro-opencv-photo-vision external-workers/opencv-photo-vision

docker run --rm -p 8080:8080 \
  -e WORKER_PORT=8080 \
  -e YOLO_MODEL_PATH=yolov8n.pt \
  -e YOLO_DEVICE=cpu \
  -e TESSERACT_OCR_LANGUAGE=eng \
  solarpro-opencv-photo-vision
```

The Docker image installs the required system packages:

```text
tesseract-ocr
tesseract-ocr-eng
```

Configure the Next app with:

```bash
OPEN_SOURCE_PHOTO_VISION_WORKER_URL=http://localhost:8080
OPEN_SOURCE_PHOTO_VISION_WORKER_TIMEOUT_MS=30000
```

## Model and OCR setup

By default the worker uses `YOLO_MODEL_PATH=yolov8n.pt`. This is a generic pretrained Ultralytics model, not a solar-specific detector. Generic classes are mapped conservatively into probable review cues only. For production-quality semantic detection, provide custom-trained solar/electrical/roof weights with classes such as `utility_meter`, `main_service_panel`, `disconnect`, `roof_vent`, `chimney`, `skylight`, `obstruction`, `roof_edge_candidate`, `solar_array_candidate`, and `battery_wall_candidate`.

Tesseract OCR runs on preprocessed real survey photo pixels. It first attempts OCR on YOLO object bounding boxes when available, then runs a full-image OCR fallback. Empty, duplicate, and low-confidence text is suppressed. Emitted OCR candidates include cleaned text, confidence from Tesseract word confidence, normalized bbox/region coordinates, source crop metadata, Tesseract/pytesseract provenance, equipment regex hints, deterministic hash, run hash, review-required flags, non-authoritative flags, and limitations.

OCR equipment hints are regex-derived review aids only. Current hint categories include breaker ratings, voltage ratings, MSP/load-center labels, utility meter labels, disconnect labels, inverter labels, battery/ESS labels, manufacturer/model/serial-like strings, and warning labels.

## CPU/GPU notes

The default YOLO device is CPU:

```bash
YOLO_DEVICE=cpu
```

GPU execution may be configured by the deployment environment and Ultralytics device syntax, but CPU is the safe default. OCR runs through the system Tesseract binary and pytesseract. This worker is intended for external Docker deployment, not for Vercel/Next.js runtime execution.

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
TESSERACT_OCR_ENABLED=true
TESSERACT_OCR_LANGUAGE=eng
TESSERACT_OCR_MIN_CONFIDENCE=35
TESSERACT_OCR_MAX_CROPS=8
TESSERACT_OCR_MAX_CANDIDATES=18
TESSERACT_OCR_CONFIG=--oem 3 --psm 6
```

These defaults limit giant images, slow fetches, large batches, excessive detections, and excessive OCR crops/candidates. The Next app also applies a worker request timeout via `OPEN_SOURCE_PHOTO_VISION_WORKER_TIMEOUT_MS`.

## Candidate outputs

OpenCV candidates include edge summaries, dominant lines, roof-edge cues, contour rectangles, and obstruction-like regions.

YOLO/Supervision candidates are emitted as `object_detection` candidates with semantic review categories when supported by model inference and conservative mapping.

Tesseract candidates are emitted as `ocr_text` candidates with candidate category `electrical_context` and semantic category `equipment_label_text_candidate`. OCR payloads include `text`, `cleanedText`, `hints`, `bbox`, `region`, `sourceCrop`, `sourceModel=tesseract`, `modelVersion`, and `pytesseractVersion`.

Each candidate includes confidence, deterministic hash, run hash, tool/version provenance, model/runtime provenance when applicable, normalized `region`/`bbox` coordinates in `normalized_image_0_1000`, review-required flags, non-authoritative flags, and limitations.

## Limitations and future boundaries

This is NOT CAD reconstruction. This is NOT authoritative engineering geometry. This is NOT authoritative equipment identification. This is review assistance only.

YOLO detections and Tesseract OCR can be wrong, especially with generic weights, blurred labels, glare, occlusion, rotation, low resolution, partial crops, or non-standard equipment stickers. Operators must review all candidates before any separate future promotion workflow. The worker does not create roof planes, measurements, permit inputs, BOM inputs, CAD geometry, or engineering truth.

Future stages remain separate and are not completed by this worker change: multi-photo correlation, scale/reference calibration, geometry candidate synthesis, reviewed promotion workflow, Open3D, and FreeCAD/CAD automation.
