"""
SAM 2 Segmentation Service — FastAPI microservice for roof geometry extraction.

Runs SAM 2.1 Automatic Mask Generation on survey photos and returns
polygon-based segmentation masks suitable for Pipeline B consumption.

Architecture:
  - Loads SAM 2.1 checkpoint from HuggingFace on startup (model determined by
    SAM2_HF_MODEL_ID env var; defaults to sam2.1-hiera-tiny on CPU (~40MB),
    sam2.1-hiera-small on GPU (~184MB))
  - POST /segment: accepts image bytes, returns polygon masks
  - GET /health: service readiness check
  - Runs on GPU when available, falls back to CPU
  - Mask-to-polygon conversion via OpenCV findContours + Douglas-Peucker

Deployment:
  - Render web service (CPU or GPU)
  - Docker container with CPU-only PyTorch (GPU auto-detected at runtime)
  - Environment variable SAM2_HF_MODEL_ID controls model size

CPU Optimization:
  - Images resized to max 384px (CPU) / 2048px (GPU) before processing
  - CPU: points_per_side=8 (64 grid points — stable on Render Standard 4GB RAM;
    9/81 grid caused ~44s processing & 502; 10/100 caused ~49s & OOM/crash)
  - At 256px, 8x8 grid misses roofs entirely (0 masks); at 384px, more detail helps
  - GPU: points_per_side=32 with MAX_IMAGE_DIM=2048 (full quality)
  - Lower pred_iou_thresh (0.6) and stability_score_thresh (0.85) for challenging lighting
  - Smaller points_per_batch (16 vs default 64) to reduce peak memory
  - crop_n_layers=0 on CPU to avoid expensive multi-scale cropping
  - Memory monitoring via resource.getrusage (RSS logged before/after inference)
  - Model loaded once, reused across requests
  - gc.collect() after inference to free memory immediately

REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
"""

import os
import time
import gc
import logging
import resource
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

def _has_cuda() -> bool:
    """Check if CUDA GPU is available."""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False

# Device: "cuda" if GPU available, else "cpu"
# NOTE: DEVICE and IS_CPU must be defined BEFORE any variable that references them
DEVICE = "cuda" if _has_cuda() else "cpu"
# Is this running on CPU?
IS_CPU = DEVICE == "cpu"

# HuggingFace model ID for SAM 2.1 — can be overridden via env var
# Supported: facebook/sam2.1-hiera-tiny, facebook/sam2.1-hiera-small,
#            facebook/sam2.1-hiera-base-plus, facebook/sam2.1-hiera-large
HF_MODEL_ID = os.environ.get("SAM2_HF_MODEL_ID", "facebook/sam2.1-hiera-tiny" if IS_CPU else "facebook/sam2.1-hiera-small")
# Maximum image dimension for processing — larger images are resized
# 384px on CPU: 8x8 grid can detect roofs at this resolution without OOM
# 256px on CPU: too small, 8x8 grid misses roofs entirely (0 masks)
MAX_IMAGE_DIM = int(os.environ.get("SAM2_MAX_IMAGE_DIM", "384" if IS_CPU else "2048"))
# Minimum mask area as fraction of image — filters noise masks
MIN_MASK_AREA_FRACTION = float(os.environ.get("SAM2_MIN_MASK_AREA_FRACTION", "0.02"))
# Prediction confidence and stability thresholds — lower values catch weaker masks
PRED_IOU_THRESH = float(os.environ.get("SAM2_PRED_IOU_THRESH", "0.6"))
STABILITY_SCORE_THRESH = float(os.environ.get("SAM2_STABILITY_SCORE_THRESH", "0.85"))
# Grid density for AMG — fewer points = faster inference, fewer masks
# 8 points/side = 64 grid points (stable on Render CPU but too coarse, 0 masks)
# 9 points/side = 81 grid points (middle ground: enough density for roof detection)
# 10 points/side = 100 grid points (causes OOM/crash on 4GB CPU at ~49s)
# 12 points/side = 144 grid points (crashes even at 256px)
POINTS_PER_SIDE = int(os.environ.get("SAM2_POINTS_PER_SIDE", "9" if IS_CPU else "32"))
# Maximum masks to return per image
MAX_MASKS = int(os.environ.get("SAM2_MAX_MASKS", "20"))
# Douglas-Peucker simplification epsilon (pixels)
DOUGLAS_PEUCKER_EPSILON = float(os.environ.get("SAM2_DOUGLAS_PEUCKER_EPSILON", "5.0"))
# Minimum polygon points after simplification
MIN_POLYGON_POINTS = 3
# Service port — Render injects PORT=10000 for web services
PORT = int(os.environ.get("PORT", "10000"))

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
    model_id: str
    cuda_available: bool
    uptime_seconds: float


