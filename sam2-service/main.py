"""
SAM 2 Segmentation + MiDaS Depth Service — FastAPI microservice for roof geometry extraction.

Runs SAM 2.1 Automatic Mask Generation and MiDaS/DPT monocular depth estimation
on survey photos, returning polygon-based segmentation masks and depth maps
suitable for Pipeline B consumption.

Architecture:
  - Loads SAM 2.1 checkpoint from HuggingFace on startup (model determined by
    SAM2_HF_MODEL_ID env var; defaults to sam2.1-hiera-tiny on CPU (~40MB),
    sam2.1-hiera-small on GPU (~184MB))
  - Loads MiDaS/DPT depth model from HuggingFace on startup (model determined by
    MIDAS_MODEL_ID env var; defaults to Intel/dpt-swinv2-tiny-256 on CPU (~41MB))
  - POST /segment: accepts image bytes, returns polygon masks
  - POST /depth: accepts image bytes, returns depth map grid
  - GET /health: service readiness check (reports both models)
  - Runs on GPU when available, falls back to CPU
  - Mask-to-polygon conversion via OpenCV findContours + Douglas-Peucker
  - Depth map produced as normalized float32 grid (base64-encoded)

Deployment:
  - Render web service (CPU or GPU)
  - Docker container with CPU-only PyTorch (GPU auto-detected at runtime)
  - Environment variable SAM2_HF_MODEL_ID controls segmentation model size
  - Environment variable MIDAS_MODEL_ID controls depth model size

CPU Optimization (Segmentation):
  - Images resized to max 384px (CPU) / 2048px (GPU) before processing
  - CPU: points_per_side=8 (64 grid points — stable on Render Standard 4GB RAM;
    9/81 grid caused ~44s processing & 502; 10/100 caused ~49s & OOM/crash)
  - At 384px, 8x8 grid produces ~13 raw masks with min_area_fraction=0.005;
    the previous default min_area_fraction=0.05 filtered ALL masks out (0 results)
  - GPU: points_per_side=32 with MAX_IMAGE_DIM=2048 (full quality)
  - Lower pred_iou_thresh (0.6) and stability_score_thresh (0.85) for challenging lighting
  - Smaller points_per_batch (16 vs default 64) to reduce peak memory
  - crop_n_layers=0 on CPU to avoid expensive multi-scale cropping
  - min_area_fraction defaults to SAM2_MIN_MASK_AREA_FRACTION env var (0.02),
    not hardcoded 0.05 — the old 0.05 default was the root cause of "0 masks"
  - Memory monitoring via resource.getrusage (RSS logged before/after inference)
  - Model loaded once, reused across requests
  - gc.collect() after inference to free memory immediately

CPU Optimization (Depth):
  - Images resized to max 256px (MiDaS native resolution) before depth inference
  - Intel/dpt-swinv2-tiny-256: 40.9M params, ~3-5s inference on CPU
  - Depth grid output resolution configurable via MIDAS_OUTPUT_RESOLUTION env var
  - Both models (SAM2 + MiDaS) coexist in ~4GB RAM: SAM2 tiny (~40MB) + DPT tiny (~41MB)
    leaves plenty of headroom on Render Standard (4GB)

Health Check Resilience:
  - SAM2 and MiDaS inference run in ThreadPoolExecutor threads, NOT on the
    async event loop. This keeps the event loop responsive for /health checks.
  - Render's platform health check has a 5-second timeout. Previously, SAM2
    CPU inference (35-40s) blocked the event loop, causing health check
    failures → server_failed events → instance restarts → 503/504 errors.
  - /health endpoint reports inference_active and inference_type so monitoring
    can distinguish "busy but healthy" from "actually broken".
  - Status "busy" means the service is healthy but processing a request.

REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
"""

