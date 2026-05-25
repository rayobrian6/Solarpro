import asyncio
import base64
import gc
import hashlib
import io
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

import cv2
import numpy as np
import requests
from app.ocr_detection import TesseractOcrService
from app.yolo_detection import YoloDetectionService
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel, Field

TOOL_NAME = "external-opencv-photo-vision-worker"
TOOL_VERSION = "0.2.0"
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(16 * 1024 * 1024)))
FETCH_TIMEOUT_SECONDS = float(os.environ.get("FETCH_TIMEOUT_SECONDS", "12"))
MAX_FILES_PER_JOB = int(os.environ.get("MAX_FILES_PER_JOB", "12"))
PROCESSING_TIMEOUT_SECONDS = float(os.environ.get("PROCESSING_TIMEOUT_SECONDS", "90"))
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "1"))

yolo_service = YoloDetectionService()
ocr_service = TesseractOcrService()

app = FastAPI(title="SolarPro External OpenCV Photo Vision Worker", version=TOOL_VERSION)

# ---------------------------------------------------------------------------
# Async job queue — in-memory job store + semaphore for YOLO serialization
# ---------------------------------------------------------------------------
processing_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)


class RenderJob:
    """In-memory job record for async processing."""

    def __init__(self, render_job_id: str, job: "VisionJob"):
        self.render_job_id = render_job_id
        self.job = job
        self.status: Literal["queued", "processing", "completed", "failed", "cancelled"] = "queued"
        self.result: dict[str, Any] | None = None
        self.error: str | None = None
        self.created_at = time.time()
        self.completed_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "renderJobId": self.render_job_id,
            "status": self.status,
            "createdAt": self.created_at,
        }
        if self.result is not None:
            out["result"] = self.result
        if self.error is not None:
            out["error"] = self.error
        if self.completed_at is not None:
            out["completedAt"] = self.completed_at
        return out


render_jobs: dict[str, RenderJob] = {}


# ---------------------------------------------------------------------------
# Startup / shutdown — clean up stale in-memory jobs
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def _startup():
    # Mark any leftover in-memory jobs as failed (shouldn't happen after clean
    # shutdown, but protects against hard crashes / restarts)
    for rj in render_jobs.values():
        if rj.status in ("queued", "processing"):
            rj.status = "failed"
            rj.error = "Server restarted while job was active"
            rj.completed_at = time.time()


# ---------------------------------------------------------------------------
# Periodic cleanup — remove completed/failed/cancelled jobs older than 1 hour
# ---------------------------------------------------------------------------
async def _cleanup_old_jobs():
    while True:
        await asyncio.sleep(300)  # every 5 minutes
        cutoff = time.time() - 3600  # 1 hour
        to_remove = [
            jid
            for jid, rj in render_jobs.items()
            if rj.status in ("completed", "failed", "cancelled")
            and rj.completed_at is not None
            and rj.completed_at < cutoff
        ]
        for jid in to_remove:
            del render_jobs[jid]


@app.on_event("startup")
async def _start_cleanup_task():
    asyncio.create_task(_cleanup_old_jobs())


# ---------------------------------------------------------------------------
# Helper types and functions (unchanged from v0.1)
# ---------------------------------------------------------------------------
def stable_hash(value: Any) -> str:
    import json
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
        "SolarPro must persist and review results; this external worker does not write to the SolarPro database.",
    ]


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
    requestedTools: list[str] = Field(default_factory=lambda: ["opencv_primitives", "yolo_detection", "tesseract_ocr", "ocr_equipment_labels"])
    files: list[FileJob] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Health endpoint — now includes capacity info
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict[str, Any]:
    yolo_availability = yolo_service.availability()
    ocr_availability = ocr_service.availability()
    queued = sum(1 for rj in render_jobs.values() if rj.status == "queued")
    processing = sum(1 for rj in render_jobs.values() if rj.status == "processing")
    return {
        "status": "ok",
        "schemaVersion": "solarpro_external_photo_vision_health_v1",
        "toolName": TOOL_NAME,
        "toolVersion": TOOL_VERSION,
        "capacity": {
            "maxConcurrentJobs": MAX_CONCURRENT_JOBS,
            "currentlyProcessing": processing,
            "currentlyQueued": queued,
            "available": processing < MAX_CONCURRENT_JOBS,
        },
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
        "authority": no_authority(),
    }


