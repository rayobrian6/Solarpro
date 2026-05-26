"""
SolarPro External OpenCV Photo Vision Worker — v0.5.0

Production architecture with batch-optimized processing:
  - Vercel POST creates a job in Neon DB, returns jobId instantly.
  - Vercel POST also submits ALL photo files to this Render worker (one POST).
  - This worker processes all photos in batches internally, writing progress
    and results directly to Neon PostgreSQL after each batch.
  - Vercel GET is a pure DB read (instant, no Render communication).
  - Client polls Vercel GET every few seconds for progress.

v0.5.0 Performance Optimizations:
  - YOLO batch inference: model.predict(source=list_of_images) — one forward pass per batch
  - Parallel image fetching: ThreadPoolExecutor + httpx for concurrent I/O within a batch
  - Conditional OCR: Skip Tesseract when YOLO finds no detections (saves ~3-8s per image)
  - Skip thumbnails: Skip PIL thumbnail generation by default (saves ~0.3s per image)
  - YOLO imgsz=416: Smaller inference size for faster detection
  - BATCH_SIZE=10: Process 10 images at a time for better batching
"""

import asyncio
import base64
import gc
import hashlib
import io
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Literal

import cv2
import httpx
import numpy as np
import psycopg2
import psycopg2.extras
from app.ocr_detection import TesseractOcrService
from app.yolo_detection import YoloDetectionService
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

TOOL_NAME = "external-opencv-photo-vision-worker"
TOOL_VERSION = "0.5.0"
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(16 * 1024 * 1024)))
FETCH_TIMEOUT_SECONDS = float(os.environ.get("FETCH_TIMEOUT_SECONDS", "15"))
MAX_FILES_PER_JOB = int(os.environ.get("MAX_FILES_PER_JOB", "100"))
PROCESSING_TIMEOUT_SECONDS = float(os.environ.get("PROCESSING_TIMEOUT_SECONDS", "120"))
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "1"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "10"))

# v0.5.0 Performance Tuning
FETCH_CONCURRENCY = int(os.environ.get("FETCH_CONCURRENCY", "5"))
OCR_ONLY_ON_YOLO_HITS = os.environ.get("OCR_ONLY_ON_YOLO_HITS", "true").lower() not in {"0", "false", "no", "off"}
SKIP_THUMBNAILS = os.environ.get("SKIP_THUMBNAILS", "true").lower() not in {"0", "false", "no", "off"}

# Neon PostgreSQL
RAW_DATABASE_URL = os.environ.get("DATABASE_URL", "")
DB_CONNECTION_TIMEOUT = int(os.environ.get("DB_CONNECTION_TIMEOUT", "10"))

yolo_service = YoloDetectionService()
ocr_service = TesseractOcrService()

app = FastAPI(title="SolarPro External OpenCV Photo Vision Worker", version=TOOL_VERSION)

# ---------------------------------------------------------------------------
# Neon PostgreSQL connection
# ---------------------------------------------------------------------------
def _sanitize_db_url(url: str) -> str:
    """Sanitize Neon connection string: channel_binding=require → disable."""
    return url.replace("channel_binding=require", "channel_binding=disable")

def get_db_connection():
    """Get a new psycopg2 connection to Neon PostgreSQL."""
    url = _sanitize_db_url(RAW_DATABASE_URL)
    if not url:
        raise RuntimeError("DATABASE_URL environment variable not set")
    conn = psycopg2.connect(url, connect_timeout=DB_CONNECTION_TIMEOUT)
    conn.autocommit = True
    return conn