import os
import time
import gc
import asyncio
import logging
import resource
import traceback
from concurrent.futures import ThreadPoolExecutor
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
MIN_MASK_AREA_FRACTION = float(os.environ.get("SAM2_MIN_MASK_AREA_FRACTION", "0.01"))
# Prediction confidence and stability thresholds — lower values catch weaker masks
PRED_IOU_THRESH = float(os.environ.get("SAM2_PRED_IOU_THRESH", "0.6"))
STABILITY_SCORE_THRESH = float(os.environ.get("SAM2_STABILITY_SCORE_THRESH", "0.85"))
# Grid density for AMG — fewer points = faster inference, fewer masks
# 8 points/side = 64 grid points (stable on Render CPU at 384px; ~37s processing;
#   produces ~13 raw masks with min_area_fraction=0.005, ~8 roof-relevant masks)
# 9 points/side = 81 grid points (~44s processing, causes 502 during inference)
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

# ---------------------------------------------------------------------------\
# MiDaS / DPT Depth Estimation Configuration
# ---------------------------------------------------------------------------

# HuggingFace model ID for MiDaS/DPT depth estimation
# Supported: Intel/dpt-swinv2-tiny-256 (40.9M params, ~3-5s CPU),
#            Intel/dpt-hybrid-midas (larger, better quality, ~10s CPU),
#            Intel/dpt-large (very large, GPU recommended)
# Set MIDAS_ENABLED=false to disable depth endpoint entirely
MIDAS_ENABLED = os.environ.get("MIDAS_ENABLED", "true").lower() == "true"
MIDAS_MODEL_ID = os.environ.get("MIDAS_MODEL_ID", "Intel/dpt-swinv2-tiny-256")
# Maximum image dimension for depth inference — MiDaS models are trained at 256x256
# or 384x384. On CPU, 256px is fast and sufficient for relative depth.
MIDAS_MAX_IMAGE_DIM = int(os.environ.get("MIDAS_MAX_IMAGE_DIM", "256"))
# Output depth grid resolution (width × height) — the depth map is resized to
# this resolution before encoding. Default 64 matches the heuristic depth worker.
MIDAS_OUTPUT_RESOLUTION = int(os.environ.get("MIDAS_OUTPUT_RESOLUTION", "64"))

# ---------------------------------------------------------------------------
# Inference Backend Configuration
# ---------------------------------------------------------------------------

# SAM2_INFERENCE_BACKEND: "pytorch" (default) or "onnx"
# When "onnx", the service uses ONNX Runtime for SAM2 inference instead of
# PyTorch. ONNX Runtime achieves 1.5-3x CPU speedup through graph fusion,
# operator fusion, and optimized memory planning. Falls back to PyTorch
# if ONNX models fail to load.
INFERENCE_BACKEND = os.environ.get("SAM2_INFERENCE_BACKEND", "pytorch").lower()
if INFERENCE_BACKEND not in ("pytorch", "onnx"):
    logger.warning(f"Invalid SAM2_INFERENCE_BACKEND={INFERENCE_BACKEND}, using pytorch")
    INFERENCE_BACKEND = "pytorch"

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
    depth_model_loaded: bool = False
    depth_model_id: str = ""
    inference_active: bool = False     # True while SAM2/MiDaS inference is in progress
    inference_type: str = ""           # "segment" or "depth" when active

class DepthResponse(BaseModel):
    """Response from the /depth endpoint."""
    success: bool
    depth_data: str  # base64-encoded float32 depth grid
    width: int       # grid width
    height: int      # grid height
    depth_metric: str = "normalized_relative"  # MiDaS produces relative inverse depth
    image_width: int  # original image width
    image_height: int # original image height
    processing_time_ms: float
    model_info: dict
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# SAM 2 model loader (lazy, loaded on first request or at startup)
# ---------------------------------------------------------------------------

_sam2_model = None
_sam2_amg = None
_model_load_time = None
_midas_model = None
_midas_load_time = None
_start_time = time.time()
_onnx_amg = None
_onnx_load_time = None
_onnx_available = False