# ---------------------------------------------------------------------------
# POST /v1/photo-vision/jobs — submit job, returns 202 Accepted instantly
# ---------------------------------------------------------------------------
@app.post("/v1/photo-vision/jobs", status_code=202)
async def submit_job(job: VisionJob) -> dict[str, Any]:
    render_job_id = f"rj_{uuid.uuid4().hex[:16]}"
    rj = RenderJob(render_job_id, job)
    render_jobs[render_job_id] = rj
    asyncio.create_task(_process_job_background(render_job_id))
    return {
        "renderJobId": render_job_id,
        "status": "queued",
        "message": "Job submitted. Poll GET /v1/photo-vision/jobs/{renderJobId} for status.",
        "toolVersion": TOOL_VERSION,
    }


# ---------------------------------------------------------------------------
# GET /v1/photo-vision/jobs/{renderJobId} — poll job status
# ---------------------------------------------------------------------------
@app.get("/v1/photo-vision/jobs/{render_job_id}")
async def get_job_status(render_job_id: str) -> dict[str, Any]:
    rj = render_jobs.get(render_job_id)
    if not rj:
        return {"error": f"Job {render_job_id} not found", "status": "not_found"}
    return rj.to_dict()


# ---------------------------------------------------------------------------
# DELETE /v1/photo-vision/jobs/{renderJobId} — cancel a queued job
# ---------------------------------------------------------------------------
@app.delete("/v1/photo-vision/jobs/{render_job_id}")
async def cancel_job(render_job_id: str) -> dict[str, Any]:
    rj = render_jobs.get(render_job_id)
    if not rj:
        return {"error": f"Job {render_job_id} not found", "status": "not_found"}
    if rj.status == "queued":
        rj.status = "cancelled"
        rj.completed_at = time.time()
        return {"renderJobId": render_job_id, "status": "cancelled", "message": "Job cancelled successfully."}
    if rj.status == "processing":
        # Can't cancel a job that's already being processed by the semaphore,
        # but we can mark it for the background task to check
        rj.status = "cancelled"
        rj.completed_at = time.time()
        return {"renderJobId": render_job_id, "status": "cancelled", "message": "Job marked for cancellation (may still complete if processing is in progress)."}
    return {"renderJobId": render_job_id, "status": rj.status, "message": f"Job is already {rj.status} and cannot be cancelled."}


# ---------------------------------------------------------------------------
# Background job processor — acquires semaphore, runs sync processing in
# thread pool so asyncio event loop stays responsive for health/poll endpoints
# ---------------------------------------------------------------------------
async def _process_job_background(render_job_id: str) -> None:
    rj = render_jobs.get(render_job_id)
    if not rj:
        return

    # Check if already cancelled before acquiring semaphore
    if rj.status == "cancelled":
        return

    try:
        async with processing_semaphore:
            # Re-check after acquiring semaphore (may have been cancelled while waiting)
            if rj.status == "cancelled":
                return

            rj.status = "processing"

            # Run CPU-bound processing in thread pool to keep event loop responsive
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _run_job_sync, rj.job)

            # Check if cancelled during processing
            if rj.status == "cancelled":
                return

            rj.result = result
            rj.status = "completed"
            rj.completed_at = time.time()

    except Exception as exc:
        if rj.status != "cancelled":
            rj.status = "failed"
            rj.error = str(exc)[:500]
            rj.completed_at = time.time()