# ---------------------------------------------------------------------------
# DB helper functions
# ---------------------------------------------------------------------------
def db_update_job_status(job_id: str, status: str, error: str | None = None):
    """Update job status in Neon DB."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            if error:
                cur.execute(
                    """UPDATE photo_vision_jobs
                       SET status = %s, error = %s, updated_at = NOW()
                       WHERE job_id = %s""",
                    (status, error[:500], job_id),
                )
            else:
                cur.execute(
                    """UPDATE photo_vision_jobs
                       SET status = %s, updated_at = NOW()
                       WHERE job_id = %s""",
                    (status, job_id),
                )
    except Exception as exc:
        print(f"[DB ERROR] db_update_job_status({job_id}, {status}): {exc}")
    finally:
        if conn:
            conn.close()

def db_append_file_results(job_id: str, file_results: list[dict], processed_count: int, current_batch: int, completed_batches: int):
    """Append batch file results to job using JSONB || operator (no re-read)."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE photo_vision_jobs
                   SET file_results = COALESCE(file_results, '[]'::jsonb) || %s::jsonb,
                       current_batch = %s,
                       completed_batches = %s,
                       processed_files = %s,
                       updated_at = NOW()
                   WHERE job_id = %s""",
                (json.dumps(file_results), current_batch, completed_batches, processed_count, job_id),
            )
    except Exception as exc:
        print(f"[DB ERROR] db_append_file_results({job_id}): {exc}")
    finally:
        if conn:
            conn.close()

def db_append_batch_error(job_id: str, error_msg: str):
    """Append a batch error to the job's batch_errors JSONB."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE photo_vision_jobs
                   SET batch_errors = COALESCE(batch_errors, '[]'::jsonb) || %s::jsonb,
                       updated_at = NOW()
                   WHERE job_id = %s""",
                (json.dumps([error_msg]), job_id),
            )
    except Exception as exc:
        print(f"[DB ERROR] db_append_batch_error({job_id}): {exc}")
    finally:
        if conn:
            conn.close()

def db_update_last_availability(job_id: str, availability: dict):
    """Update the last_availability JSONB column."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE photo_vision_jobs
                   SET last_availability = %s::jsonb, updated_at = NOW()
                   WHERE job_id = %s""",
                (json.dumps(availability), job_id),
            )
    except Exception as exc:
        print(f"[DB ERROR] db_update_last_availability({job_id}): {exc}")
    finally:
        if conn:
            conn.close()

def db_finalize_job(job_id: str, final_result: dict, processed_files: int, batch_errors: list[str]):
    """Mark job as completed with final aggregated result."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE photo_vision_jobs
                   SET status = 'completed',
                       current_batch = total_batches,
                       completed_batches = total_batches,
                       processed_files = %s,
                       batch_errors = %s::jsonb,
                       final_result = %s::jsonb,
                       completed_at = NOW(),
                       updated_at = NOW()
                   WHERE job_id = %s""",
                (processed_files, json.dumps(batch_errors), json.dumps(final_result), job_id),
            )
    except Exception as exc:
        print(f"[DB ERROR] db_finalize_job({job_id}): {exc}")
    finally:
        if conn:
            conn.close()

def db_fail_job(job_id: str, error: str):
    """Mark job as failed."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE photo_vision_jobs
                   SET status = 'failed', error = %s, completed_at = NOW(), updated_at = NOW()
                   WHERE job_id = %s""",
                (error[:500], job_id),
            )
    except Exception as exc:
        print(f"[DB ERROR] db_fail_job({job_id}): {exc}")
    finally:
        if conn:
            conn.close()

def db_get_job_status(job_id: str) -> dict | None:
    """Get job status from DB for polling."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT job_id, status, current_batch, total_batches,
                          completed_batches, processed_files, total_photo_files,
                          error,
                          EXTRACT(EPOCH FROM created_at)::float AS created_at_epoch,
                          EXTRACT(EPOCH FROM completed_at)::float AS completed_at_epoch
                   FROM photo_vision_jobs
                   WHERE job_id = %s""",
                (job_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    except Exception as exc:
        print(f"[DB ERROR] db_get_job_status({job_id}): {exc}")
        return None
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Processing semaphore — serialize YOLO inference to prevent OOM
# ---------------------------------------------------------------------------
processing_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)

# In-memory tracking for active render-side processing (lightweight)
active_render_jobs: dict[str, dict] = {}

def _count_active_jobs() -> int:
    return sum(1 for j in active_render_jobs.values() if j["status"] in ("queued", "processing"))

def _cleanup_old_jobs() -> None:
    cutoff = time.time() - 3600
    to_remove = [jid for jid, j in active_render_jobs.items()
                 if j["status"] in ("completed", "failed") and j.get("completed_at", 0) < cutoff]
    for jid in to_remove:
        del active_render_jobs[jid]

def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

def no_authority() -> dict[str, bool]:
    return {
        "reviewOnly": True,
        "nonAuthoritative": True,
        "canonicalMutationAllowed": False,
        "cadMutationAllowed": False,
        "permitGenerationAllowed": False,
        "bomMutationAllowed": False,
        "engineeringWorkflowMutationAllowed": False,
    }

def base_limitations() -> list[str]:
    return [
        "REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY",
        "OpenCV, YOLO/Supervision, and Tesseract OCR candidates are pixel/model-derived review cues only; they do not create roof planes, measurements, CAD geometry, permit inputs, BOM inputs, or engineering truth.",
        "SolarPro must persist and review results; this external worker writes progress to the SolarPro database as review-only candidates.",
    ]


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------
class FileJob(BaseModel):
    fileId: str
    fileUrl: str
    filename: str | None = None
    contentType: str | None = None

class VisionJob(BaseModel):
    schemaVersion: Literal["solarpro_external_photo_vision_job_v1"]
    surveyId: str
    projectId: str | None = None
    createdAt: str | None = None
    jobId: str | None = None  # Vercel-side job ID for DB writes
    requestedTools: list[str] = Field(default_factory=lambda: ["opencv_primitives", "yolo_detection", "tesseract_ocr", "ocr_equipment_labels"])
    files: list[FileJob] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict[str, Any]:
    yolo_availability = yolo_service.availability()
    ocr_availability = ocr_service.availability()
    active = _count_active_jobs()
    db_ok = False
    try:
        conn = get_db_connection()
        conn.close()
        db_ok = True
    except Exception:
        pass
    return {
        "status": "ok",
        "schemaVersion": "solarpro_external_photo_vision_health_v1",
        "toolName": TOOL_NAME,
        "toolVersion": TOOL_VERSION,
        "tools": {
            "opencv": {"available": True, "version": cv2.__version__},
            "python": {"available": True},
            "yolo": yolo_availability.yolo,
            "supervision": yolo_availability.supervision,
            "yoloSupervision": {"available": yolo_availability.yolo.get("available") and yolo_availability.supervision.get("available"), "reason": yolo_availability.yolo.get("reason") or yolo_availability.supervision.get("reason"), "modelLoaded": yolo_availability.yolo.get("modelLoaded")},
            "open3d": {"available": False, "reason": "future_stage_not_implemented"},
            "freecad": {"available": False, "reason": "future_stage_not_implemented"},
            "tesseract": ocr_availability.tesseract,
            "pytesseract": ocr_availability.pytesseract,
        },
        "capacity": {
            "maxConcurrentJobs": MAX_CONCURRENT_JOBS,
            "activeJobs": active,
            "available": active < MAX_CONCURRENT_JOBS * 3,
        },
        "database": {"connected": db_ok},
        "performance": {
            "batchSize": BATCH_SIZE,
            "fetchConcurrency": FETCH_CONCURRENCY,
            "ocrOnlyOnYoloHits": OCR_ONLY_ON_YOLO_HITS,
            "skipThumbnails": SKIP_THUMBNAILS,
        },
        "authority": no_authority(),
    }


# ---------------------------------------------------------------------------
# POST /v1/photo-vision/jobs — Submit ALL photos, worker processes them all
# Returns 202 Accepted immediately with renderJobId.
# Worker processes all batches internally, writing progress to Neon DB.
# ---------------------------------------------------------------------------
@app.post("/v1/photo-vision/jobs", status_code=202)
async def submit_job(job: VisionJob) -> dict[str, Any]:
    _cleanup_old_jobs()

    if not RAW_DATABASE_URL:
        raise HTTPException(status_code=500, detail="DATABASE_URL not configured on worker")

    render_job_id = f"rj_{uuid.uuid4().hex[:16]}"
    job_id = job.jobId  # Vercel-side job ID

    queued = _count_active_jobs()
    active_render_jobs[render_job_id] = {
        "status": "queued",
        "job_id": job_id,
        "survey_id": job.surveyId,
        "total_files": len(job.files),
        "created_at": time.time(),
        "started_at": None,
        "completed_at": None,
    }

    # Start background processing — the entire loop runs here on Render
    asyncio.create_task(_process_all_batches_background(render_job_id, job))

    return {
        "schemaVersion": "solarpro_external_photo_vision_job_accepted_v1",
        "renderJobId": render_job_id,
        "jobId": job_id,
        "status": "queued",
        "totalFiles": len(job.files),
        "batchSize": BATCH_SIZE,
        "message": f"Job queued. Worker will process all {len(job.files)} files in batches of {BATCH_SIZE}. Progress is written to Neon DB.",
    }


# ---------------------------------------------------------------------------
# GET /v1/photo-vision/jobs/{renderJobId} — Poll render-side status
# Also reads from Neon DB if a jobId was provided.
# ---------------------------------------------------------------------------
@app.get("/v1/photo-vision/jobs/{render_job_id}")
async def get_job_status(render_job_id: str) -> dict[str, Any]:
    rj = active_render_jobs.get(render_job_id)
    if not rj:
        raise HTTPException(status_code=404, detail=f"Render job {render_job_id} not found")

    response: dict[str, Any] = {
        "renderJobId": render_job_id,
        "jobId": rj.get("job_id"),
        "status": rj["status"],
        "surveyId": rj.get("survey_id"),
    }

    # If we have a Vercel job_id, also read DB for progress details
    job_id = rj.get("job_id")
    if job_id and rj["status"] in ("processing", "completed", "failed"):
        db_status = db_get_job_status(job_id)
        if db_status:
            response["progress"] = {
                "currentBatch": db_status.get("current_batch", 0),
                "totalBatches": db_status.get("total_batches", 0),
                "completedBatches": db_status.get("completed_batches", 0),
                "processedFiles": db_status.get("processed_files", 0),
                "totalPhotoFiles": db_status.get("total_photo_files", 0),
            }

    if rj["status"] == "queued":
        response["message"] = "Job is queued waiting for processing slot."
    elif rj["status"] == "processing":
        elapsed = time.time() - (rj.get("started_at") or rj.get("created_at"))
        response["elapsedSeconds"] = round(elapsed, 1)
        response["message"] = "Job is currently being processed."
    elif rj["status"] == "completed":
        response["message"] = "Job completed. Results are in Neon DB."
    elif rj["status"] == "failed":
        response["error"] = rj.get("error")
        response["message"] = "Job failed."

    return response


# ---------------------------------------------------------------------------
# DELETE /v1/photo-vision/jobs/{renderJobId} — Cancel a queued job
# ---------------------------------------------------------------------------
@app.delete("/v1/photo-vision/jobs/{render_job_id}")
async def cancel_job(render_job_id: str) -> dict[str, Any]:
    rj = active_render_jobs.get(render_job_id)
    if not rj:
        raise HTTPException(status_code=404, detail=f"Render job {render_job_id} not found")

    if rj["status"] == "queued":
        rj["status"] = "failed"
        rj["error"] = "Cancelled by user"
        rj["completed_at"] = time.time()
        job_id = rj.get("job_id")
        if job_id:
            db_fail_job(job_id, "Cancelled by user")
        return {"renderJobId": render_job_id, "status": "cancelled", "message": "Job cancelled."}

    if rj["status"] == "processing":
        return {"renderJobId": render_job_id, "status": rj["status"], "message": "Job is already processing and cannot be cancelled."}

    return {"renderJobId": render_job_id, "status": rj["status"], "message": f"Job is already {rj['status']}."}


# ---------------------------------------------------------------------------
# v0.5.0: Parallel batch fetching with ThreadPoolExecutor + httpx
# ---------------------------------------------------------------------------
def _fetch_single_image(file_job: FileJob) -> tuple[FileJob, bytes | None, str | None]:
    """Fetch a single image. Returns (file_job, content, error)."""
    try:
        with httpx.Client(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = client.get(file_job.fileUrl)
            response.raise_for_status()
            content = response.content
        if len(content) > MAX_IMAGE_BYTES:
            return (file_job, None, f"image exceeds max byte size {MAX_IMAGE_BYTES}")
        return (file_job, content, None)
    except Exception as exc:
        return (file_job, None, str(exc)[:300])


def _fetch_batch_parallel(batch_files: list[FileJob]) -> list[tuple[FileJob, bytes | None, str | None]]:
    """Fetch all images in a batch concurrently using ThreadPoolExecutor."""
    results: list[tuple[FileJob, bytes | None, str | None]] = []
    with ThreadPoolExecutor(max_workers=min(FETCH_CONCURRENCY, len(batch_files))) as pool:
        futures = [pool.submit(_fetch_single_image, fj) for fj in batch_files]
        for future in futures:
            try:
                results.append(future.result(timeout=FETCH_TIMEOUT_SECONDS + 5))
            except Exception as exc:
                # Shouldn't happen since _fetch_single_image catches all exceptions,
                # but handle it anyway
                results.append((batch_files[0], None, str(exc)[:300]))
    return results


# ---------------------------------------------------------------------------
# v0.5.0: Batch YOLO detection — one model.predict call for all images
# ---------------------------------------------------------------------------
def _yolo_batch_detect(
    images: list[np.ndarray],
    file_metas: list[dict],
    *,
    survey_id: str,
    created_at: str,
) -> list[dict[str, Any]]:
    """
    Run YOLO batch inference on a list of decoded images.
    Returns a list of YOLO result dicts (one per image), same length as images.
    Each result has: available, diagnostic, candidates, elapsedMs, model, modelVersion, limitations.
    """
    if not yolo_service.is_available():
        unavailable_result = {
            "available": False,
            "diagnostic": "yolo_unavailable",
            "candidates": [],
            "elapsedMs": 0,
            "model": yolo_service.model_path,
            "modelVersion": yolo_service.ultralytics_version,
            "limitations": ["YOLO/Supervision unavailable; no semantic object detections emitted.",
                            "REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY",
                            "YOLO detections are semantic review cues from model inference and cannot create roof planes, CAD geometry, permit inputs, BOM inputs, or engineering truth."],
        }
        return [unavailable_result for _ in images]

    started = time.time()

    # Run batch YOLO inference — THE key performance win
    results = yolo_service.model.predict(
        source=images,
        conf=yolo_service.confidence_threshold,
        imgsz=yolo_service.image_size,
        device=yolo_service.device,
        verbose=False,
        max_det=yolo_service.max_detections,
    )

    batch_elapsed_ms = int((time.time() - started) * 1000)

    # Process each image's results
    per_image_results: list[dict[str, Any]] = []

    for idx, (result, meta) in enumerate(zip(results, file_metas)):
        file_id = meta["file_id"]
        file_url = meta["file_url"]
        filename = meta["filename"]
        byte_hash = meta["byte_hash"]
        height = meta["height"]
        width = meta["width"]

        candidates: list[dict[str, Any]] = []
        boxes = getattr(result, "boxes", None)

        if boxes is not None and len(boxes) > 0:
            xyxy = boxes.xyxy.cpu().numpy() if hasattr(boxes.xyxy, "cpu") else np.asarray(boxes.xyxy)
            confs = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else np.asarray(boxes.conf)
            classes = boxes.cls.cpu().numpy().astype(int) if hasattr(boxes.cls, "cpu") else np.asarray(boxes.cls).astype(int)

            for index, (box, conf, class_id) in enumerate(zip(xyxy, confs, classes)):
                class_name = yolo_service.model_names.get(int(class_id), str(class_id))
                mapped = yolo_service._map_class(class_name)
                if mapped is None:
                    continue
                candidate_type, category, mapping_limitations = mapped
                x1, y1, x2, y2 = [float(v) for v in box]

                from app.yolo_detection import normalize_box
                region = normalize_box(x1, y1, x2, y2, width, height)

                model_kind_limitations = [] if yolo_service._has_custom_solar_weights() else [
                    "Generic pretrained YOLO weights are not solar-specific; class mapping is conservative and may be wrong.",
                    f"Raw model class was '{class_name}', mapped to '{candidate_type}' only as a probable review cue.",
                ]
                confidence = int(max(1, min(99, round(float(conf) * 100))))
                payload = {
                    "source": "yolo_detection",
                    "sourceImageSha256": byte_hash,
                    "sourceModel": yolo_service.model_path,
                    "modelVersion": yolo_service.ultralytics_version,
                    "supervisionVersion": yolo_service.supervision_version,
                    "rawClassName": class_name,
                    "rawClassId": int(class_id),
                    "bbox": region,
                    "region": region,
                    "tool": "yolo",
                    "reviewRequired": True,
                    "nonAuthoritative": True,
                }
                candidates.append({
                    "surveyId": survey_id,
                    "fileId": file_id,
                    "fileUrl": file_url,
                    "filename": filename,
                    "toolName": "external-yolo-supervision-worker",
                    "toolVersion": yolo_service.ultralytics_version or "unknown",
                    "runHash": "pending",
                    "reviewStatus": "review_required",
                    "nonAuthoritative": True,
                    "createdAt": created_at,
                    "candidateId": "pending",
                    "deterministicHash": "pending",
                    "candidateType": "object_detection",
                    "candidateCategory": category,
                    "category": candidate_type,
                    "confidence": confidence,
                    "summary": yolo_service._summary(candidate_type, class_name, confidence),
                    "payload": payload,
                    "bbox": region,
                    "region": region,
                    "sourceModel": yolo_service.model_path,
                    "modelVersion": yolo_service.ultralytics_version,
                    "reviewRequired": True,
                    "limitations": [
                        *mapping_limitations,
                        *model_kind_limitations,
                        "REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY",
                        "YOLO detections are semantic review cues from model inference and cannot create roof planes, CAD geometry, permit inputs, BOM inputs, or engineering truth.",
                        "SolarPro must persist and review detections; this external worker does not write to the SolarPro database.",
                    ],
                })

        per_image_cands = candidates[:yolo_service.max_detections]
        per_image_results.append({
            "available": True,
            "diagnostic": None,
            "candidates": per_image_cands,
            "elapsedMs": batch_elapsed_ms,  # shared batch time
            "model": yolo_service.model_path,
            "modelVersion": yolo_service.ultralytics_version,
            "limitations": [
                "REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY",
                "YOLO detections are semantic review cues from model inference and cannot create roof planes, CAD geometry, permit inputs, BOM inputs, or engineering truth.",
                "SolarPro must persist and review detections; this external worker does not write to the SolarPro database.",
            ],
            "has_detections": len(per_image_cands) > 0,
        })

    return per_image_results


# ---------------------------------------------------------------------------
# Background processor — processes ALL batches, writes to Neon DB
# ---------------------------------------------------------------------------
async def _process_all_batches_background(render_job_id: str, job: VisionJob) -> None:
    """Process all photo files in batches, writing progress to Neon DB."""
    rj = active_render_jobs.get(render_job_id)
    if not rj:
        return

    job_id = job.jobId  # Vercel-side job ID for DB writes

    async with processing_semaphore:
        # Check if cancelled while waiting
        if rj["status"] == "failed":
            return

        rj["status"] = "processing"
        rj["started_at"] = time.time()

        # Mark job as running in DB
        if job_id:
            db_update_job_status(job_id, "running")

        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None, _run_all_batches_sync, render_job_id, job
            )
            rj["status"] = "completed"
            rj["completed_at"] = time.time()
        except Exception as exc:
            rj["status"] = "failed"
            rj["error"] = str(exc)[:500]
            rj["completed_at"] = time.time()
            if job_id:
                db_fail_job(job_id, str(exc)[:500])
            gc.collect()


def _run_all_batches_sync(render_job_id: str, job: VisionJob) -> dict[str, Any]:
    """
    v0.5.0 Batch-optimized synchronous processing of ALL files.

    Per batch, the 5 steps are:
    1. Parallel fetch all images (ThreadPoolExecutor)
    2. Decode all images + OpenCV edge analysis (sequential but images kept for YOLO)
    3. YOLO batch inference on all decoded images (one model.predict call)
    4. Conditional OCR — only on images with YOLO detections
    5. Build final per-file results

    Writes progress to Neon DB after each batch.
    """
    rj = active_render_jobs.get(render_job_id)
    job_id = job.jobId
    survey_id = job.surveyId
    project_id = job.projectId
    created_at = job.createdAt or datetime.now(timezone.utc).isoformat()

    all_files = job.files[:MAX_FILES_PER_JOB]
    total_files = len(all_files)
    total_batches = (total_files + BATCH_SIZE - 1) // BATCH_SIZE

    # Update DB with correct total_batches based on Render's BATCH_SIZE
    if job_id:
        try:
            conn = get_db_connection()
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE photo_vision_jobs
                       SET total_batches = %s, updated_at = NOW()
                       WHERE job_id = %s""",
                    (total_batches, job_id),
                )
            conn.close()
        except Exception as exc:
            print(f"[WORKER] Job {job_id}: failed to update total_batches: {exc}")

    all_file_results: list[dict[str, Any]] = []
    all_candidates: list[dict[str, Any]] = []
    batch_errors: list[str] = []
    last_availability: dict | None = None
    total_processed = 0

    print(f"[WORKER v0.5.0] Job {job_id}: starting processing of {total_files} files in {total_batches} batches (batch_size={BATCH_SIZE}, fetch_concurrency={FETCH_CONCURRENCY}, ocr_only_on_yolo={OCR_ONLY_ON_YOLO_HITS}, skip_thumbnails={SKIP_THUMBNAILS})")

    for batch_idx in range(total_batches):
        # Check if job was cancelled
        if rj and rj.get("status") == "failed":
            print(f"[WORKER] Job {job_id}: cancelled, stopping at batch {batch_idx}")
            break

        start_idx = batch_idx * BATCH_SIZE
        end_idx = min(start_idx + BATCH_SIZE, total_files)
        batch_files = all_files[start_idx:end_idx]

        print(f"[WORKER] Job {job_id}: batch {batch_idx + 1}/{total_batches} ({len(batch_files)} files)")

        batch_t0 = time.time()

        try:
            # ── Step 1: Parallel fetch all images ──
            fetch_t0 = time.time()
            fetched = _fetch_batch_parallel(batch_files)
            fetch_elapsed = time.time() - fetch_t0
            print(f"[WORKER] Job {job_id}: batch {batch_idx + 1} fetch done in {fetch_elapsed:.1f}s")

            # ── Step 2: Decode all images + OpenCV edge analysis ──
            # Use parallel arrays indexed by position in batch.
            # For each position: exactly one entry in each list.
            # - file_jobs[i]: the FileJob
            # - images[i]: decoded np.ndarray or None
            # - metas[i]: decode metadata dict or None
            # - early_fail_results[i]: pre-built failed result or None
            decode_t0 = time.time()

            batch_file_jobs: list[FileJob] = []
            batch_images: list[np.ndarray | None] = []
            batch_metas: list[dict | None] = []
            batch_early_fails: list[dict | None] = []

            for file_job, content, fetch_error in fetched:
                batch_file_jobs.append(file_job)

                if fetch_error or content is None:
                    batch_images.append(None)
                    batch_metas.append(None)
                    batch_early_fails.append({
                        "surveyId": survey_id,
                        "fileId": file_job.fileId,
                        "fileUrl": file_job.fileUrl,
                        "filename": file_job.filename,
                        "analyzed": False,
                        "error": fetch_error or "Failed to fetch image",
                        "metadata": {"widthPx": None, "heightPx": None, "format": None, "byteSize": 0, "sha256": None, "dominantBrightness": None, "sharpnessScore": None, "qualityScore": None},
                        "thumbnailDataUrl": None,
                        "edgeSummary": None,
                        "candidates": [],
                        "limitations": ["Image bytes could not be fetched or decoded by the external OpenCV worker; no candidates emitted for this file.", *base_limitations()],
                        "runHash": stable_hash({"surveyId": survey_id, "fileId": file_job.fileId, "error": fetch_error or "fetch_failed"}),
                    })
                    continue

                try:
                    byte_hash = hashlib.sha256(content).hexdigest()
                    content_byte_size = len(content)
                    np_bytes = np.frombuffer(content, dtype=np.uint8)
                    image = cv2.imdecode(np_bytes, cv2.IMREAD_COLOR)
                    if image is None:
                        raise ValueError("OpenCV could not decode image bytes")

                    height, width = image.shape[:2]
                    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                    blur = cv2.GaussianBlur(gray, (5, 5), 0)
                    edges = cv2.Canny(blur, 50, 150)
                    edge_ratio = float(np.count_nonzero(edges)) / float(max(1, edges.size))
                    lines = extract_lines(edges, width, height)
                    regions = extract_regions(edges, width, height)
                    dominant_brightness = round(float(np.mean(gray)), 3)
                    sharpness_score = round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 3)

                    # Generate thumbnail only if not skipped
                    thumbnail = None if SKIP_THUMBNAILS else make_thumbnail(content)

                    # Build OpenCV candidates
                    opencv_candidates = build_candidates(job, file_job, byte_hash, created_at, "pending", edge_ratio, lines, regions) if tool_requested(job, "opencv_primitives") else []

                    batch_images.append(image)
                    batch_metas.append({
                        "byte_hash": byte_hash,
                        "content_byte_size": content_byte_size,
                        "width": width,
                        "height": height,
                        "edge_ratio": edge_ratio,
                        "lines": lines,
                        "regions": regions,
                        "dominant_brightness": dominant_brightness,
                        "sharpness_score": sharpness_score,
                        "thumbnail": thumbnail,
                        "opencv_candidates": opencv_candidates,
                    })
                    batch_early_fails.append(None)

                    # Free content bytes early — we have the decoded image
                    del content, np_bytes, gray, blur, edges
                except Exception as exc:
                    batch_images.append(None)
                    batch_metas.append(None)
                    batch_early_fails.append({
                        "surveyId": survey_id,
                        "fileId": file_job.fileId,
                        "fileUrl": file_job.fileUrl,
                        "filename": file_job.filename,
                        "analyzed": False,
                        "error": str(exc)[:300],
                        "metadata": {"widthPx": None, "heightPx": None, "format": None, "byteSize": 0, "sha256": None, "dominantBrightness": None, "sharpnessScore": None, "qualityScore": None},
                        "thumbnailDataUrl": None,
                        "edgeSummary": None,
                        "candidates": [],
                        "limitations": ["Image bytes could not be fetched or decoded by the external OpenCV worker; no candidates emitted for this file.", *base_limitations()],
                        "runHash": stable_hash({"surveyId": survey_id, "fileId": file_job.fileId, "error": str(exc)}),
                    })

            n_batch = len(batch_file_jobs)
            decoded_count = sum(1 for img in batch_images if img is not None)
            decode_elapsed = time.time() - decode_t0
            print(f"[WORKER] Job {job_id}: batch {batch_idx + 1} decode done in {decode_elapsed:.1f}s ({decoded_count}/{n_batch} images decoded)")

            # ── Step 3: YOLO batch inference on all decoded images ──
            yolo_t0 = time.time()

            # Collect only the successfully decoded images for YOLO
            yolo_images: list[np.ndarray] = []
            yolo_metas_for_batch: list[dict] = []  # file metadata for YOLO
            yolo_index_map: list[int | None] = [None] * n_batch  # maps batch pos → yolo_results pos

            if tool_requested(job, "yolo_detection"):
                for i in range(n_batch):
                    if batch_images[i] is not None:
                        yolo_index_map[i] = len(yolo_images)
                        fj = batch_file_jobs[i]
                        yolo_images.append(batch_images[i])
                        yolo_metas_for_batch.append({
                            "file_id": fj.fileId,
                            "file_url": fj.fileUrl,
                            "filename": fj.filename,
                            "byte_hash": batch_metas[i]["byte_hash"],
                            "height": batch_metas[i]["height"],
                            "width": batch_metas[i]["width"],
                        })

            # Run batch YOLO inference
            yolo_batch_results: list[dict[str, Any]] = []
            if yolo_images:
                yolo_batch_results = _yolo_batch_detect(
                    yolo_images,
                    yolo_metas_for_batch,
                    survey_id=survey_id,
                    created_at=created_at,
                )
            elif tool_requested(job, "yolo_detection"):
                # No decoded images but YOLO requested — nothing to do
                pass

            # Map YOLO results back to batch positions
            yolo_results_per_file: list[dict[str, Any]] = []
            for i in range(n_batch):
                yi = yolo_index_map[i]
                if yi is not None and yi < len(yolo_batch_results):
                    yolo_results_per_file.append(yolo_batch_results[yi])
                elif batch_images[i] is not None:
                    # Decoded but no YOLO result (shouldn't happen)
                    yolo_results_per_file.append({
                        "available": False, "diagnostic": "no_yolo_result",
                        "candidates": [], "elapsedMs": 0, "limitations": [], "has_detections": False,
                    })
                else:
                    # Failed decode, no YOLO result needed
                    yolo_results_per_file.append({
                        "available": False, "diagnostic": "image_decode_failed",
                        "candidates": [], "elapsedMs": 0, "limitations": [], "has_detections": False,
                    })

            yolo_elapsed = time.time() - yolo_t0
            print(f"[WORKER] Job {job_id}: batch {batch_idx + 1} YOLO done in {yolo_elapsed:.1f}s ({len(yolo_images)} images)")

            # ── Step 4: Conditional OCR — only on images with YOLO detections ──
            ocr_t0 = time.time()

            ocr_requested = tool_requested(job, "tesseract_ocr") or tool_requested(job, "ocr_equipment_labels")
            ocr_results_per_file: list[dict[str, Any]] = []

            for i in range(n_batch):
                if batch_images[i] is None or not ocr_requested:
                    # Failed decode or OCR not requested
                    ocr_results_per_file.append({
                        "available": False,
                        "diagnostic": "ocr_not_run" if batch_images[i] is None else "tesseract_ocr_not_requested",
                        "candidates": [], "elapsedMs": 0, "limitations": [],
                    })
                    continue

                has_yolo_detections = yolo_results_per_file[i].get("has_detections", len(yolo_results_per_file[i].get("candidates", [])) > 0)
                if OCR_ONLY_ON_YOLO_HITS and not has_yolo_detections:
                    ocr_results_per_file.append({
                        "available": False,
                        "diagnostic": "ocr_skipped_no_yolo_hits",
                        "candidates": [], "elapsedMs": 0, "limitations": [],
                    })
                    continue

                # Run OCR on this image
                fj = batch_file_jobs[i]
                meta = batch_metas[i]
                try:
                    ocr_res = ocr_service.detect(
                        batch_images[i],
                        survey_id=survey_id,
                        file_id=fj.fileId,
                        file_url=fj.fileUrl,
                        filename=fj.filename,
                        byte_hash=meta["byte_hash"],
                        created_at=created_at,
                        yolo_candidates=yolo_results_per_file[i].get("candidates", []),
                        include_equipment_hints=tool_requested(job, "ocr_equipment_labels"),
                    )
                    ocr_results_per_file.append(ocr_res)
                except Exception as exc:
                    ocr_results_per_file.append({
                        "available": False,
                        "diagnostic": f"ocr_error: {str(exc)[:100]}",
                        "candidates": [], "elapsedMs": 0, "limitations": [],
                    })

            ocr_elapsed = time.time() - ocr_t0
            ocr_ran = sum(1 for r in ocr_results_per_file if r.get("available") or "ocr_error" in (r.get("diagnostic") or ""))
            ocr_skipped = n_batch - ocr_ran
            print(f"[WORKER] Job {job_id}: batch {batch_idx + 1} OCR done in {ocr_elapsed:.1f}s (ran on {ocr_ran} images, skipped {ocr_skipped})")

            # Free all decoded images now — OCR is done
            for img in batch_images:
                if img is not None:
                    del img
            del batch_images, yolo_images
            gc.collect()

            # ── Step 5: Build final per-file results ──
            batch_file_results: list[dict[str, Any]] = []

            for i in range(n_batch):
                fj = batch_file_jobs[i]

                # If fetch or decode failed, use the pre-built failed result
                if batch_early_fails[i] is not None:
                    batch_file_results.append(batch_early_fails[i])
                    continue

                meta = batch_metas[i]
                yolo_res = yolo_results_per_file[i]
                ocr_res = ocr_results_per_file[i]

                # Merge all candidates
                candidates = [*meta["opencv_candidates"], *yolo_res.get("candidates", []), *ocr_res.get("candidates", [])]
                run_hash = stable_hash({
                    "fileId": fj.fileId,
                    "sha256": meta["byte_hash"],
                    "lines": meta["lines"],
                    "regions": meta["regions"],
                    "yoloCandidates": [c.get("payload", {}) for c in yolo_res.get("candidates", [])],
                    "ocrCandidates": [c.get("payload", {}) for c in ocr_res.get("candidates", [])],
                })

                file_result = {
                    "surveyId": survey_id,
                    "fileId": fj.fileId,
                    "fileUrl": fj.fileUrl,
                    "filename": fj.filename,
                    "analyzed": True,
                    "error": None,
                    "metadata": {
                        "widthPx": meta["width"],
                        "heightPx": meta["height"],
                        "format": "image/jpeg",
                        "byteSize": meta["content_byte_size"],
                        "sha256": meta["byte_hash"],
                        "dominantBrightness": meta["dominant_brightness"],
                        "sharpnessScore": meta["sharpness_score"],
                        "qualityScore": int(max(5, min(95, 45 + meta["edge_ratio"] * 250))),
                        "elapsedMs": int((time.time() - batch_t0) * 1000),
                        "yoloElapsedMs": yolo_res.get("elapsedMs", 0),
                        "ocrElapsedMs": ocr_res.get("elapsedMs", 0),
                    },
                    "thumbnailDataUrl": meta["thumbnail"],
                    "edgeSummary": {
                        "edgePixelRatio": round(meta["edge_ratio"], 6),
                        "horizontalStrength": round(sum(1 for line in meta["lines"] if line["orientation"] == "horizontal") / max(1, len(meta["lines"])), 4),
                        "verticalStrength": round(sum(1 for line in meta["lines"] if line["orientation"] == "vertical") / max(1, len(meta["lines"])), 4),
                        "diagonalStrength": round(sum(1 for line in meta["lines"] if line["orientation"] == "diagonal") / max(1, len(meta["lines"])), 4),
                        "denseRegionCount": len(meta["regions"]),
                    },
                    "candidates": candidates,
                    "limitations": [
                        *base_limitations(),
                        *([f"YOLO diagnostic: {yolo_res.get('diagnostic')}"] if yolo_res.get("diagnostic") else []),
                        *([f"Tesseract OCR diagnostic: {ocr_res.get('diagnostic')}"] if ocr_res.get("diagnostic") else []),
                    ],
                    "toolDiagnostics": {
                        "yolo": {"available": yolo_res.get("available"), "diagnostic": yolo_res.get("diagnostic"), "model": yolo_res.get("model"), "modelVersion": yolo_res.get("modelVersion"), "elapsedMs": yolo_res.get("elapsedMs", 0)},
                        "tesseract": {"available": ocr_res.get("available"), "diagnostic": ocr_res.get("diagnostic"), "model": ocr_res.get("model"), "modelVersion": ocr_res.get("modelVersion"), "pytesseractVersion": ocr_res.get("pytesseractVersion"), "elapsedMs": ocr_res.get("elapsedMs", 0)},
                    },
                    "runHash": run_hash,
                }
                batch_file_results.append(file_result)

            # Build per-batch run hash
            batch_run_hash = stable_hash({
                "surveyId": survey_id,
                "projectId": project_id,
                "toolName": TOOL_NAME,
                "toolVersion": TOOL_VERSION,
                "batchIndex": batch_idx,
                "files": [{"fileId": f.get("fileId"), "sha256": f.get("metadata", {}).get("sha256")} for f in batch_file_results],
            })

            for file_result in batch_file_results:
                file_result["runHash"] = batch_run_hash
                for candidate in file_result.get("candidates", []):
                    candidate["runHash"] = batch_run_hash
                    candidate["deterministicHash"] = stable_hash({**candidate, "createdAt": "stable-created-at", "runHash": batch_run_hash})
                    candidate["candidateId"] = f"ospv_{candidate['deterministicHash'][:24]}"

            batch_processed = sum(1 for f in batch_file_results if f.get("analyzed"))
            total_processed += batch_processed
            all_file_results.extend(batch_file_results)
            all_candidates.extend(c for f in batch_file_results for c in f.get("candidates", []))

            # Extract availability from the last file result
            for fr in reversed(batch_file_results):
                if fr.get("toolDiagnostics"):
                    last_availability = _build_availability_from_diagnostics(fr["toolDiagnostics"])
                    break

            # Write progress to Neon DB after each batch
            if job_id:
                db_append_file_results(
                    job_id,
                    batch_file_results,
                    processed_count=total_processed,
                    current_batch=batch_idx + 1,
                    completed_batches=batch_idx + 1,
                )
                if last_availability:
                    db_update_last_availability(job_id, last_availability)

            batch_elapsed = time.time() - batch_t0
            print(f"[WORKER] Job {job_id}: batch {batch_idx + 1}/{total_batches} done in {batch_elapsed:.1f}s (fetch={fetch_elapsed:.1f}s decode={decode_elapsed:.1f}s yolo={yolo_elapsed:.1f}s ocr={ocr_elapsed:.1f}s). batch_processed={batch_processed} total_processed={total_processed}")

        except Exception as exc:
            err_msg = f"Batch {batch_idx + 1} ({len(batch_files)} files): {str(exc)[:200]}"
            batch_errors.append(err_msg)
            print(f"[WORKER] Job {job_id}: batch {batch_idx + 1} FAILED: {err_msg}")

            # Create failed file results for this batch
            failed_results = []
            for file_job in batch_files:
                failed_results.append({
                    "surveyId": survey_id,
                    "fileId": file_job.fileId,
                    "fileUrl": file_job.fileUrl,
                    "filename": file_job.filename,
                    "analyzed": False,
                    "error": str(exc)[:300],
                    "metadata": {"widthPx": None, "heightPx": None, "format": None, "byteSize": 0, "sha256": None, "dominantBrightness": None, "sharpnessScore": None, "qualityScore": None},
                    "thumbnailDataUrl": None,
                    "edgeSummary": None,
                    "candidates": [],
                    "limitations": ["Batch processing failed; no candidates emitted.", *base_limitations()],
                    "runHash": stable_hash({"surveyId": survey_id, "fileId": file_job.fileId, "error": str(exc)}),
                })
            all_file_results.extend(failed_results)

            # Write failed results to DB
            if job_id:
                db_append_file_results(
                    job_id,
                    failed_results,
                    processed_count=total_processed,
                    current_batch=batch_idx + 1,
                    completed_batches=batch_idx + 1,
                )
                db_append_batch_error(job_id, err_msg)

        # Force GC between batches to keep memory stable
        gc.collect()

    # Build final aggregated result
    aggregate_run_hash = stable_hash({
        "surveyId": survey_id,
        "projectId": project_id,
        "toolName": TOOL_NAME,
        "toolVersion": TOOL_VERSION,
        "batched": True,
        "fileHashes": [{"fileId": f["fileId"], "hash": f.get("metadata", {}).get("sha256"), "candidateHashes": [c.get("deterministicHash") for c in f.get("candidates", [])]} for f in all_file_results],
    })

    # Assign aggregate run hash to all files and candidates
    for file_result in all_file_results:
        file_result["runHash"] = aggregate_run_hash
        for candidate in file_result.get("candidates", []):
            candidate["runHash"] = aggregate_run_hash

    final_result = {
        "schemaVersion": "solarpro_external_photo_vision_result_v1",
        "surveyId": survey_id,
        "projectId": project_id,
        "toolName": TOOL_NAME,
        "toolVersion": TOOL_VERSION,
        "createdAt": created_at,
        "processedCount": sum(1 for f in all_file_results if f.get("analyzed")),
        "failedCount": sum(1 for f in all_file_results if not f.get("analyzed")),
        "candidateCount": len(all_candidates),
        "runHash": aggregate_run_hash,
        "files": all_file_results,
        "candidates": all_candidates,
        "availability": last_availability or _default_availability(),
        "authority": no_authority(),
        "limitations": [
            *base_limitations(),
            *([f"BATCH_PARTIAL_FAILURE: {len(batch_errors)} batch(es) failed. Errors: {'; '.join(batch_errors)}"] if batch_errors else []),
        ],
    }

    # Finalize job in DB
    if job_id:
        db_finalize_job(job_id, final_result, total_processed, batch_errors)

    print(f"[WORKER v0.5.0] Job {job_id}: ALL DONE. processed={final_result['processedCount']} failed={final_result['failedCount']} candidates={final_result['candidateCount']}")

    return final_result


