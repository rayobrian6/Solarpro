import base64
import hashlib
import io
import os
import time
from datetime import datetime, timezone
from typing import Any, Literal

import cv2
import numpy as np
import requests
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel, Field

TOOL_NAME = "external-opencv-photo-vision-worker"
TOOL_VERSION = "0.1.0"
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(16 * 1024 * 1024)))
FETCH_TIMEOUT_SECONDS = float(os.environ.get("FETCH_TIMEOUT_SECONDS", "12"))

app = FastAPI(title="SolarPro External OpenCV Photo Vision Worker", version=TOOL_VERSION)


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
        "OpenCV candidates are pixel-derived review cues only; they do not create roof planes, measurements, CAD geometry, permit inputs, BOM inputs, or engineering truth.",
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
    files: list[FileJob] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "schemaVersion": "solarpro_external_photo_vision_health_v1",
        "toolName": TOOL_NAME,
        "toolVersion": TOOL_VERSION,
        "tools": {
            "opencv": {"available": True, "version": cv2.__version__},
            "python": {"available": True},
            "yoloSupervision": {"available": False, "reason": "stage_2_not_implemented"},
            "open3d": {"available": False, "reason": "future_stage_not_implemented"},
            "freecad": {"available": False, "reason": "future_stage_not_implemented"},
            "tesseract": {"available": False, "reason": "stage_3_not_implemented_in_this_worker"},
        },
        "authority": no_authority(),
    }


@app.post("/v1/photo-vision/jobs")
def run_job(job: VisionJob) -> dict[str, Any]:
    created_at = job.createdAt or datetime.now(timezone.utc).isoformat()
    files: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    for file_job in job.files:
        file_result = analyze_file(job, file_job, created_at)
        files.append(file_result)
        candidates.extend(file_result["candidates"])
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
            "yoloSupervision": "unavailable_stage_2_not_implemented",
            "tesseract": "unavailable_stage_3_not_implemented_in_this_worker",
            "open3d": "unavailable_future_stage_not_implemented",
            "freecad": "unavailable_future_stage_not_implemented",
            "pythonWorker": "available_external_docker_worker",
        },
        "authority": no_authority(),
        "limitations": base_limitations(),
    }


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
        run_hash = stable_hash({"fileId": file_job.fileId, "sha256": byte_hash, "lines": lines, "regions": regions})
        candidates = build_candidates(job, file_job, byte_hash, created_at, run_hash, edge_ratio, lines, regions)
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
            "limitations": base_limitations(),
            "runHash": run_hash,
        }
    except Exception as exc:
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