# ---------------------------------------------------------------------------
# Inference thread pool — runs CPU-bound SAM2/MiDaS inference in threads
# so the FastAPI async event loop stays responsive for /health checks.
# Render's platform health check has a 5-second timeout; SAM2 inference
# takes 35-40s on CPU, which blocks the event loop and causes health
# check failures → server_failed events → instance restarts → 503/504.
# ---------------------------------------------------------------------------
_inference_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="inference")
_inference_active = False  # True while SAM2 or MiDaS inference is running
_inference_type = ""      # "segment" or "depth" — which endpoint is active
_last_inference_start = 0.0
_last_inference_end = 0.0


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
        #   - points_per_side=8 (64 grid points — stable at 384px; ~37s processing;
        #     produces ~13 raw masks, ~8 roof-relevant with min_area_fraction=0.01)
        #   - MAX_IMAGE_DIM=384 on CPU (256px was too small for 8x8 grid)
        #   - min_area_fraction=0.01 (lowered from 0.05 — old default filtered ALL masks)
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


def load_onnx_amg():
    """Load ONNX Runtime-based SAM2 AMG as an alternative to PyTorch.

    ONNX Runtime achieves 1.5-3x CPU speedup through graph fusion,
    operator fusion, and optimized memory planning. The ONNX models
    are downloaded from HuggingFace on first use.

    Returns the ONNXSAM2AutomaticMaskGenerator instance, or raises
    on failure. The caller should catch and fall back to PyTorch.
    """
    global _onnx_amg, _onnx_load_time, _onnx_available

    if _onnx_amg is not None:
        return _onnx_amg

    logger.info("Loading SAM2 ONNX Runtime backend...")
    t0 = time.time()

    try:
        from onnx_sam2_amg import ONNXSAM2AutomaticMaskGenerator

        _onnx_amg = ONNXSAM2AutomaticMaskGenerator(
            points_per_side=POINTS_PER_SIDE,
            points_per_batch=16 if IS_CPU else 64,
            pred_iou_thresh=PRED_IOU_THRESH,
            stability_score_thresh=STABILITY_SCORE_THRESH,
            crop_n_layers=0 if IS_CPU else 1,
            min_mask_region_area=int(MAX_IMAGE_DIM * MAX_IMAGE_DIM * MIN_MASK_AREA_FRACTION),
        )
        _onnx_load_time = time.time() - t0
        _onnx_available = True

        logger.info(
            f"ONNX SAM2 AMG loaded in {_onnx_load_time:.1f}s "
            f"(points_per_side={POINTS_PER_SIDE}, "
            f"max_image_dim={MAX_IMAGE_DIM})"
        )

    except Exception as e:
        _onnx_available = False
        logger.error(f"Failed to load ONNX SAM2 AMG: {e}")
        logger.error(traceback.format_exc())
        raise

    return _onnx_amg


def get_amg():
    """Get the active AMG instance based on the configured inference backend.

    Returns the ONNX AMG if SAM2_INFERENCE_BACKEND=onnx and ONNX loaded,
    otherwise falls back to PyTorch AMG.
    """
    if INFERENCE_BACKEND == "onnx":
        try:
            onnx = load_onnx_amg()
            if onnx is not None:
                return onnx, "onnx"
        except Exception:
            logger.warning("ONNX AMG failed, falling back to PyTorch")

    # PyTorch fallback (or default)
    pytorch_amg = load_sam2_model()
    return pytorch_amg, "pytorch"