# ---------------------------------------------------------------------------
# SAM 2 model loader (lazy, loaded on first request or at startup)
# ---------------------------------------------------------------------------

_sam2_model = None
_sam2_amg = None
_model_load_time = None
_start_time = time.time()


def _get_memory_mb() -> float:
    """Get current process RSS in MB for memory monitoring."""
    try:
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    except Exception:
        return 0.0


def load_sam2_model():
    """Load SAM 2 model and Automatic Mask Generator."""
    global _sam2_model, _sam2_amg, _model_load_time

    if _sam2_amg is not None:
        return _sam2_amg

    logger.info(f"Loading SAM 2 model: {HF_MODEL_ID} on device: {DEVICE}")
    t0 = time.time()

    try:
        from sam2.build_sam import build_sam2_hf
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator

        # Build the model from HuggingFace — downloads checkpoint automatically
        _sam2_model = build_sam2_hf(model_id=HF_MODEL_ID, device=DEVICE)

        # CPU-optimized mask generator settings
        # On CPU: conservative optimization for Render Standard plan (CPU, ~4GB RAM)
        #   - points_per_side=8 (64 grid points — stable; 9 caused ~44s & 502;
        #     10 caused ~49s & OOM)
        #   - MAX_IMAGE_DIM=384 on CPU (256px was too small for 8x8 grid, 0 masks)
        #   - MAX_IMAGE_DIM=256 on CPU (reduced from 512→384→256;
        #     image size has minimal impact on timing — grid points dominate)
        #   - points_per_batch=16 (smaller batches to limit peak memory)
        #   - crop_n_layers=0 (disable multi-crop, huge memory savings)
        # On GPU: use full settings for better quality
        if IS_CPU:
            _sam2_amg = SAM2AutomaticMaskGenerator(
                model=_sam2_model,
                points_per_side=POINTS_PER_SIDE,
                points_per_batch=16,
                pred_iou_thresh=PRED_IOU_THRESH,
                stability_score_thresh=STABILITY_SCORE_THRESH,
                crop_n_layers=0,
                crop_n_points_downscale_factor=2,
                min_mask_region_area=int(MAX_IMAGE_DIM * MAX_IMAGE_DIM * MIN_MASK_AREA_FRACTION),
            )
        else:
            _sam2_amg = SAM2AutomaticMaskGenerator(
                model=_sam2_model,
                points_per_side=POINTS_PER_SIDE,
                points_per_batch=64,
                pred_iou_thresh=PRED_IOU_THRESH,
                stability_score_thresh=STABILITY_SCORE_THRESH,
                min_mask_region_area=int(MAX_IMAGE_DIM * MAX_IMAGE_DIM * MIN_MASK_AREA_FRACTION),
            )

        _model_load_time = time.time() - t0
        logger.info(
            f"SAM 2 loaded successfully in {_model_load_time:.1f}s "
            f"(model_id={HF_MODEL_ID}, device={DEVICE}, "
            f"points_per_side={POINTS_PER_SIDE}, "
            f"max_image_dim={MAX_IMAGE_DIM}, "
            f"pred_iou_thresh={PRED_IOU_THRESH}, "
            f"stability_score_thresh={STABILITY_SCORE_THRESH}, "
            f"crop_n_layers={0 if IS_CPU else 1})"
        )

    except Exception as e:
        logger.error(f"Failed to load SAM 2 model: {e}")
        logger.error(traceback.format_exc())
        raise

    return _sam2_amg


# ---------------------------------------------------------------------------
# Image preprocessing
# ---------------------------------------------------------------------------

def resize_for_inference(image: np.ndarray, max_dim: int = MAX_IMAGE_DIM):
    """
    Resize image to fit within max_dim on its longest side.
    Returns the resized image and scale factor for coordinate mapping.
    """
    h, w = image.shape[:2]
    if max(h, w) <= max_dim:
        return image, 1.0

    scale = max_dim / max(h, w)
    new_w, new_h = int(w * scale), int(h * scale)
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
    logger.info(f"Resized image from {w}x{h} to {new_w}x{new_h} (scale={scale:.3f})")
    return resized, scale


