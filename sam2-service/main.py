"""
SAM 2 Segmentation Service — FastAPI microservice for roof geometry extraction.

Runs SAM 2.1 Automatic Mask Generation on survey photos and returns
polygon-based segmentation masks suitable for Pipeline B consumption.

Architecture:
  - Loads sam2.1_hiera_small checkpoint on startup (~184MB download)
  - POST /segment: accepts image bytes, returns polygon masks
  - GET /health: service readiness check
  - Runs on GPU when available, falls back to CPU
  - Mask-to-polygon conversion via OpenCV findContours + Douglas-Peucker

Deployment:
  - Render GPU service (T4 or A100)
  - Docker container with CUDA support
  - Environment variable CHECKPOINT controls model size

REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
"""

import os
import time
import logging
import traceback
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sam2-service")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Checkpoint name — can be overridden via env var for larger/smaller models
CHECKPOINT_NAME = os.environ.get("SAM2_CHECKPOINT", "sam2.1_hiera_small")
# Device: "cuda" if GPU available, else "cpu"
DEVICE = "cuda" if _has_cuda() else "cpu"
# Minimum mask area as fraction of image — filters noise masks
MIN_MASK_AREA_FRACTION = float(os.environ.get("SAM2_MIN_MASK_AREA_FRACTION", "0.02"))
# Maximum masks to return per image
MAX_MASKS = int(os.environ.get("SAM2_MAX_MASKS", "20"))
# Douglas-Peucker simplification epsilon (pixels)
DOUGLAS_PEUCKER_EPSILON = float(os.environ.get("SAM2_DOUGLAS_PEUCKER_EPSILON", "5.0"))
# Minimum polygon points after simplification
MIN_POLYGON_POINTS = 3
# Service port
PORT = int(os.environ.get("PORT", "8000"))


def _has_cuda() -> bool:
    """Check if CUDA GPU is available."""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------

class PolygonPoint(BaseModel):
    x: float
    y: float

class SegmentationMask(BaseModel):
    """A single segmentation mask with polygon outline."""
    mask_index: int
    polygon: list[PolygonPoint]
    area: float
    bbox: list[float]  # [x, y, width, height] in pixel coords
    confidence: float
    stability_score: float
    class_hint: str  # heuristic classification from geometry + position
    point_count: int

class SegmentResponse(BaseModel):
    """Response from the /segment endpoint."""
    success: bool
    masks: list[SegmentationMask]
    mask_count: int
    image_width: int
    image_height: int
    processing_time_ms: float
    model_info: dict
    error: Optional[str] = None

class HealthResponse(BaseModel):
    """Response from the /health endpoint."""
    status: str
    model_loaded: bool
    device: str
    checkpoint: str
    cuda_available: bool
    uptime_seconds: float


# ---------------------------------------------------------------------------
# SAM 2 model loader (lazy, loaded on first request or at startup)
# ---------------------------------------------------------------------------

_sam2_model = None
_sam2_amg = None
_model_load_time = None
_start_time = time.time()


def load_sam2_model():
    """Load SAM 2 model and Automatic Mask Generator."""
    global _sam2_model, _sam2_amg, _model_load_time

    if _sam2_amg is not None:
        return _sam2_amg

    logger.info(f"Loading SAM 2 checkpoint: {CHECKPOINT_NAME} on device: {DEVICE}")
    t0 = time.time()

    try:
        from sam2 import build_sam
        from sam2.automatic_mask_generation import SAM2AutomaticMaskGenerator

        # Build the model from the checkpoint registry
        # sam2.1_hiera_small is the default — registry handles download
        _sam2_model = build_sam(CHECKPOINT_NAME, device=DEVICE)

        # Create the automatic mask generator
        # points_per_side: grid of prompt points for AMG (default 32x32)
        # points_per_batch: batch size for point inference
        # pred_iou_thresh: filter masks with predicted IoU below this
        # stability_score_thresh: filter unstable masks
        # min_mask_region_area: post-process to remove small disconnected regions
        _sam2_amg = SAM2AutomaticMaskGenerator(
            model=_sam2_model,
            points_per_side=32,
            points_per_batch=64,
            pred_iou_thresh=0.7,
            stability_score_thresh=0.92,
            min_mask_region_area=int(512 * 512 * MIN_MASK_AREA_FRACTION),
        )

        _model_load_time = time.time() - t0
        logger.info(
            f"SAM 2 loaded successfully in {_model_load_time:.1f}s "
            f"(checkpoint={CHECKPOINT_NAME}, device={DEVICE})"
        )

    except Exception as e:
        logger.error(f"Failed to load SAM 2 model: {e}")
        logger.error(traceback.format_exc())
        raise

    return _sam2_amg