def load_midas_model():
    """Load MiDaS/DPT depth estimation model from HuggingFace.

    Uses the transformers pipeline API for simple, reliable loading.
    The model is lazy-loaded on first /depth request if MIDAS_ENABLED=true.
    Returns the pipeline object, or None if MiDaS is disabled.
    """
    global _midas_model, _midas_load_time

    if not MIDAS_ENABLED:
        logger.info("MiDaS depth estimation disabled (MIDAS_ENABLED=false)")
        return None

    if _midas_model is not None:
        return _midas_model

    logger.info(f"Loading MiDaS depth model: {MIDAS_MODEL_ID} on device: {DEVICE}")
    t0 = time.time()

    try:
        from transformers import pipeline as hf_pipeline

        # Use HuggingFace depth-estimation pipeline
        # device=-1 means CPU, device=0 means GPU
        device_arg = -1 if IS_CPU else 0
        _midas_model = hf_pipeline(
            task="depth-estimation",
            model=MIDAS_MODEL_ID,
            device=device_arg,
        )
        _midas_load_time = time.time() - t0
        logger.info(
            f"MiDaS loaded successfully in {_midas_load_time:.1f}s "
            f"(model_id={MIDAS_MODEL_ID}, device={DEVICE}, "
            f"max_image_dim={MIDAS_MAX_IMAGE_DIM}, "
            f"output_resolution={MIDAS_OUTPUT_RESOLUTION})"
        )

    except Exception as e:
        logger.error(f"Failed to load MiDaS depth model: {e}")
        logger.error(traceback.format_exc())
        # Don't raise — depth is optional. Service still serves /segment.
        _midas_model = None
        return None

    return _midas_model


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