def _build_availability_from_diagnostics(diagnostics: dict) -> dict:
    """Build availability dict from tool diagnostics."""
    yolo_diag = diagnostics.get("yolo", {})
    ocr_diag = diagnostics.get("tesseract", {})
    return {
        "opencv": f"available:{cv2.__version__}",
        "yoloSupervision": f"available:{yolo_diag.get('model', 'yolov8n')}:{yolo_diag.get('modelVersion', 'unknown')}" if yolo_diag.get("available") else f"unavailable:{yolo_diag.get('diagnostic', 'unknown')}",
        "yolo": f"available:{yolo_diag.get('model', 'yolov8n')}:{yolo_diag.get('modelVersion', 'unknown')}" if yolo_diag.get("available") else f"unavailable:{yolo_diag.get('diagnostic', 'unknown')}",
        "supervision": "available:0.25.1",
        "tesseract": f"available:{ocr_diag.get('model', 'tesseract')}" if ocr_diag.get("available") else f"unavailable:{ocr_diag.get('diagnostic', 'unknown')}",
        "pythonWorker": "available_external_docker_worker",
        "open3d": "unavailable_future_stage_not_implemented",
        "freecad": "unavailable_future_stage_not_implemented",
    }

def _default_availability() -> dict:
    return {
        "opencv": f"available:{cv2.__version__}",
        "yoloSupervision": yolo_availability_string(),
        "yolo": yolo_availability_string(),
        "supervision": supervision_availability_string(),
        "tesseract": tesseract_availability_string(),
        "pythonWorker": "available_external_docker_worker",
        "open3d": "unavailable_future_stage_not_implemented",
        "freecad": "unavailable_future_stage_not_implemented",
    }