# ---------------------------------------------------------------------------
# Mask-to-polygon conversion
# ---------------------------------------------------------------------------

def mask_to_polygon(mask_bin: np.ndarray, epsilon: float = DOUGLAS_PEUCKER_EPSILON):
    """
    Convert a binary mask to a simplified polygon using OpenCV
    contour finding + Douglas-Peucker simplification.

    Returns list of polygon points [{x, y}, ...] or empty list if no
    valid contour found.
    """
    # Ensure mask is uint8
    mask_uint8 = (mask_bin * 255).astype(np.uint8) if mask_bin.dtype != np.uint8 else mask_bin

    # Find contours — RETR_EXTERNAL for outer boundary only
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return []

    # Take the largest contour by area
    best_contour = max(contours, key=cv2.contourArea)

    # Simplify with Douglas-Peucker
    simplified = cv2.approxPolyDP(best_contour, epsilon, closed=True)

    # Need at least 3 points for a valid polygon
    if len(simplified) < MIN_POLYGON_POINTS:
        return []

    # Convert to list of {x, y} dicts
    points = []
    for pt in simplified:
        points.append({"x": float(pt[0][0]), "y": float(pt[0][1])})

    return points


def classify_mask_region(
    bbox: list[float],
    area: float,
    img_w: int,
    img_h: int,
    stability_score: float,
) -> str:
    """
    Heuristic classification of a mask region based on position, size,
    and geometry. This is NOT semantic classification from SAM 2 (which
    is class-agnostic) — it's a geometry-based hint for downstream
    Pipeline B workers.

    Classification logic mirrors the existing roofGeometryExtractor
    heuristic but is simpler since SAM 2 already provides accurate
    boundaries — we just need to label what each region likely is.

    Returns one of: roof, wall, sky, ground, obstruction, equipment, unknown
    """
    x, y, w, h = bbox
    # Normalize to 0-1 range
    norm_y_center = (y + h / 2) / img_h
    norm_x_center = (x + w / 2) / img_w
    norm_area = area / (img_w * img_h)
    aspect_ratio = max(w, h) / max(min(w, h), 1)

    # Sky: top of image, large area
    if norm_y_center < 0.35 and norm_area > 0.05:
        return "sky"
    # Roof: upper half, wide aspect ratio, significant area
    if norm_y_center < 0.55 and norm_area > 0.03 and aspect_ratio > 1.2:
        return "roof"
    # Roof fallback: upper half, significant area
    if norm_y_center < 0.55 and norm_area > 0.05:
        return "roof"
    # Wall: middle of image, taller than wide
    if 0.25 <= norm_y_center < 0.8 and h > w * 0.8:
        return "wall"
    # Ground: bottom of image
    if norm_y_center > 0.65 and norm_area > 0.02:
        return "ground"
    # Equipment: small area, upper half
    if 0.003 < norm_area < 0.04 and norm_y_center < 0.6:
        return "equipment"
    # Obstruction: very small area
    if norm_area < 0.01:
        return "obstruction"

    return "unknown"


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SAM 2 Segmentation Service",
    description="Roof geometry segmentation using Meta's SAM 2.1 model",
    version="1.0.0",
)