def np_to_base64(arr: np.ndarray) -> str:
    """
    Encode a numpy array as base64 string for transport.

    The array is stored as raw bytes (dtype preserved) and base64-encoded.
    The receiver must decode base64 → bytes → np.frombuffer with the same dtype.
    """
    import base64
    return base64.b64encode(arr.tobytes()).decode("ascii")


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
    """Load SAM 2 and MiDaS models on startup so first requests are fast."""
    logger.info(f"SAM 2 + MiDaS service starting (backend={INFERENCE_BACKEND})...")
    try:
        if INFERENCE_BACKEND == "onnx":
            try:
                load_onnx_amg()
                logger.info("SAM 2 ONNX backend loaded successfully")
            except Exception as e:
                logger.warning(f"ONNX backend failed on startup: {e}")
                logger.warning("Falling back to PyTorch backend")
                load_sam2_model()
        else:
            load_sam2_model()
            logger.info("SAM 2 PyTorch model loaded successfully")
    except Exception as e:
        logger.warning(f"SAM 2 model load failed on startup: {e}")
        logger.warning("Service will attempt lazy load on first /segment request")

    try:
        load_midas_model()
        if _midas_model is not None:
            logger.info("MiDaS depth model loaded successfully — /depth endpoint ready")
        else:
            logger.info("MiDaS depth model not loaded — /depth endpoint unavailable")
    except Exception as e:
        logger.warning(f"MiDaS model load failed on startup: {e}")
        logger.warning("/depth endpoint will return 503 until model loads")


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check service health and model readiness.

    IMPORTANT: This endpoint MUST respond instantly (non-blocking) because
    Render's platform health check has a 5-second timeout. If SAM2 or MiDaS
    inference is running (which takes 35-40s on CPU), we still respond
    immediately with inference_active=True. This prevents Render from
    marking the instance as unhealthy during long-running inference.
    """
    sam2_ready = _sam2_amg is not None or _onnx_amg is not None
    midas_ready = _midas_model is not None if MIDAS_ENABLED else False

    # Service is "ready" if SAM2 is loaded (primary function)
    # Depth is optional — service is still "ready" without it
    # Even during inference, the service is "ready" — it's just busy
    active_backend = "onnx" if _onnx_amg is not None else ("pytorch" if _sam2_amg is not None else "none")
    status = "ready" if sam2_ready else "loading"
    if sam2_ready and MIDAS_ENABLED and not midas_ready:
        status = "ready_depth_loading"
    if _inference_active:
        status = "busy"  # healthy but busy — Render should not restart

    return HealthResponse(
        status=status,
        model_loaded=sam2_ready,
        device=DEVICE,
        model_id=HF_MODEL_ID,
        cuda_available=_has_cuda(),
        uptime_seconds=time.time() - _start_time,
        depth_model_loaded=midas_ready,
        depth_model_id=MIDAS_MODEL_ID if MIDAS_ENABLED else "",
        inference_active=_inference_active,
        inference_type=_inference_type if _inference_active else "",
    )


@app.post("/segment", response_model=SegmentResponse)
async def segment_image(
    file: UploadFile = File(..., description="Survey photo (JPEG/PNG/WebP)"),
    min_area_fraction: float = Query(
        default=MIN_MASK_AREA_FRACTION,
        description="Minimum mask area as fraction of image area (default from SAM2_MIN_MASK_AREA_FRACTION env var)",
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
    # Uses get_amg() which respects SAM2_INFERENCE_BACKEND setting
    try:
        amg, backend = get_amg()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"SAM 2 model not available (backend={INFERENCE_BACKEND}): {str(e)}",
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

    # Run SAM 2 Automatic Mask Generation in a thread so the event loop
    # stays responsive for /health checks. SAM2 CPU inference takes 35-40s
    # which would block the async event loop and cause Render health check
    # failures (5s timeout) → server_failed → instance restart → 503/504.
    try:
        image_rgb = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)
        mem_before = _get_memory_mb()
        logger.info(f"Starting SAM 2 inference on {res_w}x{res_h} image (CPU={IS_CPU}, RSS={mem_before:.0f}MB)")

        # Track inference state for /health reporting
        global _inference_active, _inference_type, _last_inference_start, _last_inference_end
        _inference_active = True
        _inference_type = "segment"
        _last_inference_start = time.time()

        loop = asyncio.get_event_loop()
        sam_masks = await loop.run_in_executor(
            _inference_executor,
            amg.generate,
            image_rgb,
        )

        _inference_active = False
        _inference_type = ""
        _last_inference_end = time.time()

        mem_after = _get_memory_mb()
        logger.info(f"SAM 2 inference produced {len(sam_masks)} raw masks (RSS={mem_after:.0f}MB, delta={mem_after-mem_before:.0f}MB)")

    except Exception as e:
        _inference_active = False
        _inference_type = ""
        _last_inference_end = time.time()
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
        f"in {processing_time:.0f}ms [backend={backend}]"
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
            "inference_backend": backend,
            "inference_resolution": f"{res_w}x{res_h}",
        },
    )


# ---------------------------------------------------------------------------
# Depth estimation endpoint
# ---------------------------------------------------------------------------

@app.post("/depth", response_model=DepthResponse)
async def estimate_depth(
    file: UploadFile = File(..., description="Survey photo (JPEG/PNG/WebP)"),
    output_resolution: int = Query(
        default=MIDAS_OUTPUT_RESOLUTION,
        description="Depth grid output resolution (width × height). Default from MIDAS_OUTPUT_RESOLUTION env var.",
        ge=16,
        le=512,
    ),
):
    """
    Estimate monocular depth from a survey photo using MiDaS/DPT.

    Returns a normalized relative depth map as a base64-encoded float32 grid.
    MiDaS produces inverse relative depth: higher values = closer to camera,
    lower values = farther from camera. The depth is NOT metric (not in meters)
    but relative — sufficient for depth ordering and plane separation.

    The output grid resolution is configurable (default 64×64) to match
    Pipeline B's DepthMap artifact format.
    """
    t0 = time.time()

    # Load MiDaS model if not already loaded
    if not MIDAS_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="MiDaS depth estimation is disabled (MIDAS_ENABLED=false)",
        )

    try:
        midas_pipe = load_midas_model()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"MiDaS depth model not available: {str(e)}",
        )

    if midas_pipe is None:
        raise HTTPException(
            status_code=503,
            detail="MiDaS depth model failed to load — /depth endpoint unavailable",
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

    # Resize for depth inference — MiDaS works best at its training resolution
    image_resized, scale = resize_for_inference(image, max_dim=MIDAS_MAX_IMAGE_DIM)
    res_h, res_w = image_resized.shape[:2]

    # Run MiDaS depth estimation in a thread so the event loop stays
    # responsive for /health checks. MiDaS CPU inference takes ~3-5s which
    # could still block long enough to miss a health check window.
    try:
        from PIL import Image as PILImage

        # HuggingFace pipeline expects PIL image
        image_rgb = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)
        pil_image = PILImage.fromarray(image_rgb)

        mem_before = _get_memory_mb()
        logger.info(f"Starting MiDaS depth inference on {res_w}x{res_h} image (CPU={IS_CPU}, RSS={mem_before:.0f}MB)")

        # Track inference state for /health reporting
        global _inference_active, _inference_type, _last_inference_start, _last_inference_end
        _inference_active = True
        _inference_type = "depth"
        _last_inference_start = time.time()

        # Run MiDaS pipeline in thread pool
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _inference_executor,
            midas_pipe,
            pil_image,
        )

        _inference_active = False
        _inference_type = ""
        _last_inference_end = time.time()

        # Extract raw depth prediction (tensor)
        depth_tensor = result["predicted_depth"]
        depth_np = depth_tensor.cpu().numpy()

        mem_after = _get_memory_mb()
        logger.info(
            f"MiDaS inference produced depth map {depth_np.shape[1]}x{depth_np.shape[0]} "
            f"(RSS={mem_after:.0f}MB, delta={mem_after - mem_before:.0f}MB)"
        )

    except Exception as e:
        _inference_active = False
        _inference_type = ""
        _last_inference_end = time.time()
        logger.error(f"MiDaS depth inference failed: {e}")
        logger.error(traceback.format_exc())
        gc.collect()
        raise HTTPException(
            status_code=500,
            detail=f"MiDaS depth inference error: {str(e)}",
        )

    # Post-process depth map:
    # 1. Normalize to [0, 1] range (relative depth, no metric meaning)
    # 2. Invert so higher = closer (MiDaS outputs inverse depth by default,
    #    but we normalize to make the convention explicit)
    # 3. Resize to requested output resolution
    # 4. Encode as float32 base64
    try:
        # Normalize to [0, 1]
        depth_min = depth_np.min()
        depth_max = depth_np.max()
        if depth_max - depth_min > 1e-6:
            depth_normalized = (depth_np - depth_min) / (depth_max - depth_min)
        else:
            depth_normalized = np.zeros_like(depth_np)

        # Resize to output resolution
        # depth_normalized shape: (H, W) — float64 values in [0, 1]
        if depth_normalized.shape[0] != output_resolution or depth_normalized.shape[1] != output_resolution:
            depth_resized = cv2.resize(
                depth_normalized,
                (output_resolution, output_resolution),
                interpolation=cv2.INTER_LINEAR,
            )
        else:
            depth_resized = depth_normalized

        # Encode as float32 → base64
        depth_f32 = depth_resized.astype(np.float32)
        depth_base64 = np_to_base64(depth_f32)

    except Exception as e:
        logger.error(f"Depth post-processing failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Depth post-processing error: {str(e)}",
        )

    # Free memory
    del depth_np, depth_resized, image_resized, pil_image
    if 'depth_normalized' in dir():
        del depth_normalized
    gc.collect()

    processing_time = (time.time() - t0) * 1000

    logger.info(
        f"Depth estimation: {orig_w}x{orig_h} image (processed at {res_w}x{res_h}), "
        f"output {output_resolution}x{output_resolution} grid, "
        f"in {processing_time:.0f}ms"
    )

    return DepthResponse(
        success=True,
        depth_data=depth_base64,
        width=output_resolution,
        height=output_resolution,
        depth_metric="normalized_relative",
        image_width=orig_w,
        image_height=orig_h,
        processing_time_ms=round(processing_time, 1),
        model_info={
            "model_id": MIDAS_MODEL_ID,
            "device": DEVICE,
            "cuda_available": _has_cuda(),
            "model_type": "midas_dpt_depth_estimation",
            "inference_resolution": f"{res_w}x{res_h}",
            "output_resolution": f"{output_resolution}x{output_resolution}",
        },
    )


# ---------------------------------------------------------------------------
# Run server
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