# ---------------------------------------------------------------------------
# Startup event
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    for jid, j in list(active_render_jobs.items()):
        if j["status"] in ("queued", "processing"):
            j["status"] = "failed"
            j["error"] = "Worker restarted while job was active"
            j["completed_at"] = time.time()
    print(f"[startup] Worker v{TOOL_VERSION} ready. MAX_CONCURRENT_JOBS={MAX_CONCURRENT_JOBS} BATCH_SIZE={BATCH_SIZE} MAX_FILES_PER_JOB={MAX_FILES_PER_JOB} FETCH_CONCURRENCY={FETCH_CONCURRENCY} OCR_ONLY_ON_YOLO_HITS={OCR_ONLY_ON_YOLO_HITS} SKIP_THUMBNAILS={SKIP_THUMBNAILS} DB={'configured' if RAW_DATABASE_URL else 'NOT CONFIGURED'}")


# ---------------------------------------------------------------------------
# Image analysis helpers (unchanged from v0.4.0)
# ---------------------------------------------------------------------------

def make_thumbnail(content: bytes) -> str | None:
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((160, 160))
            out = io.BytesIO()
            img.convert("RGB").save(out, format="JPEG", quality=72)
            return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")
    except Exception:
        return None


def normalize_line(x1: int, y1: int, x2: int, y2: int, width: int, height: int) -> dict[str, Any]:
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    orientation = "horizontal" if dx > dy * 2 else "vertical" if dy > dx * 2 else "diagonal"
    length = float((dx * dx + dy * dy) ** 0.5)
    return {
        "x1": int(round(x1 / max(1, width) * 1000)),
        "y1": int(round(y1 / max(1, height) * 1000)),
        "x2": int(round(x2 / max(1, width) * 1000)),
        "y2": int(round(y2 / max(1, height) * 1000)),
        "orientation": orientation,
        "strength": round(min(1.0, length / max(1, max(width, height))), 4),
        "coordinateSystem": "normalized_image_0_1000",
    }