# CORS — allow the Next.js app to call this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Load SAM 2 model on startup so first request is fast."""
    logger.info("SAM 2 service starting — loading model...")
    try:
        load_sam2_model()
        logger.info("Model loaded successfully — service ready")
    except Exception as e:
        logger.warning(f"Model load failed on startup: {e}")
        logger.warning("Service will attempt lazy load on first request")


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check service health and model readiness."""
    return HealthResponse(
        status="ready" if _sam2_amg is not None else "loading",
        model_loaded=_sam2_amg is not None,
        device=DEVICE,
        checkpoint=CHECKPOINT_NAME,
        cuda_available=_has_cuda(),
        uptime_seconds=time.time() - _start_time,
    )


@app.post("/segment", response_model=SegmentResponse)
async def segment_image(
    file: UploadFile = File(..., description="Survey photo (JPEG/PNG/WebP)"),
    min_area_fraction: float = Query(
        default=0.02,
        description="Minimum mask area as fraction of image area",
        ge=0.001,
        le=0.5,
    ),
    max_masks: int = Query(
        default=20,
        description="Maximum number of masks to return",
        ge=1,
        le=100,
    ),
):
    """
    Segment a survey photo using SAM 2 Automatic Mask Generation.

    Returns an array of polygon-based masks with:
    - Simplified polygon outlines (Douglas-Peucker)
    - Bounding boxes in pixel coordinates
    - Stability scores from SAM 2
    - Heuristic class hints (roof, wall, sky, ground, etc.)

    The masks are sorted by area (largest first) and filtered by
    minimum area fraction to remove noise regions.
    """
    t0 = time.time()

    # Load model if not already loaded (lazy load fallback)
    try:
        amg = load_sam2_model()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"SAM 2 model not available: {str(e)}",
        )

    # Read image bytes
    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty image file")

        # Decode image with OpenCV
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise HTTPException(status_code=400, detail="Could not decode image")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image read error: {str(e)}")

    img_h, img_w = image.shape[:2]
    min_area_px = img_w * img_h * min_area_fraction

    # Run SAM 2 Automatic Mask Generation
    try:
        # SAM 2 expects RGB, OpenCV loads BGR
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Generate all masks
        sam_masks = amg.generate(image_rgb)

    except Exception as e:
        logger.error(f"SAM 2 inference failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"SAM 2 inference error: {str(e)}",
        )

    # Process SAM 2 masks into polygon-based results
    result_masks: list[SegmentationMask] = []

    for idx, sam_mask in enumerate(sam_masks):
        # sam_mask is a dict with keys: segmentation, bbox, predicted_iou,
        # stability_score, point_coords, crop_box
        mask_binary = sam_mask["segmentation"]  # np bool array
        bbox = sam_mask["bbox"]  # [x, y, w, h]
        stability = sam_mask["stability_score"]
        predicted_iou = sam_mask["predicted_iou"]
        area_px = int(sam_mask.get("area", np.sum(mask_binary)))

        # Filter by minimum area
        if area_px < min_area_px:
            continue

        # Convert mask to polygon
        polygon_points = mask_to_polygon(mask_binary.astype(np.uint8))

        if len(polygon_points) < MIN_POLYGON_POINTS:
            continue

        # Classify the region (heuristic hint)
        class_hint = classify_mask_region(
            bbox=bbox,
            area=float(area_px),
            img_w=img_w,
            img_h=img_h,
            stability_score=stability,
        )

        # Confidence = blend of SAM 2's predicted IoU and stability score
        # Scale to 0-100 range for compatibility with Pipeline B
        confidence = min(100, round((predicted_iou * 0.4 + stability * 0.6) * 100))

        result_masks.append(SegmentationMask(
            mask_index=idx,
            polygon=[PolygonPoint(x=p["x"], y=p["y"]) for p in polygon_points],
            area=float(area_px),
            bbox=[float(v) for v in bbox],
            confidence=confidence,
            stability_score=round(stability, 4),
            class_hint=class_hint,
            point_count=len(polygon_points),
        ))

    # Sort by area descending, cap at max_masks
    result_masks.sort(key=lambda m: m.area, reverse=True)
    result_masks = result_masks[:max_masks]

    processing_time = (time.time() - t0) * 1000

    logger.info(
        f"Segmented {img_w}x{img_h} image: "
        f"{len(sam_masks)} raw masks → {len(result_masks)} filtered masks "
        f"in {processing_time:.0f}ms"
    )

    return SegmentResponse(
        success=True,
        masks=result_masks,
        mask_count=len(result_masks),
        image_width=img_w,
        image_height=img_h,
        processing_time_ms=round(processing_time, 1),
        model_info={
            "checkpoint": CHECKPOINT_NAME,
            "device": DEVICE,
            "cuda_available": _has_cuda(),
            "model_type": "sam2.1_automatic_mask_generation",
        },
    )


# ---------------------------------------------------------------------------
# Run server
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