# ---------------------------------------------------------------------------
# Mask-to-polygon conversion
# ---------------------------------------------------------------------------

def mask_to_polygon(mask_bin: np.ndarray, epsilon: float = DOUGLAS_PEUCKER_EPSILON):
    """
    Convert a binary mask to a simplified polygon using OpenCV
    contour finding + Douglas-Peucker simplification.
    """
    mask_uint8 = (mask_bin * 255).astype(np.uint8) if mask_bin.dtype != np.uint8 else mask_bin

    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return []

    best_contour = max(contours, key=cv2.contourArea)
    simplified = cv2.approxPolyDP(best_contour, epsilon, closed=True)

    if len(simplified) < MIN_POLYGON_POINTS:
        return []

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
    original_image_bgr: np.ndarray | None = None,
    mask_binary: np.ndarray | None = None,
    scale: float = 1.0,
) -> str:
    """
    Heuristic classification of a mask region based on position, size,
    geometry, and (when available) mask pixel content analysis.

    SAM 2 is class-agnostic — this provides geometry-based hints for
    downstream Pipeline B workers. The classification considers:

    1. Vertical position (sky at top, ground at bottom, roof in upper-middle)
    2. Shape aspect ratio (wide = roof, tall = wall, square = obstruction)
    3. Area fraction (large = sky/roof, tiny = obstruction/equipment)
    4. Green content analysis (high green = vegetation/tree, not roof)
    5. Texture complexity (trees have complex texture, roofs are smooth)

    Returns one of: roof, wall, sky, ground, tree, obstruction, equipment, unknown

    IMPORTANT: "tree" is a distinct class from "obstruction" because trees
    are the #1 source of false roof masks. Downstream consumers must filter
    out tree masks and not render them as roof geometry.
    """
    x, y, w, h = bbox
    norm_y_center = (y + h / 2) / img_h
    norm_x_center = (x + w / 2) / img_w
    norm_area = area / (img_w * img_h)
    aspect_ratio = max(w, h) / max(min(w, h), 1)

    # ── Vegetation detection ──
    # Trees are the #1 source of false roof masks. If the mask region
    # contains significant green pixels, classify it as "tree" regardless
    # of its position. This catches trees that appear in the upper half
    # of the image (which the old heuristic incorrectly labeled "roof").
    green_ratio = 0.0
    if mask_binary is not None and original_image_bgr is not None:
        green_ratio = _compute_green_ratio(mask_binary, original_image_bgr, scale)

    # High green content → definitely vegetation/tree, not roof
    if green_ratio > 0.35 and norm_area > 0.005:
        return "tree"

    # ── Sky detection (top of image, large area) ──
    if norm_y_center < 0.35 and norm_area > 0.04:
        return "sky"

    # ── Ground detection (bottom of image, moderate-to-large area) ──
    if norm_y_center > 0.7 and norm_area > 0.02:
        return "ground"

    # ── Tree detection by shape (tall, moderate area, not ground level) ──
    # Trees often have a distinctive vertical profile: narrower than roof,
    # moderate-to-large area, positioned in upper-middle of image.
    # Even without green detection (resized image may lose color fidelity),
    # tall narrow regions in the upper half that aren\'t clearly roof-shaped
    # are likely trees.
    if 0.15 < norm_y_center < 0.65 and norm_area > 0.02 and aspect_ratio < 1.3:
        # Narrow-ish tall region in upper-middle → likely tree, not roof
        if green_ratio > 0.15:
            return "tree"

    # ── Roof detection ──
    # Roofs are typically:
    # - In the upper-middle portion of the image (0.15–0.55 vertical)
    # - Wide (aspect ratio > 1.2, wider than tall)
    # - Moderate to large area (>3% of image)
    # - Low-to-moderate green content (<25% — raised from 15% to allow
    #   mossy/weathered roofs with algae that would previously fall to "unknown")
    # - High stability score (roofs are solid, not complex textures)
    if 0.1 < norm_y_center < 0.6 and norm_area > 0.02:
        if green_ratio < 0.25:
            # Wide region = likely roof plane
            if aspect_ratio > 1.3:
                return "roof"
            # Moderate aspect with high stability = probably roof
            if stability_score > 0.95 and aspect_ratio > 1.0:
                return "roof"
            # Large area in upper half with low green = roof candidate
            if norm_area > 0.05:
                return "roof"

    # ── Wall detection ──
    # Walls are tall, narrow, in the middle vertical range
    if 0.2 <= norm_y_center < 0.85 and h > w * 0.8 and green_ratio < 0.25:
        return "wall"

    # ── Equipment detection (small, upper portion) ──
    if 0.003 < norm_area < 0.03 and norm_y_center < 0.6 and green_ratio < 0.25:
        return "equipment"

    # ── Obstruction detection (very small regions) ──
    if norm_area < 0.01:
        return "obstruction"

    # ── Remaining ground ──
    if norm_y_center > 0.55 and norm_area > 0.01:
        return "ground"

    return "unknown"