def extract_lines(edges: np.ndarray, width: int, height: int) -> list[dict[str, Any]]:
    raw = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=50, minLineLength=max(20, min(width, height) // 5), maxLineGap=12)
    if raw is None:
        return []
    normalized = [normalize_line(int(x1), int(y1), int(x2), int(y2), width, height) for [[x1, y1, x2, y2]] in raw[:16]]
    normalized.sort(key=lambda item: item["strength"], reverse=True)
    return normalized[:8]


def extract_regions(edges: np.ndarray, width: int, height: int) -> list[dict[str, Any]]:
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions: list[dict[str, Any]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < max(100, width * height * 0.002) or area > width * height * 0.8:
            continue
        aspect = w / max(1, h)
        if aspect < 0.15 or aspect > 8:
            continue
        regions.append({
            "x": int(round(x / max(1, width) * 1000)),
            "y": int(round(y / max(1, height) * 1000)),
            "width": int(round(w / max(1, width) * 1000)),
            "height": int(round(h / max(1, height) * 1000)),
            "coordinateSystem": "normalized_image_0_1000",
        })
    regions.sort(key=lambda item: item["width"] * item["height"], reverse=True)
    return regions[:8]


def build_candidates(job: VisionJob, file_job: FileJob, byte_hash: str, created_at: str, run_hash: str, edge_ratio: float, lines: list[dict[str, Any]], regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    base = {
        "surveyId": job.surveyId,
        "fileId": file_job.fileId,
        "fileUrl": file_job.fileUrl,
        "filename": file_job.filename,
        "toolName": TOOL_NAME,
        "toolVersion": TOOL_VERSION,
        "runHash": run_hash,
        "reviewStatus": "review_required",
        "nonAuthoritative": True,
        "createdAt": created_at,
    }
    out: list[dict[str, Any]] = []
    out.append({**base, "candidateId": "pending", "deterministicHash": "pending", "candidateType": "edge_map_summary", "candidateCategory": "quality", "confidence": int(max(8, min(85, edge_ratio * 220))), "summary": "External OpenCV Canny edge summary from decoded image bytes.", "payload": {"sourceImageSha256": byte_hash, "source": "opencv_canny", "edgePixelRatio": round(edge_ratio, 6)}, "limitations": base_limitations()})
    for index, line in enumerate(lines):
        kind = "roof_edge_candidate" if line["orientation"] == "horizontal" else "dominant_line_candidate"
        out.append({**base, "candidateId": "pending", "deterministicHash": "pending", "candidateType": kind, "candidateCategory": "roof_context" if kind == "roof_edge_candidate" else "structure_context", "confidence": int(max(12, min(76, line["strength"] * 88))), "summary": f"External OpenCV Hough {line['orientation']} line candidate.", "payload": {"sourceImageSha256": byte_hash, "source": "opencv_hough_lines_p", "lineIndex": index, "line": line}, "line": line, "limitations": ["Line is an OpenCV pixel cue, not a measured roof edge.", *base_limitations()]})
    for index, region in enumerate(regions):
        candidate_type = "rectangular_region_candidate" if index % 2 == 0 else "obstruction_candidate"
        out.append({**base, "candidateId": "pending", "deterministicHash": "pending", "candidateType": candidate_type, "candidateCategory": "field_context", "confidence": int(max(18, min(70, 35 + region["width"] * region["height"] / 20000))), "summary": "External OpenCV contour/bounding rectangle review candidate.", "payload": {"sourceImageSha256": byte_hash, "source": "opencv_contours_bounding_rect", "regionIndex": index, "region": region}, "region": region, "limitations": ["Region is an OpenCV contour cue, not a classified object or CAD boundary.", *base_limitations()]})
    finalized = []
    for index, candidate in enumerate(out):
        deterministic_hash = stable_hash({**candidate, "candidateId": "stable", "deterministicHash": "stable", "createdAt": "stable-created-at"})
        finalized.append({**candidate, "candidateId": f"ospv_{deterministic_hash[:24]}_{index + 1}", "deterministicHash": deterministic_hash})
    return finalized


# ---------------------------------------------------------------------------
# Legacy single-image path (kept for backward compat, uses conditional OCR)
# ---------------------------------------------------------------------------
def analyze_file_with_bytes(job: VisionJob, file_job: FileJob, content: bytes, created_at: str) -> dict[str, Any]:
    """Analyze a file with pre-fetched bytes (no network I/O). Uses conditional OCR."""
    try:
        started = time.time()
        byte_hash = hashlib.sha256(content).hexdigest()
        np_bytes = np.frombuffer(content, dtype=np.uint8)
        image = cv2.imdecode(np_bytes, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("OpenCV could not decode image bytes")
        height, width = image.shape[:2]
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 50, 150)
        edge_ratio = float(np.count_nonzero(edges)) / float(max(1, edges.size))
        lines = extract_lines(edges, width, height)
        regions = extract_regions(edges, width, height)
        thumbnail = None if SKIP_THUMBNAILS else make_thumbnail(content)
        opencv_candidates = build_candidates(job, file_job, byte_hash, created_at, "pending", edge_ratio, lines, regions) if tool_requested(job, "opencv_primitives") else []
        elapsed_before_yolo = time.time() - started
        if elapsed_before_yolo > PROCESSING_TIMEOUT_SECONDS:
            yolo_result = {"available": False, "diagnostic": "processing_timeout_before_yolo", "candidates": [], "elapsedMs": 0, "limitations": []}
        else:
            yolo_result = yolo_service.detect(image, survey_id=job.surveyId, file_id=file_job.fileId, file_url=file_job.fileUrl, filename=file_job.filename, byte_hash=byte_hash, created_at=created_at) if tool_requested(job, "yolo_detection") else {"available": False, "diagnostic": "yolo_detection_not_requested", "candidates": [], "elapsedMs": 0, "limitations": []}

        # v0.5.0: Conditional OCR — skip if no YOLO detections
        has_yolo_detections = len(yolo_result.get("candidates", [])) > 0
        elapsed_before_ocr = time.time() - started
        if elapsed_before_ocr > PROCESSING_TIMEOUT_SECONDS:
            ocr_result = {"available": False, "diagnostic": "processing_timeout_before_ocr", "candidates": [], "elapsedMs": 0, "limitations": []}
        elif OCR_ONLY_ON_YOLO_HITS and not has_yolo_detections:
            ocr_result = {"available": False, "diagnostic": "ocr_skipped_no_yolo_hits", "candidates": [], "elapsedMs": 0, "limitations": []}
        else:
            ocr_requested = tool_requested(job, "tesseract_ocr") or tool_requested(job, "ocr_equipment_labels")
            ocr_result = ocr_service.detect(
                image,
                survey_id=job.surveyId,
                file_id=file_job.fileId,
                file_url=file_job.fileUrl,
                filename=file_job.filename,
                byte_hash=byte_hash,
                created_at=created_at,
                yolo_candidates=yolo_result.get("candidates", []),
                include_equipment_hints=tool_requested(job, "ocr_equipment_labels"),
            ) if ocr_requested else {"available": False, "diagnostic": "tesseract_ocr_not_requested", "candidates": [], "elapsedMs": 0, "limitations": []}

        candidates = [*opencv_candidates, *yolo_result.get("candidates", []), *ocr_result.get("candidates", [])]
        run_hash = stable_hash({"fileId": file_job.fileId, "sha256": byte_hash, "lines": lines, "regions": regions, "yoloCandidates": [c.get("payload", {}) for c in yolo_result.get("candidates", [])], "ocrCandidates": [c.get("payload", {}) for c in ocr_result.get("candidates", [])]})
        # Save content length before cleanup
        content_byte_size = len(content)
        # Compute brightness and sharpness before deleting gray
        dominant_brightness = round(float(np.mean(gray)), 3) if gray is not None else None
        sharpness_score = round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 3) if gray is not None else None
        del image, gray, blur, edges, np_bytes, content
        gc.collect()
        return {
            "surveyId": job.surveyId,
            "fileId": file_job.fileId,
            "fileUrl": file_job.fileUrl,
            "filename": file_job.filename,
            "analyzed": True,
            "error": None,
            "metadata": {
                "widthPx": width,
                "heightPx": height,
                "format": "image/jpeg",
                "byteSize": content_byte_size,
                "sha256": byte_hash,
                "dominantBrightness": dominant_brightness,
                "sharpnessScore": sharpness_score,
                "qualityScore": int(max(5, min(95, 45 + edge_ratio * 250))),
                "elapsedMs": int((time.time() - started) * 1000),
                "yoloElapsedMs": yolo_result.get("elapsedMs", 0),
                "ocrElapsedMs": ocr_result.get("elapsedMs", 0),
            },
            "thumbnailDataUrl": thumbnail,
            "edgeSummary": {
                "edgePixelRatio": round(edge_ratio, 6),
                "horizontalStrength": round(sum(1 for line in lines if line["orientation"] == "horizontal") / max(1, len(lines)), 4),
                "verticalStrength": round(sum(1 for line in lines if line["orientation"] == "vertical") / max(1, len(lines)), 4),
                "diagonalStrength": round(sum(1 for line in lines if line["orientation"] == "diagonal") / max(1, len(lines)), 4),
                "denseRegionCount": len(regions),
            },
            "candidates": candidates,
            "limitations": [*base_limitations(), *([f"YOLO diagnostic: {yolo_result.get('diagnostic')}"] if yolo_result.get("diagnostic") else []), *([f"Tesseract OCR diagnostic: {ocr_result.get('diagnostic')}"] if ocr_result.get("diagnostic") else [])],
            "toolDiagnostics": {
                "yolo": {"available": yolo_result.get("available"), "diagnostic": yolo_result.get("diagnostic"), "model": yolo_result.get("model"), "modelVersion": yolo_result.get("modelVersion"), "elapsedMs": yolo_result.get("elapsedMs", 0)},
                "tesseract": {"available": ocr_result.get("available"), "diagnostic": ocr_result.get("diagnostic"), "model": ocr_result.get("model"), "modelVersion": ocr_result.get("modelVersion"), "pytesseractVersion": ocr_result.get("pytesseractVersion"), "elapsedMs": ocr_result.get("elapsedMs", 0)},
            },
            "runHash": run_hash,
        }
    except Exception as exc:
        gc.collect()
        run_hash = stable_hash({"surveyId": job.surveyId, "fileId": file_job.fileId, "error": str(exc)})
        return {
            "surveyId": job.surveyId,
            "fileId": file_job.fileId,
            "fileUrl": file_job.fileUrl,
            "filename": file_job.filename,
            "analyzed": False,
            "error": str(exc)[:300],
            "metadata": {"widthPx": None, "heightPx": None, "format": None, "byteSize": 0, "sha256": None, "dominantBrightness": None, "sharpnessScore": None, "qualityScore": None},
            "thumbnailDataUrl": None,
            "edgeSummary": None,
            "candidates": [],
            "limitations": ["Image bytes could not be fetched or decoded by the external OpenCV worker; no candidates emitted for this file.", *base_limitations()],
            "runHash": run_hash,
        }


def analyze_file(job: VisionJob, file_job: FileJob, created_at: str) -> dict[str, Any]:
    """Fetch and analyze a file (legacy wrapper)."""
    try:
        started = time.time()
        with httpx.Client(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = client.get(file_job.fileUrl)
            response.raise_for_status()
            content = response.content
        if len(content) > MAX_IMAGE_BYTES:
            raise ValueError(f"image exceeds max byte size {MAX_IMAGE_BYTES}")
        return analyze_file_with_bytes(job, file_job, content, created_at)
    except Exception as exc:
        gc.collect()
        run_hash = stable_hash({"surveyId": job.surveyId, "fileId": file_job.fileId, "error": str(exc)})
        return {
            "surveyId": job.surveyId,
            "fileId": file_job.fileId,
            "fileUrl": file_job.fileUrl,
            "filename": file_job.filename,
            "analyzed": False,
            "error": str(exc)[:300],
            "metadata": {"widthPx": None, "heightPx": None, "format": None, "byteSize": 0, "sha256": None, "dominantBrightness": None, "sharpnessScore": None, "qualityScore": None},
            "thumbnailDataUrl": None,
            "edgeSummary": None,
            "candidates": [],
            "limitations": ["Image bytes could not be fetched or decoded by the external OpenCV worker; no candidates emitted for this file.", *base_limitations()],
            "runHash": run_hash,
        }


def tool_requested(job: VisionJob, tool: str) -> bool:
    return tool in set(job.requestedTools or [])

def yolo_availability_string() -> str:
    availability = yolo_service.availability()
    if availability.yolo.get("available") and availability.supervision.get("available"):
        return f"available:{availability.yolo.get('model')}:{availability.yolo.get('modelVersion')}"
    return f"unavailable:{availability.yolo.get('reason') or availability.supervision.get('reason') or 'model_not_loaded'}"

def supervision_availability_string() -> str:
    availability = yolo_service.availability()
    if availability.supervision.get("available"):
        return f"available:{availability.supervision.get('version')}"
    return f"unavailable:{availability.supervision.get('reason') or 'supervision_not_loaded'}"

def tesseract_availability_string() -> str:
    return ocr_service.availability_string()

def pytesseract_availability_string() -> str:
    availability = ocr_service.availability()
    if availability.pytesseract.get("available"):
        return f"available:{availability.pytesseract.get('version')}"
    return f"unavailable:{availability.pytesseract.get('reason') or 'pytesseract_not_loaded'}"