# ---------------------------------------------------------------------------
# Synchronous job processing (same logic as old run_job, runs in thread pool)
# ---------------------------------------------------------------------------
def _run_job_sync(job: VisionJob) -> dict[str, Any]:
    created_at = job.createdAt or datetime.now(timezone.utc).isoformat()
    files: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    for file_job in job.files[:MAX_FILES_PER_JOB]:
        file_result = analyze_file(job, file_job, created_at)
        files.append(file_result)
        candidates.extend(file_result["candidates"])
        gc.collect()
    run_hash = stable_hash({
        "surveyId": job.surveyId,
        "projectId": job.projectId,
        "toolName": TOOL_NAME,
        "toolVersion": TOOL_VERSION,
        "files": [{"fileId": f["fileId"], "sha256": f["metadata"].get("sha256"), "candidateHashes": [c["deterministicHash"] for c in f["candidates"]]} for f in files],
    })
    for file_result in files:
        file_result["runHash"] = run_hash
    for candidate in candidates:
        candidate["runHash"] = run_hash
        candidate["deterministicHash"] = stable_hash({**candidate, "createdAt": "stable-created-at", "runHash": run_hash})
        candidate["candidateId"] = f"ospv_{candidate['deterministicHash'][:24]}"
    return {
        "schemaVersion": "solarpro_external_photo_vision_result_v1",
        "surveyId": job.surveyId,
        "projectId": job.projectId,
        "toolName": TOOL_NAME,
        "toolVersion": TOOL_VERSION,
        "createdAt": created_at,
        "processedCount": len([f for f in files if f["analyzed"]]),
        "failedCount": len([f for f in files if not f["analyzed"]]),
        "candidateCount": len(candidates),
        "runHash": run_hash,
        "files": files,
        "candidates": candidates,
        "availability": {
            "opencv": f"available:{cv2.__version__}",
            "yoloSupervision": yolo_availability_string(),
            "yolo": yolo_availability_string(),
            "supervision": supervision_availability_string(),
            "tesseract": tesseract_availability_string(),
            "pytesseract": pytesseract_availability_string(),
            "open3d": "unavailable_future_stage_not_implemented",
            "freecad": "unavailable_future_stage_not_implemented",
            "pythonWorker": "available_external_docker_worker",
        },
        "authority": no_authority(),
        "limitations": base_limitations(),
    }


# ---------------------------------------------------------------------------
# analyze_file — same logic as v0.1, runs synchronously in thread pool
# ---------------------------------------------------------------------------
def analyze_file(job: VisionJob, file_job: FileJob, created_at: str) -> dict[str, Any]:
    try:
        started = time.time()
        response = requests.get(file_job.fileUrl, timeout=FETCH_TIMEOUT_SECONDS)
        response.raise_for_status()
        content = response.content
        if len(content) > MAX_IMAGE_BYTES:
            raise ValueError(f"image exceeds max byte size {MAX_IMAGE_BYTES}")
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
        thumbnail = make_thumbnail(content)
        opencv_candidates = build_candidates(job, file_job, byte_hash, created_at, "pending", edge_ratio, lines, regions) if tool_requested(job, "opencv_primitives") else []
        elapsed_before_yolo = time.time() - started
        if elapsed_before_yolo > PROCESSING_TIMEOUT_SECONDS:
            yolo_result = {"available": False, "diagnostic": "processing_timeout_before_yolo", "candidates": [], "elapsedMs": 0, "limitations": []}
        else:
            yolo_result = yolo_service.detect(image, survey_id=job.surveyId, file_id=file_job.fileId, file_url=file_job.fileUrl, filename=file_job.filename, byte_hash=byte_hash, created_at=created_at) if tool_requested(job, "yolo_detection") else {"available": False, "diagnostic": "yolo_detection_not_requested", "candidates": [], "elapsedMs": 0, "limitations": []}
        elapsed_before_ocr = time.time() - started
        if elapsed_before_ocr > PROCESSING_TIMEOUT_SECONDS:
            ocr_result = {"available": False, "diagnostic": "processing_timeout_before_ocr", "candidates": [], "elapsedMs": 0, "limitations": []}
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
                "format": response.headers.get("content-type"),
                "byteSize": len(content),
                "sha256": byte_hash,
                "dominantBrightness": round(float(np.mean(gray)), 3),
                "sharpnessScore": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 3),
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


def make_thumbnail(content: bytes) -> str | None:
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.thumbnail((160, 160))
            out = io.BytesIO()
            img.convert("RGB").save(out, format="JPEG", quality=72)
            return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")
    except Exception:
        return None


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