def _compute_green_ratio(
    mask_binary: np.ndarray,
    original_image_bgr: np.ndarray,
    scale: float,
) -> float:
    """
    Compute the ratio of green-dominant pixels within the mask region
    of the ORIGINAL image.

    This detects vegetation (trees, grass, bushes) which is the primary
    source of false roof masks. A high green ratio means the mask region
    is likely vegetation, not a roof surface.

    Uses HSV color space for robust green detection that handles
    shadows and varying illumination.
    """
    try:
        if original_image_bgr is None or mask_binary is None:
            return 0.0

        orig_h, orig_w = original_image_bgr.shape[:2]

        # Scale mask back to original image coordinates
        if scale != 1.0:
            mask_full = cv2.resize(
                mask_binary.astype(np.uint8),
                (orig_w, orig_h),
                interpolation=cv2.INTER_NEAREST,
            )
        else:
            mask_full = mask_binary.astype(np.uint8)

        # Get masked pixels from original image
        masked_pixels = original_image_bgr[mask_full > 0]

        if len(masked_pixels) < 10:
            return 0.0

        # Convert to HSV for robust green detection
        hsv = cv2.cvtColor(masked_pixels.reshape(-1, 1, 3), cv2.COLOR_BGR2HSV)
        hsv = hsv.reshape(-1, 3)

        # Green in HSV: H roughly 35-85, S > 40, V > 40
        # This catches grass, tree leaves, bushes in various lighting
        h, s, v = hsv[:, 0], hsv[:, 1], hsv[:, 2]
        green_mask = (h >= 35) & (h <= 85) & (s > 40) & (v > 40)
        green_count = np.sum(green_mask)

        ratio = green_count / len(masked_pixels)
        return float(ratio)

    except Exception as e:
        logger.warning(f"Green ratio computation failed: {e}")
        return 0.0


# Classes that are relevant for roof geometry reconstruction.
# Masks with other class hints are filtered out to avoid rendering
# trees, sky, and ground as geometry overlays.
ROOF_RELEVANT_CLASSES = {"roof", "wall", "equipment", "obstruction"}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SAM 2 Segmentation Service",
    description="Roof geometry segmentation using Meta's SAM 2.1 model",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
        model_id=HF_MODEL_ID,
        cuda_available=_has_cuda(),
        uptime_seconds=time.time() - _start_time,
    )


@app.post("/segment", response_model=SegmentResponse)
async def segment_image(
    file: UploadFile = File(..., description="Survey photo (JPEG/PNG/WebP)"),
    min_area_fraction: float = Query(
        default=0.05,
        description="Minimum mask area as fraction of image area (raised from 0.02 to filter ground patches)",
        ge=0.001,
        le=0.5,
    ),
    max_masks: int = Query(
        default=20,
        description="Maximum number of masks to return",
        ge=1,
        le=100,
    ),
    roof_only: bool = Query(
        default=True,
        description="If true, only return roof-relevant masks (roof, wall, equipment, obstruction). Filters out sky, ground, tree, unknown.",
    ),
):
    """
    Segment a survey photo using SAM 2 Automatic Mask Generation.

    Returns an array of polygon-based masks with simplified polygon outlines,
    bounding boxes, stability scores, and heuristic class hints.
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

        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise HTTPException(status_code=400, detail="Could not decode image")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image read error: {str(e)}")

    orig_h, orig_w = image.shape[:2]

    # Resize for CPU inference to avoid OOM and speed up processing
    image_resized, scale = resize_for_inference(image)
    res_h, res_w = image_resized.shape[:2]

    min_area_px = res_w * res_h * min_area_fraction

    # Run SAM 2 Automatic Mask Generation
    try:
        image_rgb = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)
        mem_before = _get_memory_mb()
        logger.info(f"Starting SAM 2 inference on {res_w}x{res_h} image (CPU={IS_CPU}, RSS={mem_before:.0f}MB)")
        sam_masks = amg.generate(image_rgb)
        mem_after = _get_memory_mb()
        logger.info(f"SAM 2 inference produced {len(sam_masks)} raw masks (RSS={mem_after:.0f}MB, delta={mem_after-mem_before:.0f}MB)")

    except Exception as e:
        logger.error(f"SAM 2 inference failed: {e}")
        logger.error(traceback.format_exc())
        # Force garbage collection to free memory
        gc.collect()
        raise HTTPException(
            status_code=500,
            detail=f"SAM 2 inference error: {str(e)}",
        )

    # Process SAM 2 masks into polygon-based results
    result_masks: list[SegmentationMask] = []

    for idx, sam_mask in enumerate(sam_masks):
        mask_binary = sam_mask["segmentation"]
        bbox = sam_mask["bbox"]
        stability = sam_mask["stability_score"]
        predicted_iou = sam_mask["predicted_iou"]
        area_px = int(sam_mask.get("area", np.sum(mask_binary)))

        if area_px < min_area_px:
            continue

        polygon_points = mask_to_polygon(mask_binary.astype(np.uint8))

        if len(polygon_points) < MIN_POLYGON_POINTS:
            continue

        # Scale coordinates back to original image size
        if scale != 1.0:
            polygon_points = [
                {"x": p["x"] / scale, "y": p["y"] / scale}
                for p in polygon_points
            ]
            bbox = [v / scale for v in bbox]
            area_px = int(area_px / (scale * scale))

        class_hint = classify_mask_region(
            bbox=bbox,
            area=float(area_px),
            img_w=orig_w,
            img_h=orig_h,
            stability_score=stability,
            original_image_bgr=image,
            mask_binary=mask_binary,
            scale=scale,
        )

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

        # Free mask memory as we go
        del sam_mask

    # ── Roof-only filtering ──
    # When roof_only=True (default), only return masks whose class_hint is
    # relevant for roof geometry. This filters out sky, ground, tree, and
    # unknown masks that would appear as garbage overlays on the house.
    # The classification is heuristic-based and may misclassify some masks,
    # but this filter is essential to prevent tree/ground lines from
    # dominating the geometry overlay.
    pre_filter_count = len(result_masks)
    if roof_only:
        roof_masks = [m for m in result_masks if m.class_hint in ROOF_RELEVANT_CLASSES]
        filtered_out = [m for m in result_masks if m.class_hint not in ROOF_RELEVANT_CLASSES]
        if filtered_out:
            class_counts = {}
            for m in filtered_out:
                class_counts[m.class_hint] = class_counts.get(m.class_hint, 0) + 1
            logger.info(
                f"Roof-only filter: removed {len(filtered_out)} non-roof masks: {class_counts} "
                f"({pre_filter_count} → {len(roof_masks)} remaining)"
            )
        result_masks = roof_masks

    result_masks.sort(key=lambda m: m.area, reverse=True)
    result_masks = result_masks[:max_masks]

    processing_time = (time.time() - t0) * 1000

    logger.info(
        f"Segmented {orig_w}x{orig_h} image (processed at {res_w}x{res_h}): "
        f"{len(sam_masks)} raw masks → {pre_filter_count} classified → "
        f"{len(result_masks)} roof-only filtered masks "
        f"in {processing_time:.0f}ms"
    )

    # Free memory after processing
    del sam_masks
    del image_resized
    gc.collect()

    return SegmentResponse(
        success=True,
        masks=result_masks,
        mask_count=len(result_masks),
        image_width=orig_w,
        image_height=orig_h,
        processing_time_ms=round(processing_time, 1),
        model_info={
            "model_id": HF_MODEL_ID,
            "device": DEVICE,
            "cuda_available": _has_cuda(),
            "model_type": "sam2.1_automatic_mask_generation",
            "inference_resolution": f"{res_w}x{res_h}",
        },
    )


# ---------------------------------------------------------------------------
# Run server
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
