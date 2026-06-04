"""
SAM 2 Segmentation + MiDaS Depth Service — FastAPI microservice for roof geometry extraction.

Runs SAM 2.1 Automatic Mask Generation and MiDaS/DPT monocular depth estimation
on survey photos, returning polygon-based segmentation masks and depth maps
suitable for Pipeline B consumption.

Architecture:
  - Loads SAM 2.1 checkpoint from HuggingFace on startup (model determined by
    SAM2_HF_MODEL_ID env var; defaults to sam2.1-hiera-tiny on CPU, sam2.1-hiera-small on GPU)
  - Uses ONNX Runtime by default for faster inference (SAM2_INFERENCE_BACKEND=onnx)
  - ONNX tiny model encoder: 28.4MB quantized (from 104.4MB FP32), ~1.4x faster than small
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
  - Images resized to max 512px (CPU) / 2048px (GPU) before processing
  - CPU: points_per_side=10 (100 grid points) with ONNX tiny+quantized model on Render Standard 4GB RAM, 512px
  - ONNX tiny+INT8 encoder (28.4MB quantized from 104.4MB) + decoder (15.8MB) fit comfortably in 4GB with MiDaS
  - INT8 dynamic quantization: ~16% faster inference, ~4x smaller encoder, cosine similarity > 0.985 vs FP32
  - Quantization applied at startup (~4s one-time cost), quantized model cached for reuse
  - min_area_fraction=0.005 allows small roof features (dormers, sheds) through
  - GPU: points_per_side=32 with MAX_IMAGE_DIM=2048 (full quality)
  - Lower pred_iou_thresh (0.5) and stability_score_thresh (0.8) for challenging lighting
  - Rapid-loop decode: pre-computed prompts + in-place feed dict updates = ~0.05-0.1s per point
  - crop_n_layers=0 on CPU to avoid expensive multi-scale cropping
  - min_area_fraction defaults to SAM2_MIN_MASK_AREA_FRACTION env var (0.003),
    not hardcoded 0.05 — the old 0.05 default was the root cause of "0 masks"
  - Memory monitoring via resource.getrusage (RSS logged before/after inference)
  - Model loaded once, reused across requests
  - gc.collect() after inference to free memory immediately

CPU Optimization (Depth):
  - Images resized to max 256px (MiDaS native resolution) before depth inference
  - Intel/dpt-swinv2-tiny-256: 40.9M params, ~3-5s inference on CPU
  - Depth grid output resolution configurable via MIDAS_OUTPUT_RESOLUTION env var
  - Both models (SAM2 + MiDaS) coexist in ~4GB RAM: SAM2 tiny+INT8 ONNX (~28MB quantized encoder + ~16MB decoder)
    + DPT tiny (~41MB) leaves plenty of headroom on Render Standard (4GB)

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
HF_MODEL_ID = os.environ.get("SAM2_HF_MODEL_ID", "facebook/sam2.1-hiera-tiny")
# Maximum image dimension for processing — larger images are resized
# 512px on CPU: 10x10 grid detects roofs and small features at this resolution without OOM
# 384px on CPU: 8x8 grid can detect roofs at this resolution without OOM
# 256px on CPU: too small, 8x8 grid misses roofs entirely (0 masks)
MAX_IMAGE_DIM = int(os.environ.get("SAM2_MAX_IMAGE_DIM", "512" if IS_CPU else "2048"))
# Minimum mask area as fraction of image — filters noise masks
MIN_MASK_AREA_FRACTION = float(os.environ.get("SAM2_MIN_MASK_AREA_FRACTION", "0.003"))
# Prediction confidence and stability thresholds — lower values catch weaker masks
PRED_IOU_THRESH = float(os.environ.get("SAM2_PRED_IOU_THRESH", "0.5"))
STABILITY_SCORE_THRESH = float(os.environ.get("SAM2_STABILITY_SCORE_THRESH", "0.80"))
# Grid density for AMG — fewer points = faster inference, fewer masks
# Grid density for SAM2 Automatic Mask Generation.
# Higher = more masks (better small-object detection) but slower + more memory.
#   8 points/side = 64 grid points (stable on 2GB RAM; ~4.5s decoder with rapid-loop; ~8-10 roof masks)
#   9 points/side = 81 grid points (stable on 2GB RAM; ~5.5s decoder with rapid-loop)
#  10 points/side = 100 grid points (~7s decoder with rapid-loop; OK on 4GB Standard with ONNX + 512px)
#  12 points/side = 144 grid points (~10s decoder with rapid-loop; OK on 4GB Pro with ONNX + 512px)
#  16 points/side = 256 grid points (~13s decoder with rapid-loop; best small-object detection)
# NOTE: 10 points/side at 512px produces detailed roof masks because SAM2's encoder
# captures sufficient detail at this resolution. The denser grid catches dormers, vents,
# and small roof plane intersections that 8pts/384px missed.
# Encoder dominates total time: tiny+INT8 ~17s + decoder ~7s = ~24s/photo (measured on Render).
# CHANGED from 8→10: With rapid-loop decode + tiny+INT8 encoder, 100 points
# take ~24s/photo. Worker runs on Render (no Vercel timeout), so this is acceptable.
POINTS_PER_SIDE = int(os.environ.get("SAM2_POINTS_PER_SIDE", "10" if IS_CPU else "32"))
# Maximum masks to return per image
MAX_MASKS = int(os.environ.get("SAM2_MAX_MASKS", "30"))
# Douglas-Peucker simplification epsilon (pixels)
# Lower = more polygon detail, higher = coarser polygons.
# At 512px image dim, epsilon=0.7 preserves ~4x more boundary detail than 5.0.
DOUGLAS_PEUCKER_EPSILON = float(os.environ.get("SAM2_DOUGLAS_PEUCKER_EPSILON", "0.5"))
# Minimum polygon points after simplification
MIN_POLYGON_POINTS = 3
# Service port — Render injects PORT=10000 for web services
PORT = int(os.environ.get("PORT", "10000"))

# ---------------------------------------------------------------------------
# Classifier Configuration (heuristic class hints for SAM2 masks)
# ---------------------------------------------------------------------------

# Green ratio threshold: above this → definitely vegetation/tree
CLASSIFIER_GREEN_RATIO_TREE = float(os.environ.get("SAM2_CLASSIFIER_GREEN_RATIO_TREE", "0.35"))
# Green ratio threshold for tree-by-shape: moderate green in upper-middle → tree
CLASSIFIER_GREEN_RATIO_TREE_MODERATE = float(os.environ.get("SAM2_CLASSIFIER_GREEN_RATIO_TREE_MODERATE", "0.15"))
# Green ratio ceiling for roof: above this → NOT roof (even if shape/position match)
CLASSIFIER_GREEN_RATIO_ROOF_MAX = float(os.environ.get("SAM2_CLASSIFIER_GREEN_RATIO_ROOF_MAX", "0.25"))
# Sky detection: norm_y_center below this threshold → sky (if area > 4%)
CLASSIFIER_SKY_Y_MAX = float(os.environ.get("SAM2_CLASSIFIER_SKY_Y_MAX", "0.35"))
# Ground detection: norm_y_center above this threshold → ground
CLASSIFIER_GROUND_Y_MIN = float(os.environ.get("SAM2_CLASSIFIER_GROUND_Y_MIN", "0.7"))
# Texture score thresholds: Laplacian std dev for surface classification
CLASSIFIER_TEXTURE_ROOF_MAX = float(os.environ.get("SAM2_CLASSIFIER_TEXTURE_ROOF_MAX", "15"))
CLASSIFIER_TEXTURE_TREE_MIN = float(os.environ.get("SAM2_CLASSIFIER_TEXTURE_TREE_MIN", "20"))
# Brightness thresholds for surface type detection
CLASSIFIER_BRIGHTNESS_SKY_V_MIN = float(os.environ.get("SAM2_CLASSIFIER_BRIGHTNESS_SKY_V_MIN", "200"))
CLASSIFIER_BRIGHTNESS_SKY_STD_V_MAX = float(os.environ.get("SAM2_CLASSIFIER_BRIGHTNESS_SKY_STD_V_MAX", "12"))
CLASSIFIER_BRIGHTNESS_GRAY_S_MAX = float(os.environ.get("SAM2_CLASSIFIER_BRIGHTNESS_GRAY_S_MAX", "30"))
CLASSIFIER_BRIGHTNESS_DARK_V_MAX = float(os.environ.get("SAM2_CLASSIFIER_BRIGHTNESS_DARK_V_MAX", "100"))
CLASSIFIER_BRIGHTNESS_BLACK_TPO_V_MAX = float(os.environ.get("SAM2_CLASSIFIER_BRIGHTNESS_BLACK_TPO_V_MAX", "140"))
CLASSIFIER_BRIGHTNESS_BLACK_TPO_S_MAX = float(os.environ.get("SAM2_CLASSIFIER_BRIGHTNESS_BLACK_TPO_S_MAX", "25"))

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
# Batch size for ONNX decoder — number of point prompts to process per decoder call.
# Higher = fewer Python→ONNX bridge calls (faster), but more memory per batch.
# IMPORTANT: On Render Standard (2GB RAM), batch_size=16 causes OOM crashes because
# tiling encoder features (32×256×256 per point) uses ~200MB per point + ONNX overhead.
# batch_size=4 is memory-safe on 2GB (~50MB per batch) while still being 4x faster
# than single-point decoding (16 calls → 4 calls for 64 points).
POINTS_PER_BATCH = int(os.environ.get("SAM2_POINTS_PER_BATCH", "4" if IS_CPU else "64"))

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

class FilteredMaskMeta(BaseModel):
    """Metadata for a mask that was filtered out by roof_only or max_masks.
    Provides diagnostic visibility into what the service removed, without
    including polygon geometry that could be misused as structure data.
    """
    mask_index: int
    class_hint: str
    area: float
    bbox: list[float]  # [x, y, width, height] — coarse position only
    confidence: float
    stability_score: float
    filter_reason: str  # "roof_only" or "max_masks"

class TimingBreakdown(BaseModel):
    """Per-stage timing breakdown for the /segment pipeline (milliseconds)."""
    image_decode_ms: float = 0
    image_resize_ms: float = 0
    encoder_ms: float = 0
    decoder_ms: float = 0
    classify_ms: float = 0
    polygon_ms: float = 0
    filter_ms: float = 0
    total_ms: float = 0

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
    # --- Instrumentation fields (Pass 1 tuning) ---
    timing_breakdown: Optional[TimingBreakdown] = None
    filtered_masks_metadata: Optional[list[FilteredMaskMeta]] = None
    filter_impact: Optional[dict] = None  # counts per filter stage

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
    inference_backend: str = "pytorch" # "onnx" or "pytorch"

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


class PromptPoint(BaseModel):
    """A single click point for prompted segmentation."""
    x: float  # x coordinate in original image pixel space
    y: float  # y coordinate in original image pixel space
    label: int = 1  # 1 = foreground (include), 0 = background (exclude)

class PromptedSegmentRequest(BaseModel):
    """Request body for prompted segmentation."""
    points: list[PromptPoint]  # Click points guiding the segmentation

class PromptedSegmentResponse(BaseModel):
    """Response from the /segment-prompted endpoint."""
    success: bool
    masks: list[SegmentationMask]
    mask_count: int
    image_width: int
    image_height: int
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
_starting_up = True  # Set to False once startup_event completes — prevents false "ready" during model load

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


def _get_available_memory_mb() -> float:
    """Get available system memory in MB from /proc/meminfo (Linux only).

    This is critical for avoiding OOM on Render Standard (2GB limit).
    Returns available memory, not free — available includes reclaimable caches.
    Falls back to a conservative 512MB estimate if /proc/meminfo is unavailable.
    """
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / 1024  # kB -> MB
    except Exception:
        pass
    return 512.0  # conservative default


def _check_memory_guard(min_free_mb: float = 256.0) -> tuple[bool, float]:
    """Check if there's enough memory for inference.

    Returns (ok, available_mb). If available < min_free_mb, the caller
    should reject the request to avoid OOM kill on Render's 2GB limit.
    """
    avail = _get_available_memory_mb()
    return avail >= min_free_mb, avail


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
        #   - points_per_side=10 (100 grid points — stable at 512px; ~7s with rapid-loop;
        #     catches dormers/vents that 8pts/384px missed)
        #   - MAX_IMAGE_DIM=512 on CPU (384px was too coarse for fine roof boundaries)
        #   - min_area_fraction=0.005 (lowered from 0.05 — old default filtered ALL masks)
        #   - points_per_batch=4 (controls outer loop batch size with rapid-loop decode)
        #   - crop_n_layers=0 (disable multi-crop, huge memory savings)
        # On GPU: use full settings for better quality
        if IS_CPU:
            _sam2_amg = SAM2AutomaticMaskGenerator(
                model=_sam2_model,
                points_per_side=POINTS_PER_SIDE,
                points_per_batch=POINTS_PER_BATCH,
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
    are downloaded from HuggingFace on first use. When enabled (default),
    INT8 dynamic quantization is applied to the encoder at startup for
    additional ~16% speedup and ~4x model size reduction.

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
            points_per_batch=POINTS_PER_BATCH,
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

# Maximum edge length in pixels after simplification — edges longer than this
# will be subdivided to preserve boundary detail for line extraction.
# Without this, Douglas-Peucker collapses long roof edges into single straight
# segments (200+ pixels), which produces "sloppy lines" in downstream extraction.
MAX_POLYGON_EDGE_LENGTH = int(os.environ.get("SAM2_MAX_POLYGON_EDGE_LENGTH", "25"))


def _subdivide_long_edges(points: list[dict], max_length: float) -> list[dict]:
    """
    Subdivide polygon edges longer than max_length by inserting intermediate
    points. This prevents Douglas-Peucker from collapsing long roof/wall edges
    into single straight segments that lose boundary curvature detail.

    For each edge (p1 → p2) longer than max_length, we insert points at equal
    intervals along the edge. The number of subdivisions = ceil(length / max_length) - 1.
    """
    if max_length <= 0 or len(points) < 2:
        return points

    result: list[dict] = []
    n = len(points)

    for i in range(n):
        p1 = points[i]
        p2 = points[(i + 1) % n]
        result.append(p1)

        dx = p2["x"] - p1["x"]
        dy = p2["y"] - p1["y"]
        length = (dx * dx + dy * dy) ** 0.5

        if length > max_length:
            num_segments = max(2, int(length / max_length + 0.5))
            for j in range(1, num_segments):
                t = j / num_segments
                result.append({
                    "x": p1["x"] + dx * t,
                    "y": p1["y"] + dy * t,
                })

    return result


def mask_to_polygon(mask_bin: np.ndarray, epsilon: float = DOUGLAS_PEUCKER_EPSILON):
    """
    Convert a binary mask to a simplified polygon using OpenCV
    contour finding + Douglas-Peucker simplification + edge subdivision.

    Pipeline:
      1. findContours with CHAIN_APPROX_NONE (preserve ALL contour points)
      2. approxPolyDP with epsilon (simplify — but may collapse long edges)
      3. Subdivide edges longer than MAX_POLYGON_EDGE_LENGTH (recover detail)

    Previously used CHAIN_APPROX_SIMPLE which removed intermediate points on
    straight/diagonal segments BEFORE simplification, compounding point loss
    and producing overly coarse polygons with 200+ pixel single-segment edges.
    """
    mask_uint8 = (mask_bin * 255).astype(np.uint8) if mask_bin.dtype != np.uint8 else mask_bin

    # CHAIN_APPROX_NONE preserves all contour points — essential for
    # high-fidelity polygon boundaries that produce accurate structural lines.
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)

    if not contours:
        return []

    best_contour = max(contours, key=cv2.contourArea)
    simplified = cv2.approxPolyDP(best_contour, epsilon, closed=True)

    if len(simplified) < MIN_POLYGON_POINTS:
        return []

    points = []
    for pt in simplified:
        points.append({"x": float(pt[0][0]), "y": float(pt[0][1])})

    # Subdivide long edges to preserve boundary detail for line extraction
    points = _subdivide_long_edges(points, MAX_POLYGON_EDGE_LENGTH)

    return points


def _segments_intersect(
    p1: dict, p2: dict, p3: dict, p4: dict
) -> bool:
    """
    Check if line segment (p1→p2) intersects with segment (p3→p4),
    excluding shared endpoints.
    Used for self-intersection detection in polygons.
    """
    def cross(o, a, b):
        return (a["x"] - o["x"]) * (b["y"] - o["y"]) - (a["y"] - o["y"]) * (b["x"] - o["x"])

    d1 = cross(p3, p4, p1)
    d2 = cross(p3, p4, p2)
    d3 = cross(p1, p2, p3)
    d4 = cross(p1, p2, p4)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True

    return False


def _polygon_is_simple(points: list[dict]) -> bool:
    """
    Check if a polygon is simple (non-self-intersecting).
    Tests all pairs of non-adjacent edges for intersection.
    Returns True if the polygon has no self-intersections.
    """
    n = len(points)
    if n < 4:
        return True  # Triangle or less cannot self-intersect

    for i in range(n):
        for j in range(i + 2, n):
            # Skip adjacent edges (they share a vertex)
            if i == 0 and j == n - 1:
                continue
            if _segments_intersect(points[i], points[(i + 1) % n],
                                   points[j], points[(j + 1) % n]):
                return False
    return True


def _refine_polygon_with_contour(
    simplified_points: list[dict],
    original_contour: np.ndarray,
    snap_tolerance: float = 5.0,
    min_corner_spacing: float = 8.0,
) -> list[dict]:
    """
    Refine a simplified polygon by snapping its vertices to nearby
    high-curvature points on the original contour.

    Douglas-Peucker simplification often misses subtle corners where a roof
    plane meets a wall or where a valley creates a bend. By snapping each
    simplified vertex to the nearest high-curvature contour point, we recover
    these critical geometry points without adding excessive detail.

    SAFEGUARDS (Pass 3C fix):
    - snap_tolerance raised from 3.0 to 5.0 to avoid snapping to pixel-noise corners
    - min_corner_spacing enforced: corners closer than 8px are merged to prevent
      dense clusters of pixel-level "corners" from jagged contours
    - Self-intersection validation: if snapping creates a self-intersecting polygon,
      the refinement is REJECTED and the original simplified polygon is returned instead.
      This prevents surreal rendering artifacts from malformed polygons.

    High-curvature points are identified by computing the angle change at each
    contour vertex (angle between incoming and outgoing edge vectors).
    Points with angle change > 30° are considered corners.
    """
    if len(original_contour) < 10 or len(simplified_points) < 3:
        return simplified_points

    # Compute curvature at each contour point
    contour_pts = original_contour.reshape(-1, 2).astype(float)
    n = len(contour_pts)
    if n < 5:
        return simplified_points

    # Find all candidate corner indices (angle < 150° = curvature > 30°)
    raw_corner_indices = []
    for i in range(n):
        p_prev = contour_pts[(i - 2) % n]
        p_curr = contour_pts[i]
        p_next = contour_pts[(i + 2) % n]

        v1 = p_curr - p_prev
        v2 = p_next - p_curr
        len1 = np.sqrt(v1[0]**2 + v1[1]**2)
        len2 = np.sqrt(v2[0]**2 + v2[1]**2)

        if len1 < 0.001 or len2 < 0.001:
            continue

        cos_angle = (v1[0]*v2[0] + v1[1]*v2[1]) / (len1 * len2)
        cos_angle = np.clip(cos_angle, -1.0, 1.0)
        angle_deg = np.degrees(np.arccos(cos_angle))

        # Angle < 150° means curvature > 30° — this is a corner
        if angle_deg < 150:
            raw_corner_indices.append(i)

    if not raw_corner_indices:
        return simplified_points

    # Enforce minimum corner spacing: merge corners closer than min_corner_spacing
    # This prevents dense clusters of pixel-level "corners" from jagged contours
    # from producing spurious snap targets. Keep the sharpest corner in each cluster.
    corner_angles = []
    for idx in raw_corner_indices:
        p_prev = contour_pts[(idx - 2) % n]
        p_curr = contour_pts[idx]
        p_next = contour_pts[(idx + 2) % n]
        v1 = p_curr - p_prev
        v2 = p_next - p_curr
        len1 = np.sqrt(v1[0]**2 + v1[1]**2)
        len2 = np.sqrt(v2[0]**2 + v2[1]**2)
        if len1 < 0.001 or len2 < 0.001:
            corner_angles.append(180.0)
        else:
            cos_a = np.clip((v1[0]*v2[0] + v1[1]*v2[1]) / (len1 * len2), -1.0, 1.0)
            corner_angles.append(np.degrees(np.arccos(cos_a)))

    filtered_indices = []
    for k, idx in enumerate(raw_corner_indices):
        pt = contour_pts[idx]
        # Check distance to all already-accepted corners
        too_close = False
        for accepted_idx in filtered_indices:
            accepted_pt = contour_pts[accepted_idx]
            dist = np.sqrt((pt[0] - accepted_pt[0])**2 + (pt[1] - accepted_pt[1])**2)
            if dist < min_corner_spacing:
                too_close = True
                # Keep the sharper corner (lower angle = sharper)
                accepted_k = raw_corner_indices.index(accepted_idx)
                if corner_angles[k] < corner_angles[accepted_k]:
                    # Current is sharper — replace
                    filtered_indices.remove(accepted_idx)
                    filtered_indices.append(idx)
                break
        if not too_close:
            filtered_indices.append(idx)

    if not filtered_indices:
        return simplified_points

    corner_points = contour_pts[filtered_indices]

    # Snap each simplified vertex to the nearest corner point (if within tolerance)
    refined = []
    for sp in simplified_points:
        sx, sy = sp["x"], sp["y"]
        best_dist = snap_tolerance
        best_pt = None

        for cp in corner_points:
            d = np.sqrt((sx - cp[0])**2 + (sy - cp[1])**2)
            if d < best_dist:
                best_dist = d
                best_pt = cp

        if best_pt is not None:
            refined.append({"x": float(best_pt[0]), "y": float(best_pt[1])})
        else:
            refined.append(sp)

    # SAFEGUARD: Validate polygon topology — reject self-intersecting refinement
    if not _polygon_is_simple(refined):
        # Refinement created a self-intersecting polygon — reject it
        # and return the safer original simplified polygon instead
        return simplified_points

    return refined


def mask_to_polygon_v2(mask_bin: np.ndarray, epsilon: float = DOUGLAS_PEUCKER_EPSILON):
    """
    Enhanced polygon extraction with contour-aware corner snapping.

    Pipeline:
      1. findContours with CHAIN_APPROX_NONE (preserve ALL contour points)
      2. approxPolyDP with epsilon (simplify — but may miss subtle corners)
      3. _refine_polygon_with_contour (snap simplified vertices to real corners)
      4. Subdivide edges longer than MAX_POLYGON_EDGE_LENGTH

    This produces polygons that follow the actual mask boundary more closely,
    especially at roof-wall junctions and valley/hip corners where the
    simplified polygon drifts away from the true boundary.
    """
    mask_uint8 = (mask_bin * 255).astype(np.uint8) if mask_bin.dtype != np.uint8 else mask_bin

    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)

    if not contours:
        return []

    best_contour = max(contours, key=cv2.contourArea)
    simplified = cv2.approxPolyDP(best_contour, epsilon, closed=True)

    if len(simplified) < MIN_POLYGON_POINTS:
        return []

    points = []
    for pt in simplified:
        points.append({"x": float(pt[0][0]), "y": float(pt[0][1])})

    # Snap simplified vertices to high-curvature contour points
    points = _refine_polygon_with_contour(points, best_contour)

    # Subdivide long edges to preserve boundary detail
    points = _subdivide_long_edges(points, MAX_POLYGON_EDGE_LENGTH)

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
    prompted_mode: bool = False,
    prompt_points: list[dict] | None = None,
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

    Returns one of: roof, wall, sky, ground, tree, obstruction, equipment,
    siding, window, door, garage_door, fascia, soffit, gutter, downspout,
    porch, deck, steps, railing, grass, overgrown_grass, sidewalk, driveway,
    gravel, fence, bushes, vegetation_touching_structure,
    utility_meter, main_service_panel, disconnect, conduit, inverter, battery,
    ac_unit, existing_solar_panel,
    car, truck, person, ladder, trash_can, tools, temporary_materials,
    moss, algae, damaged_siding, blocked_access, muddy_work_area,
    unknown

    IMPORTANT: "tree" is a distinct class from "obstruction" because trees
    are the #1 source of false roof masks. Downstream consumers must filter
    out tree masks and not render them as roof geometry.

    When prompted_mode=True, position-based sky/ground rules are weakened
    because the user explicitly clicked on those regions — a foreground
    click on a roof plane near the sky shouldn't be classified as "sky"
    just because it's in the upper portion of the image. Instead, we rely
    more heavily on green_ratio and shape heuristics. If prompt_points are
    provided, we check whether any foreground point falls within the mask
    bbox — if so, position-based rejections are skipped for that mask.

    EXPANDED TAXONOMY (v2.3):
    The original 8-class taxonomy has been expanded to ~33 classes covering
    facade features, electrical infrastructure, site context, occluders, and
    condition flags. These new classes are primarily heuristic-based and
    map to the expanded SegmentationClass type in the TypeScript pipeline.
    """
    x, y, w, h = bbox
    norm_y_center = (y + h / 2) / img_h
    norm_x_center = (x + w / 2) / img_w
    norm_area = area / (img_w * img_h)
    aspect_ratio = max(w, h) / max(min(w, h), 1)

    # ── Vegetation detection ──
    green_ratio = 0.0
    if mask_binary is not None and original_image_bgr is not None:
        green_ratio = _compute_green_ratio(mask_binary, original_image_bgr, scale)

    # ── Brightness and texture analysis (Tuning Pass 3A) ──
    # These provide much stronger signals than green_ratio alone:
    #   - Dark rubber roof: low saturation, moderate luminance, low texture
    #   - White TPO roof: very low saturation, high luminance, low texture
    #   - Tree/vegetation: higher saturation, variable luminance, high texture
    #   - Sky: very low saturation, very high luminance, near-zero texture
    brightness = {"mean_v": 0, "std_v": 0, "mean_s": 0, "std_s": 0,
                  "dark_ratio": 0, "bright_ratio": 0, "gray_ratio": 0}
    texture_score = 0.0
    if mask_binary is not None and original_image_bgr is not None:
        brightness = _compute_brightness_stats(mask_binary, original_image_bgr, scale)
        texture_score = _compute_texture_score(mask_binary, original_image_bgr, scale)

    # Unpack brightness stats for convenient access
    mean_v = brightness["mean_v"]
    std_v = brightness["std_v"]
    mean_s = brightness["mean_s"]
    std_s = brightness["std_s"]
    dark_ratio = brightness["dark_ratio"]
    bright_ratio = brightness["bright_ratio"]
    gray_ratio = brightness["gray_ratio"]

    # ── Composite signals derived from green_ratio + brightness + texture ──
    is_smooth_surface = texture_score < CLASSIFIER_TEXTURE_ROOF_MAX  # Low texture = likely roof/wall
    is_textured_surface = texture_score > CLASSIFIER_TEXTURE_TREE_MIN  # High texture = likely vegetation
    is_dark_surface = mean_v < CLASSIFIER_BRIGHTNESS_DARK_V_MAX       # Dark rubber/shadow
    is_bright_surface = mean_v > CLASSIFIER_BRIGHTNESS_SKY_V_MIN      # Bright sky/TPO
    is_low_saturation = mean_s < CLASSIFIER_BRIGHTNESS_GRAY_S_MAX     # Gray/neutral = not vegetation
    is_uniform_surface = std_v < CLASSIFIER_BRIGHTNESS_SKY_STD_V_MAX  # Near-zero variation = sky or TPO
    is_neutral_gray = is_low_saturation and not is_dark_surface and not is_bright_surface  # Gray = roof/wall

    # ── Condition flags: moss/algae on structure ──
    # Moderate green on structural positions = moss or algae, not a tree
    if green_ratio > CLASSIFIER_GREEN_RATIO_TREE_MODERATE and green_ratio < CLASSIFIER_GREEN_RATIO_TREE:
        # Green on roof position
        if 0.1 < norm_y_center < 0.6 and norm_area < 0.08:
            return "moss"
        # Green on wall/siding position
        if 0.3 <= norm_y_center < 0.75 and aspect_ratio > 0.7:
            return "algae"

    # ── High green + texture = definitely vegetation ──
    # Green ratio alone can miss dark/old trees (green_ratio < 0.35),
    # but green_ratio > 0.15 + high texture = vegetation for sure.
    if green_ratio > CLASSIFIER_GREEN_RATIO_TREE and norm_area > 0.005:
        # Ground-level green = grass
        if norm_y_center > CLASSIFIER_GROUND_Y_MIN:
            if norm_area > 0.05:
                return "overgrown_grass" if green_ratio > 0.5 else "grass"
            return "grass"
        # Moderate height, near structure edges = vegetation touching structure
        if 0.35 < norm_y_center < 0.7:
            if norm_x_center < 0.3 or norm_x_center > 0.7:
                return "vegetation_touching_structure"
            return "bushes"
        # Tall narrow green = tree
        return "tree"

    # Moderate green + high texture = tree even if green_ratio < 0.35
    if green_ratio > CLASSIFIER_GREEN_RATIO_TREE_MODERATE and is_textured_surface:
        if 0.1 < norm_y_center < 0.7 and norm_area > 0.005:
            if norm_y_center > CLASSIFIER_GROUND_Y_MIN:
                return "grass"
            return "tree"

    # ── Check if a foreground prompt point falls within this mask bbox ──
    has_fg_point_in_bbox = False
    if prompted_mode and prompt_points:
        x_min, y_min, bw, bh = bbox
        x_max = x_min + bw
        y_max = y_min + bh
        for pt in prompt_points:
            if pt.get("label", 1) == 1:  # foreground point
                px, py = pt.get("x", 0), pt.get("y", 0)
                if x_min <= px <= x_max and y_min <= py <= y_max:
                    has_fg_point_in_bbox = True
                    break

    # ══════════════════════════════════════════════════════════════════════
    # REORDERED (Tuning Pass 3A): Roof detection BEFORE sky detection
    # Previously, sky detection ran first and stole flat/white roofs that
    # were in the upper portion of the image. Now roof-like shapes in the
    # upper-middle zone are checked for roof first, and only classified as
    # sky if they fail the roof checks AND match sky-specific brightness.
    # ══════════════════════════════════════════════════════════════════════

    # ── Roof detection (STANDARD — pitched roofs) ──
    # Large area, wide aspect ratio, upper-middle position, NOT vegetation
    if 0.1 < norm_y_center < 0.6 and norm_area > 0.02:
        if green_ratio < CLASSIFIER_GREEN_RATIO_ROOF_MAX and not is_textured_surface:
            if aspect_ratio > 1.3:
                return "roof"
            if stability_score > 0.95 and aspect_ratio > 1.0:
                return "roof"
            if norm_area > 0.05 and is_smooth_surface:
                return "roof"

    # ── Roof detection (FLAT / low-slope — enhanced with brightness + texture) ──
    # Flat rubber/membrane roofs viewed from the side appear as thin, wide,
    # dark horizontal strips at the top of the structure. Enhanced detection:
    #   - Low green_ratio OR low saturation (dark rubber is nearly gray)
    #   - Low texture (smooth membrane surface, not rough vegetation)
    #   - Brightness analysis distinguishes dark rubber from shadow/soil
    #   - White TPO membranes: very bright, very low saturation, smooth
    if 0.1 < norm_y_center < 0.6 and norm_area > 0.003:
        # Roof candidate: low green AND low saturation (not vegetation)
        roof_color_ok = (green_ratio < CLASSIFIER_GREEN_RATIO_ROOF_MAX and
                         is_low_saturation and is_smooth_surface)
        # Also allow moderate green if texture confirms smooth surface (moss on flat roof)
        roof_texture_override = (green_ratio < 0.35 and is_smooth_surface and
                                 not is_textured_surface and
                                 0.1 < norm_y_center < 0.6)
        if roof_color_ok or roof_texture_override:
            # Dark rubber roof: wide strip, low saturation, moderate luminance
            if aspect_ratio > 2.5:
                return "roof"
            if aspect_ratio > 1.8 and stability_score > 0.88:
                return "roof"
            # Moderate aspect flat roof with texture confirmation
            if aspect_ratio > 1.5 and is_smooth_surface:
                return "roof"

    # ── Roof detection (BLACK TPO / dark membrane roofs) ──
    # Black TPO/EPDM rubber membranes are the most common flat roof type on
    # commercial buildings. They are VERY dark (black/charcoal), very low
    # saturation, very smooth texture, and can occupy large areas of the image.
    # Key distinctions from other dark surfaces:
    #   - Shadow: also dark + low-sat, but shadows have high std_v (uneven lighting)
    #     and are NOT smooth (shadow falls on textured surfaces below)
    #   - Dark tree: dark but has high saturation and high texture
    #   - Ground/soil: dark but lower in image, more textured
    #   - Dark wall/siding: plausible, but walls are typically taller (lower aspect_ratio)
    #
    # Black TPO signature: mean_v < 140, mean_s < 25, texture < 15,
    #                       std_v < 35 (uniform dark surface), large area
    if 0.05 < norm_y_center < 0.65 and norm_area > 0.01:
        is_black_tpo = (mean_v < CLASSIFIER_BRIGHTNESS_BLACK_TPO_V_MAX and
                        mean_s < CLASSIFIER_BRIGHTNESS_BLACK_TPO_S_MAX and
                        is_smooth_surface and
                        green_ratio < CLASSIFIER_GREEN_RATIO_ROOF_MAX)
        if is_black_tpo:
            # Wide dark strip = flat roof (most common presentation)
            if aspect_ratio > 1.2 and norm_area > 0.015:
                return "roof"
            # Large dark area in upper half = flat roof covering most of view
            if norm_area > 0.05 and norm_y_center < 0.5:
                return "roof"
            # Moderate area dark smooth surface in structure zone = roof patch
            if norm_area > 0.02 and std_v < 35 and aspect_ratio > 0.8:
                return "roof"

    # ── Roof detection (WHITE/LIGHT TPO membranes) ──
    # White TPO/PVC roof membranes are very bright, nearly uniform, and
    # have extremely low saturation. They look like sky but are on the
    # structure. Key differentiator from sky: TPO has detectable texture
    # (seams, patches, slight soiling) — std_v > 5-8 vs sky std_v < 5.
    if 0.05 < norm_y_center < 0.6 and norm_area > 0.01:
        if is_bright_surface and is_low_saturation and is_smooth_surface:
            # Bright + low saturation + smooth + upper-middle = white roof
            # Sky would have std_v < 5; TPO roofs have std_v > 8
            if not is_uniform_surface or std_v > 8:
                if aspect_ratio > 1.2:
                    return "roof"
                if norm_area > 0.03 and is_smooth_surface:
                    return "roof"

    # ── Sky detection (top of image, large area) — MOVED AFTER ROOF ──
    # Sky is now only classified if the mask does NOT match roof shape
    # and DOES match sky brightness (very high V, very low std_v, very low S).
    # This prevents flat/white roofs from being stolen by the sky check.
    if not (prompted_mode and has_fg_point_in_bbox):
        if norm_y_center < CLASSIFIER_SKY_Y_MAX and norm_area > 0.04:
            # Enhanced sky check: must look like sky (bright + uniform + desaturated)
            # A flat roof at the top of the image should have been caught above.
            sky_brightness = is_bright_surface and is_uniform_surface and is_low_saturation
            # Large area + upper position + sky-like brightness = sky
            if sky_brightness or (green_ratio < 0.05 and aspect_ratio < 2.0):
                return "sky"

    # ── Ground detection (bottom of image) ──
    if not (prompted_mode and has_fg_point_in_bbox):
        if norm_y_center > CLASSIFIER_GROUND_Y_MIN and norm_area > 0.02:
            # Distinguish ground subtypes by color and area
            if green_ratio > CLASSIFIER_GREEN_RATIO_TREE_MODERATE:
                return "overgrown_grass" if norm_area > 0.1 else "grass"
            # Non-green ground = driveway or sidewalk
            if green_ratio < 0.05:
                if norm_area > 0.08:
                    return "driveway"
                return "sidewalk"
            return "ground"

    # ── Tree detection by shape (no strong green, but position + shape match) ──
    if 0.15 < norm_y_center < 0.65 and norm_area > 0.02 and aspect_ratio < 1.3:
        if green_ratio > CLASSIFIER_GREEN_RATIO_TREE_MODERATE:
            return "tree"
        # Textured surface in tree position = likely tree even with low green
        if is_textured_surface and not is_low_saturation:
            return "tree"

    # ── Wall/facade detection ──
    if 0.2 <= norm_y_center < 0.85 and h > w * 0.8 and green_ratio < CLASSIFIER_GREEN_RATIO_ROOF_MAX:
        return "wall"

    # ── Facade elements (sub-regions on the wall plane) ──
    if 0.2 <= norm_y_center < 0.85 and green_ratio < CLASSIFIER_GREEN_RATIO_ROOF_MAX:
        # Windows: small, roughly square, in upper wall area
        if 0.003 < norm_area < 0.02 and 0.6 < aspect_ratio < 1.8:
            if norm_y_center < 0.6:
                return "window"
        # Doors: small, tall narrow, in lower wall area
        if 0.005 < norm_area < 0.04 and aspect_ratio < 0.7:
            if norm_y_center > 0.5:
                return "door"
        # Garage door: moderate area, tall wide, in lower-middle wall
        if 0.02 < norm_area < 0.1 and 0.8 < aspect_ratio < 1.5:
            if 0.4 < norm_y_center < 0.75:
                return "garage_door"
        # Gutter: very thin horizontal strip at top of wall
        if norm_area < 0.005 and aspect_ratio > 3.0 and norm_y_center < 0.45:
            return "gutter"
        # Downspout: very thin vertical strip along wall edge
        if norm_area < 0.003 and aspect_ratio < 0.3 and (norm_x_center < 0.15 or norm_x_center > 0.85):
            return "downspout"
        # Porch: moderate area, bottom of wall, extends outward
        if 0.03 < norm_area < 0.1 and norm_y_center > 0.6 and aspect_ratio > 1.2:
            return "porch"
        # Deck: similar to porch but at ground level
        if 0.03 < norm_area < 0.15 and norm_y_center > 0.7 and aspect_ratio > 1.5:
            return "deck"
        # Steps: small area, very bottom
        if 0.005 < norm_area < 0.02 and norm_y_center > 0.75 and aspect_ratio > 1.0:
            return "steps"
        # Railing: thin horizontal line in lower-middle
        if norm_area < 0.003 and aspect_ratio > 4.0 and 0.4 < norm_y_center < 0.7:
            return "railing"
        # Siding: large wall-like region (fallback for wall sub-areas)
        if norm_area > 0.04 and aspect_ratio > 0.8:
            return "siding"
        # Fascia/soffit: thin strip at roof-wall junction
        if norm_area < 0.01 and aspect_ratio > 2.0 and 0.3 < norm_y_center < 0.5:
            return "fascia"

    # ── Electrical/solar equipment detection ──
    if green_ratio < CLASSIFIER_GREEN_RATIO_ROOF_MAX:
        # Utility meter: very small, near ground level on wall
        if 0.002 < norm_area < 0.005 and 0.55 < norm_y_center < 0.75:
            if norm_x_center < 0.2 or norm_x_center > 0.8:
                return "utility_meter"
        # AC unit: small-to-moderate square, at ground or wall level
        if 0.003 < norm_area < 0.02 and 0.7 < aspect_ratio < 1.5:
            if norm_y_center > 0.5:
                return "ac_unit"
        # Existing solar panel: moderate area, on roof, dark low-green
        if 0.01 < norm_area < 0.06 and 0.1 < norm_y_center < 0.5:
            if aspect_ratio > 1.2 and green_ratio < 0.10:
                return "existing_solar_panel"
        # Conduit: thin vertical line on wall
        if norm_area < 0.002 and aspect_ratio < 0.3 and 0.3 < norm_y_center < 0.8:
            return "conduit"
        # Equipment (small, upper portion) — fallback
        if 0.003 < norm_area < 0.03 and norm_y_center < 0.6:
            return "equipment"

    # ── Roof penetration detection (chimney, vent pipe, skylight) ──
    # Small objects on the roof that are critical for solar design:
    # - Chimneys affect setback requirements and shading
    # - Vent pipes/plumbing stacks affect placement and flashing details
    # - Skylights affect both placement and production estimates
    #
    # IMPORTANT: Bias toward FALSE NEGATIVES over false positives.
    # It is far worse to misclassify a tree fragment or shadow patch as
    # "chimney" than to miss a real chimney. Misclassified penetration masks
    # pollute downstream geometry and produce surreal rendering artifacts.
    #
    # Additional safeguards beyond the original loose conditions:
    # - Must be smooth surface (not textured like tree/vegetation fragments)
    # - Must have high stability score (not SAM2 noise/edge artifacts)
    # - Tighter area and aspect_ratio bounds
    # - Chimney requires low saturation (not green/mossy fragments)
    # - Vent pipe requires truly tiny circular shape
    # - Skylight requires bright + low-sat (glass reflecting sky)
    if norm_y_center < 0.55 and norm_area < 0.02 and green_ratio < 0.10:
        # Chimney: small, roughly square or slightly tall, SMOOTH, on roof
        # Real chimneys: brick/metal cap → smooth mask, high stability,
        # low saturation (not vegetation), moderate-to-dark brightness
        if norm_area > 0.002 and 0.7 < aspect_ratio < 1.8:
            if is_smooth_surface and stability_score > 0.90 and is_low_saturation:
                # Skylight override: bright + low-sat glass on roof
                if is_bright_surface:
                    return "skylight"
                # Dark/medium + smooth + stable + low-sat = chimney
                return "chimney"

        # Vent pipe / plumbing stack: VERY tiny, roughly circular
        # Real vent pipes: 2-4" diameter → tiny circular mask (~3-8px at 512px)
        # Must be extremely small AND nearly circular (not rectangular fragments)
        if norm_area < 0.002 and 0.75 < aspect_ratio < 1.4:
            if is_smooth_surface and stability_score > 0.92:
                return "vent_pipe"

        # Skylight: bright, low-sat, roughly square or slightly wide
        # Real skylights: glass dome/flat reflecting sky → bright + uniform
        # Must be clearly bright AND clearly low-saturation (sky reflection)
        if is_bright_surface and is_low_saturation and is_uniform_surface:
            if norm_area > 0.002 and 0.8 < aspect_ratio < 2.0:
                if stability_score > 0.88:
                    return "skylight"

    # ── Occluder detection ──
    # Large objects at ground level that block the view of the structure
    if norm_y_center > 0.5 and green_ratio < 0.10:
        # Car/truck: large horizontal area at ground level
        if 0.04 < norm_area < 0.2 and aspect_ratio > 1.5:
            return "car" if norm_area < 0.12 else "truck"
        # Person: very tall narrow at ground level
        if 0.003 < norm_area < 0.02 and aspect_ratio < 0.5:
            return "person"
        # Ladder: thin tall at ground level
        if norm_area < 0.003 and aspect_ratio < 0.25:
            return "ladder"
        # Trash can: small square at ground level
        if 0.002 < norm_area < 0.008 and 0.6 < aspect_ratio < 1.5:
            return "trash_can"

    # ── Obstruction detection (very small regions) ──
    if norm_area < 0.01:
        return "obstruction"

    # ── Remaining ground ──
    if norm_y_center > 0.55 and norm_area > 0.01:
        if green_ratio > CLASSIFIER_GREEN_RATIO_TREE_MODERATE:
            return "grass"
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


def _compute_brightness_stats(
    mask_binary: np.ndarray,
    original_image_bgr: np.ndarray,
    scale: float,
) -> dict:
    """
    Compute brightness and saturation statistics for the mask region.

    Returns a dict with:
      - mean_v: mean Value (luminance) in HSV, 0-255
      - std_v:  std dev of Value — sky is near-zero std, roofs have some variation
      - mean_s: mean Saturation in HSV, 0-255
      - std_s:  std dev of Saturation
      - dark_ratio: fraction of pixels with V < 80 (dark surfaces)
      - bright_ratio: fraction of pixels with V > 200 (bright surfaces)
      - gray_ratio: fraction of pixels with S < 30 AND 80 < V < 200 (gray/neutral surfaces)

    These stats help distinguish:
      - Dark rubber roof: low mean_s (<25), moderate mean_v (60-140), low std_v (<35), high gray_ratio
      - White TPO roof: low mean_s (<20), high mean_v (>180), very low std_v (<15), high bright_ratio
      - Sky: very low mean_s (<15), very high mean_v (>200), near-zero std_v (<8)
      - Tree/vegetation: moderate-high mean_s (>40), variable mean_v, high std_v (>30)
      - Shadow: very low mean_v (<60), variable mean_s
    """
    try:
        if original_image_bgr is None or mask_binary is None:
            return {"mean_v": 0, "std_v": 0, "mean_s": 0, "std_s": 0,
                    "dark_ratio": 0, "bright_ratio": 0, "gray_ratio": 0}

        orig_h, orig_w = original_image_bgr.shape[:2]

        if scale != 1.0:
            mask_full = cv2.resize(
                mask_binary.astype(np.uint8),
                (orig_w, orig_h),
                interpolation=cv2.INTER_NEAREST,
            )
        else:
            mask_full = mask_binary.astype(np.uint8)

        masked_pixels = original_image_bgr[mask_full > 0]

        if len(masked_pixels) < 10:
            return {"mean_v": 0, "std_v": 0, "mean_s": 0, "std_s": 0,
                    "dark_ratio": 0, "bright_ratio": 0, "gray_ratio": 0}

        hsv = cv2.cvtColor(masked_pixels.reshape(-1, 1, 3), cv2.COLOR_BGR2HSV)
        hsv = hsv.reshape(-1, 3)
        h, s, v = hsv[:, 0], hsv[:, 1], hsv[:, 2]

        total = len(masked_pixels)
        dark_ratio = float(np.sum(v < 80) / total)
        bright_ratio = float(np.sum(v > 200) / total)
        gray_ratio = float(np.sum((s < 30) & (v > 80) & (v < 200)) / total)

        return {
            "mean_v": float(np.mean(v)),
            "std_v": float(np.std(v)),
            "mean_s": float(np.mean(s)),
            "std_s": float(np.std(s)),
            "dark_ratio": dark_ratio,
            "bright_ratio": bright_ratio,
            "gray_ratio": gray_ratio,
        }

    except Exception as e:
        logger.warning(f"Brightness stats computation failed: {e}")
        return {"mean_v": 0, "std_v": 0, "mean_s": 0, "std_s": 0,
                "dark_ratio": 0, "bright_ratio": 0, "gray_ratio": 0}


def _compute_texture_score(
    mask_binary: np.ndarray,
    original_image_bgr: np.ndarray,
    scale: float,
) -> float:
    """
    Compute a texture complexity score for the mask region.

    Uses the standard deviation of Laplacian (second derivative) on the
    grayscale image within the mask. This measures how much fine detail
    is present:
      - Roofs (smooth surface): LOW texture score (Laplacian std < 10-15)
      - Trees/vegetation (leaves, branches): HIGH texture score (> 20-30)
      - Walls/siding (moderate texture): MEDIUM texture score (10-20)
      - Sky (perfectly smooth): VERY LOW texture score (< 5)

    The texture score combined with green_ratio provides a much stronger
    vegetation-vs-roof signal than green_ratio alone. A dark tree with
    green_ratio=0.15 (below the tree threshold) but texture=35 is clearly
    vegetation. A dark rubber roof with green_ratio=0.05 and texture=8 is
    clearly a roof surface.
    """
    try:
        if original_image_bgr is None or mask_binary is None:
            return 0.0

        orig_h, orig_w = original_image_bgr.shape[:2]

        if scale != 1.0:
            mask_full = cv2.resize(
                mask_binary.astype(np.uint8),
                (orig_w, orig_h),
                interpolation=cv2.INTER_NEAREST,
            )
        else:
            mask_full = mask_binary.astype(np.uint8)

        # Convert to grayscale
        gray = cv2.cvtColor(original_image_bgr, cv2.COLOR_BGR2GRAY)

        # Compute Laplacian
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)

        # Get Laplacian values within mask
        mask_laplacian = laplacian[mask_full > 0]

        if len(mask_laplacian) < 10:
            return 0.0

        # Standard deviation of Laplacian = texture complexity score
        texture = float(np.std(mask_laplacian))
        return texture

    except Exception as e:
        logger.warning(f"Texture score computation failed: {e}")
        return 0.0


# Classes that are relevant for solar installation assessment.
# Expanded from roof-only to include facade, electrical, site context,
# and condition classes. Occluders (car, person, etc.) are excluded
# because they only block the view — they don't affect solar feasibility.
SOLAR_RELEVANT_CLASSES = {
    # Legacy roof-critical
    "roof", "wall", "equipment", "obstruction",
    # Facade
    "siding", "window", "door", "garage_door", "fascia", "soffit",
    "gutter", "downspout", "porch", "deck", "steps", "railing",
    # Electrical/solar
    "utility_meter", "main_service_panel", "disconnect", "conduit",
    "inverter", "battery", "ac_unit", "existing_solar_panel",
    # Site context (solar-relevant)
    "driveway", "fence", "bushes", "vegetation_touching_structure",
    # Condition flags
    "moss", "algae", "damaged_siding", "blocked_access", "muddy_work_area",
}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SAM 2 Segmentation Service",
    description="Roof geometry segmentation using Meta's SAM 2.1 model",
    version="2.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Load SAM 2 model on startup. MiDaS is lazy-loaded on first /depth request.

    MEMORY OPTIMIZATION (Render Standard 2GB):
    Previously, both SAM2 + MiDaS PyTorch models loaded at startup, consuming
    ~1.2GB+ just for model weights. During inference, intermediate tensors
    pushed past 2GB → OOM kill (confirmed 2026-06-01 16:18:27Z).

    Changes:
    1. When ONNX backend is active, PyTorch SAM2 is NOT loaded (saves ~400MB+)
    2. MiDaS is lazy-loaded only on first /depth request (saves ~200MB at idle)
    3. On /depth request, SAM2 encoder outputs are freed before MiDaS loads

    STARTUP RESILIENCE:
    The _starting_up flag is set to True before this function runs and False
    after it completes. The /health endpoint uses this to report "starting"
    during model load, which tells Render the container is alive but not yet
    ready. This prevents Render from killing the container with exit code 1
    during the model download/initialization period on fresh instances.
    """
    global _starting_up
    logger.info(f"SAM 2 service starting (backend={INFERENCE_BACKEND})...")
    mem_start = _get_memory_mb()
    logger.info(f"Memory at startup: {mem_start:.0f}MB")

    try:
        if INFERENCE_BACKEND == "onnx":
            try:
                load_onnx_amg()
                logger.info("SAM 2 ONNX backend loaded successfully — PyTorch SAM2 NOT loaded (saves ~400MB)")
            except Exception as e:
                logger.warning(f"ONNX backend failed on startup: {e}")
                logger.warning("Falling back to PyTorch backend")
                try:
                    load_sam2_model()
                except Exception as e2:
                    logger.warning(f"PyTorch fallback also failed: {e2}")
                    logger.warning("Service will attempt lazy load on first /segment request")
        else:
            try:
                load_sam2_model()
                logger.info("SAM 2 PyTorch model loaded successfully")
            except Exception as e:
                logger.warning(f"SAM 2 PyTorch model load failed on startup: {e}")
                logger.warning("Service will attempt lazy load on first /segment request")
    except Exception as e:
        logger.warning(f"Unexpected error during startup: {e}")
        logger.warning("Service will attempt lazy load on first /segment request")

    # MiDaS: NOT loaded at startup to save ~200MB on Render Standard (2GB RAM).
    # Instead, lazy-loaded on first /depth request. This keeps idle memory
    # ~600MB lower, preventing OOM when both SAM2 inference + MiDaS load
    # would otherwise exceed the 2GB limit simultaneously.
    logger.info("MiDaS depth model will be lazy-loaded on first /depth request (saves ~200MB at startup)")
    logger.info(f"Memory after SAM2 load: {_get_memory_mb():.0f}MB")

    # Signal that startup is complete — /health now reports accurate status
    _starting_up = False
    logger.info("Startup complete — service is ready to accept requests")


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check service health and model readiness.

    IMPORTANT: This endpoint MUST respond instantly (non-blocking) because
    Render's platform health check has a 5-second timeout. If SAM2 or MiDaS
    inference is running (which takes 35-40s on CPU), we still respond
    immediately with inference_active=True. This prevents Render from
    marking the instance as unhealthy during long-running inference.

    STARTUP RESILIENCE: Returns HTTP 200 with status="starting" during the
    startup_event() model load. Render's HTTP health check only checks the
    HTTP status code (200 = healthy), NOT the response body. This ensures
    the container stays alive during the model download/initialization
    period, even on fresh Pro instances where HuggingFace download takes
    3-5 minutes. The Dockerfile HEALTHCHECK also uses urllib.request.urlopen
    which only checks HTTP status code.
    """
    sam2_ready = _sam2_amg is not None or _onnx_amg is not None
    midas_ready = _midas_model is not None if MIDAS_ENABLED else False

    active_backend = "onnx" if _onnx_amg is not None else ("pytorch" if _sam2_amg is not None else "none")

    # Determine status — always returns HTTP 200 to keep Render happy
    if _starting_up:
        status = "starting"  # container alive, model loading — Render sees HTTP 200
    elif _inference_active:
        status = "busy"  # healthy but processing — Render should not restart
    elif sam2_ready:
        status = "ready"
    else:
        status = "loading"  # model not loaded yet (lazy load mode)

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
        inference_backend=active_backend,
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
        default=MAX_MASKS,
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
    timing = TimingBreakdown()

    # Memory guard: check available RAM before running inference
    # On Render Standard (2GB), if available memory is too low, reject
    # the request rather than risking OOM kill (which takes down the
    # entire service for ~30s while it restarts).
    mem_ok, mem_avail = _check_memory_guard(min_free_mb=200)
    if not mem_ok:
        logger.warning(f"Rejecting /segment request — only {mem_avail:.0f}MB available (need 200MB)")
        raise HTTPException(
            status_code=503,
            detail=f"Insufficient memory for inference ({mem_avail:.0f}MB available, need 200MB). Service may be processing another request.",
        )

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
        t_decode = time.time()
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty image file")

        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise HTTPException(status_code=400, detail="Could not decode image")

        timing.image_decode_ms = (time.time() - t_decode) * 1000

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image read error: {str(e)}")

    orig_h, orig_w = image.shape[:2]

    # Resize for CPU inference to avoid OOM and speed up processing
    t_resize = time.time()
    image_resized, scale = resize_for_inference(image)
    res_h, res_w = image_resized.shape[:2]
    timing.image_resize_ms = (time.time() - t_resize) * 1000

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

        t_encoder = time.time()
        loop = asyncio.get_event_loop()
        sam_masks = await loop.run_in_executor(
            _inference_executor,
            amg.generate,
            image_rgb,
        )
        t_after_inference = time.time()
        # Note: encoder+decoder timing is logged inside the AMG generate() method.
        # Here we capture total inference wall time. The AMG logs break it down further.
        timing.encoder_ms = (t_after_inference - t_encoder) * 1000  # total inference

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

    # ── Filter impact tracking ──────────────────────────────────────────
    # Track how many masks are removed at each filter stage so we can
    # diagnose whether the pipeline is too aggressive with filtering.
    filter_impact = {
        "raw_masks": len(sam_masks),
        "removed_by_area": 0,
        "removed_by_polygon_points": 0,
        "removed_by_roof_only": 0,
        "removed_by_max_masks": 0,
        "remaining": 0,
    }

    # Process SAM 2 masks into polygon-based results
    result_masks: list[SegmentationMask] = []
    # Track all classified masks (including filtered) for metadata
    all_classified_masks: list[SegmentationMask] = []

    t_classify_start = time.time()
    t_polygon_start = time.time()
    t_polygon_total = 0.0
    t_classify_total = 0.0

    for idx, sam_mask in enumerate(sam_masks):
        mask_binary = sam_mask["segmentation"]
        bbox = sam_mask["bbox"]
        stability = sam_mask["stability_score"]
        predicted_iou = sam_mask["predicted_iou"]
        area_px = int(sam_mask.get("area", np.sum(mask_binary)))

        if area_px < min_area_px:
            filter_impact["removed_by_area"] += 1
            continue

        t_poly = time.time()
        polygon_points = mask_to_polygon_v2(mask_binary.astype(np.uint8))
        t_polygon_total += (time.time() - t_poly) * 1000

        if len(polygon_points) < MIN_POLYGON_POINTS:
            filter_impact["removed_by_polygon_points"] += 1
            continue

        # Scale coordinates back to original image size
        if scale != 1.0:
            polygon_points = [
                {"x": p["x"] / scale, "y": p["y"] / scale}
                for p in polygon_points
            ]
            bbox = [v / scale for v in bbox]
            area_px = int(area_px / (scale * scale))

        t_cls = time.time()
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
        t_classify_total += (time.time() - t_cls) * 1000

        confidence = min(100, round((predicted_iou * 0.4 + stability * 0.6) * 100))

        mask_obj = SegmentationMask(
            mask_index=idx,
            polygon=[PolygonPoint(x=p["x"], y=p["y"]) for p in polygon_points],
            area=float(area_px),
            bbox=[float(v) for v in bbox],
            confidence=confidence,
            stability_score=round(stability, 4),
            class_hint=class_hint,
            point_count=len(polygon_points),
        )

        result_masks.append(mask_obj)
        all_classified_masks.append(mask_obj)

        # ── Per-mask detail logging (instrumentation) ────────────────
        # Log every mask's classification details so we can diagnose
        # misclassifications and tune the heuristic classifier later.
        logger.info(
            f"  mask[{idx}]: class={class_hint}, area={area_px}px "
            f"({area_px/(orig_w*orig_h)*100:.2f}% of image), "
            f"confidence={confidence}, stability={stability:.3f}, "
            f"iou_pred={predicted_iou:.3f}, polygon_pts={len(polygon_points)}, "
            f"bbox={[round(v,1) for v in bbox]}"
        )

        # Free mask memory as we go
        del sam_mask

    timing.classify_ms = round(t_classify_total, 1)
    timing.polygon_ms = round(t_polygon_total, 1)

    # ── Roof-only filtering ──
    # When roof_only=True (default), only return masks whose class_hint is
    # relevant for roof geometry. This filters out sky, ground, tree, and
    # unknown masks that would appear as garbage overlays on the house.
    # The classification is heuristic-based and may misclassify some masks,
    # but this filter is essential to prevent tree/ground lines from
    # dominating the geometry overlay.
    #
    # CHANGED (Pass 1): Instead of permanently discarding filtered masks,
    # we emit their metadata in filtered_masks_metadata so the TS worker
    # can log what was removed without rendering it as geometry.
    t_filter_start = time.time()
    pre_filter_count = len(result_masks)
    filtered_masks_metadata: list[FilteredMaskMeta] = []

    if roof_only:
        roof_masks = [m for m in result_masks if m.class_hint in SOLAR_RELEVANT_CLASSES]
        filtered_out = [m for m in result_masks if m.class_hint not in SOLAR_RELEVANT_CLASSES]
        if filtered_out:
            class_counts = {}
            for m in filtered_out:
                class_counts[m.class_hint] = class_counts.get(m.class_hint, 0) + 1
                # Emit metadata (no polygon geometry) for diagnostics
                filtered_masks_metadata.append(FilteredMaskMeta(
                    mask_index=m.mask_index,
                    class_hint=m.class_hint,
                    area=m.area,
                    bbox=m.bbox,
                    confidence=m.confidence,
                    stability_score=m.stability_score,
                    filter_reason="roof_only",
                ))
            filter_impact["removed_by_roof_only"] = len(filtered_out)
            logger.info(
                f"Roof-only filter: removed {len(filtered_out)} non-roof masks: {class_counts} "
                f"({pre_filter_count} → {len(roof_masks)} remaining)"
            )
        result_masks = roof_masks

    result_masks.sort(key=lambda m: m.area, reverse=True)
    if len(result_masks) > max_masks:
        # Emit metadata for masks removed by the count cap
        for m in result_masks[max_masks:]:
            filtered_masks_metadata.append(FilteredMaskMeta(
                mask_index=m.mask_index,
                class_hint=m.class_hint,
                area=m.area,
                bbox=m.bbox,
                confidence=m.confidence,
                stability_score=m.stability_score,
                filter_reason="max_masks",
            ))
        filter_impact["removed_by_max_masks"] = len(result_masks) - max_masks
        result_masks = result_masks[:max_masks]

    filter_impact["remaining"] = len(result_masks)
    timing.filter_ms = round((time.time() - t_filter_start) * 1000, 1)

    processing_time = (time.time() - t0) * 1000
    timing.total_ms = round(processing_time, 1)

    logger.info(
        f"Segmented {orig_w}x{orig_h} image (processed at {res_w}x{res_h}): "
        f"{filter_impact['raw_masks']} raw masks → {pre_filter_count} classified → "
        f"{len(result_masks)} roof-only filtered masks "
        f"in {processing_time:.0f}ms [backend={backend}] | "
        f"filter_impact={filter_impact}"
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
        # ── Instrumentation fields (Pass 1 tuning) ──
        timing_breakdown=timing,
        filtered_masks_metadata=filtered_masks_metadata if filtered_masks_metadata else None,
        filter_impact=filter_impact,
    )


# ---------------------------------------------------------------------------
# Prompted segmentation endpoint — user-provided click points
# ---------------------------------------------------------------------------

@app.post("/segment-prompted", response_model=SegmentResponse)
async def segment_prompted(
    file: UploadFile = File(..., description="Survey photo (JPEG/PNG/WebP)"),
    points: str = Query(
        default="[]",
        description='JSON array of prompt points: [{"x":100,"y":200,"label":1},{"x":50,"y":300,"label":0}]. label=1=foreground, 0=background',
    ),
    min_area_fraction: float = Query(
        default=MIN_MASK_AREA_FRACTION,
        description="Minimum mask area as fraction of image area",
        ge=0.001,
        le=0.5,
    ),
    roof_only: bool = Query(
        default=False,
        description="If true, only return roof-relevant masks. Default false for prompted mode since user controls what to segment.",
    ),
):
    """
    Prompted segmentation: segment specific regions using user-provided click points.

    This is SAM2's intended use case and produces dramatically better results
    than AMG (automatic mask generation). Instead of a dumb grid that misses
    roof planes, the user clicks approximate areas of interest and SAM2
    returns precise masks.

    Usage:
    1. User clicks on roof areas in the frontend (foreground points, label=1)
    2. Optionally clicks on trees/sky to EXCLUDE those areas (background points, label=0)
    3. SAM2 encodes the image once, then decodes precise masks around each click

    Example points JSON:
    [{"x":150,"y":100,"label":1}, {"x":300,"y":80,"label":1}, {"x":400,"y":300,"label":0}]

    The first two points mark roof areas, the third marks a tree to exclude.
    """
    import json as _json

    t0 = time.time()

    # Parse points JSON
    try:
        prompt_points = _json.loads(points)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid points JSON: {str(e)}. Expected format: [{{'x':100,'y':200,'label':1}}]",
        )

    if not prompt_points:
        raise HTTPException(
            status_code=400,
            detail="No prompt points provided. Use /segment for automatic mask generation.",
        )

    # Validate points
    for i, pt in enumerate(prompt_points):
        if "x" not in pt or "y" not in pt:
            raise HTTPException(
                status_code=400,
                detail=f"Point {i} missing 'x' or 'y' coordinate: {pt}",
            )
        pt.setdefault("label", 1)  # default to foreground

    # Memory guard
    mem_ok, mem_avail = _check_memory_guard(min_free_mb=200)
    if not mem_ok:
        logger.warning(f"Rejecting /segment-prompted — only {mem_avail:.0f}MB available")
        raise HTTPException(
            status_code=503,
            detail=f"Insufficient memory for inference ({mem_avail:.0f}MB available, need 200MB)",
        )

    # Get AMG instance (needs encoder for prompted mode)
    try:
        amg, backend = get_amg()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"SAM 2 model not available (backend={INFERENCE_BACKEND}): {str(e)}",
        )

    # Check if prompted mode is supported (ONNX backend only for now)
    if backend != "onnx" or not hasattr(amg, "generate_prompted"):
        raise HTTPException(
            status_code=400,
            detail=f"Prompted segmentation requires ONNX backend (current: {backend})",
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

    # Resize for CPU inference
    image_resized, scale = resize_for_inference(image)
    res_h, res_w = image_resized.shape[:2]

    min_area_px = res_w * res_h * min_area_fraction

    # Scale prompt point coordinates to resized image space
    scaled_points = []
    for pt in prompt_points:
        scaled_points.append({
            "x": pt["x"] * scale,
            "y": pt["y"] * scale,
            "label": pt["label"],
        })

    # Run prompted segmentation in a thread
    try:
        image_rgb = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)
        mem_before = _get_memory_mb()
        logger.info(
            f"Starting SAM 2 prompted segmentation on {res_w}x{res_h} image "
            f"({len(scaled_points)} points, CPU={IS_CPU}, RSS={mem_before:.0f}MB)"
        )

        global _inference_active, _inference_type, _last_inference_start, _last_inference_end
        _inference_active = True
        _inference_type = "segment_prompted"
        _last_inference_start = time.time()

        loop = asyncio.get_event_loop()
        sam_masks = await loop.run_in_executor(
            _inference_executor,
            amg.generate_prompted,
            image_rgb,
            scaled_points,
        )

        _inference_active = False
        _inference_type = ""
        _last_inference_end = time.time()

        mem_after = _get_memory_mb()
        logger.info(
            f"SAM 2 prompted: {len(sam_masks)} masks (RSS={mem_after:.0f}MB, "
            f"delta={mem_after-mem_before:.0f}MB)"
        )

    except Exception as e:
        _inference_active = False
        _inference_type = ""
        _last_inference_end = time.time()
        logger.error(f"SAM 2 prompted segmentation failed: {e}")
        logger.error(traceback.format_exc())
        gc.collect()
        raise HTTPException(
            status_code=500,
            detail=f"SAM 2 prompted segmentation error: {str(e)}",
        )

    # Process masks into polygon-based results (same as /segment)
    result_masks: list[SegmentationMask] = []

    for idx, sam_mask in enumerate(sam_masks):
        mask_binary = sam_mask["segmentation"]
        bbox = sam_mask["bbox"]
        stability = sam_mask["stability_score"]
        predicted_iou = sam_mask["predicted_iou"]
        area_px = int(sam_mask.get("area", np.sum(mask_binary)))

        if area_px < min_area_px:
            continue

        polygon_points = mask_to_polygon_v2(mask_binary.astype(np.uint8))

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
            prompted_mode=True,
            prompt_points=prompt_points,
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

    # Roof-only filter (off by default for prompted mode)
    pre_filter_count = len(result_masks)
    filtered_masks_metadata: list[FilteredMaskMeta] = []
    if roof_only:
        roof_masks = [m for m in result_masks if m.class_hint in SOLAR_RELEVANT_CLASSES]
        filtered_out = [m for m in result_masks if m.class_hint not in SOLAR_RELEVANT_CLASSES]
        for m in filtered_out:
            filtered_masks_metadata.append(FilteredMaskMeta(
                mask_index=m.mask_index,
                class_hint=m.class_hint,
                area=m.area,
                bbox=m.bbox,
                confidence=m.confidence,
                stability_score=m.stability_score,
                filter_reason="roof_only",
            ))
        result_masks = roof_masks

    result_masks.sort(key=lambda m: m.area, reverse=True)

    processing_time = (time.time() - t0) * 1000

    logger.info(
        f"Prompted segmented {orig_w}x{orig_h} ({res_w}x{res_h}): "
        f"{len(sam_masks)} raw -> {pre_filter_count} classified -> "
        f"{len(result_masks)} final in {processing_time:.0f}ms [backend={backend}]"
    )

    del sam_masks, image_resized
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
            "model_type": "sam2.1_prompted_segmentation",
            "inference_backend": backend,
            "inference_resolution": f"{res_w}x{res_h}",
            "prompt_points": len(scaled_points),
        },
        timing_breakdown=TimingBreakdown(total_ms=round(processing_time, 1)),
        filtered_masks_metadata=filtered_masks_metadata if filtered_masks_metadata else None,
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

    # Memory guard: check available RAM before loading MiDaS + running inference
    # MiDaS PyTorch model + SAM2 ONNX both in memory = ~800MB+ for models alone.
    # During inference, peak can hit 1.5-1.8GB. Reject if too low.
    mem_ok, mem_avail = _check_memory_guard(min_free_mb=300)
    if not mem_ok:
        logger.warning(f"Rejecting /depth request — only {mem_avail:.0f}MB available (need 300MB)")
        raise HTTPException(
            status_code=503,
            detail=f"Insufficient memory for depth inference ({mem_avail:.0f}MB available, need 300MB). Try again after current request completes.",
        )

    # Load MiDaS model if not already loaded (lazy load)
    if not MIDAS_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="MiDaS depth estimation is disabled (MIDAS_ENABLED=false)",
        )

    try:
        # Before loading MiDaS, try to free SAM2 ONNX encoder memory
        # to make room for the ~200MB MiDaS model. On Render Standard (2GB),
        # both models in memory simultaneously = ~600MB+ for weights alone.
        if _onnx_amg is not None:
            # Free ONNX encoder session internals — they'll be recreated
            # on next /segment call anyway (encoder is ~55MB)
            logger.info("Pre-loading MiDaS: forcing gc.collect() to free cached memory")
            gc.collect()

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

    # Log environment for debugging Pro deploy failures
    logger.info(f"=== ENVIRONMENT DUMP ===")
    logger.info(f"PORT={PORT}")
    logger.info(f"SAM2_INFERENCE_BACKEND={INFERENCE_BACKEND}")
    logger.info(f"SAM2_MAX_IMAGE_DIM={MAX_IMAGE_DIM}")
    logger.info(f"SAM2_POINTS_PER_SIDE={POINTS_PER_SIDE}")
    logger.info(f"IS_CPU={IS_CPU}")
    logger.info(f"DEVICE={DEVICE}")
    logger.info(f"PYTHONUNBUFFERED={os.environ.get('PYTHONUNBUFFERED', 'not set')}")
    logger.info(f"RENDER_SERVICE_ID={os.environ.get('RENDER_SERVICE_ID', 'not set')}")
    logger.info(f"RENDER_INSTANCE_ID={os.environ.get('RENDER_INSTANCE_ID', 'not set')}")
    logger.info(f"RENDER_ENVIRONMENT={os.environ.get('RENDER_ENVIRONMENT', 'not set')}")
    logger.info(f"WEB_CONCURRENCY={os.environ.get('WEB_CONCURRENCY', 'not set')}")
    logger.info(f"RENDER_WEB_CONCURRENCY={os.environ.get('RENDER_WEB_CONCURRENCY', 'not set')}")
    for key in sorted(os.environ):
        if key.startswith(('RENDER', 'PORT', 'SAM2', 'MIDAS', 'ONNX', 'WEB_CONCURRENCY')):
            logger.info(f"  ENV {key}={os.environ[key]}")
    logger.info(f"=== END ENVIRONMENT DUMP ===")

    # CRITICAL: Render auto-sets WEB_CONCURRENCY on Pro plan (e.g., "2" for 2 CPUs).
    # Uvicorn reads WEB_CONCURRENCY and sets config.workers = int(WEB_CONCURRENCY).
    # When workers > 1 AND app is passed as a callable object (not a string),
    # uvicorn prints "You must pass the application as an import string" and
    # calls sys.exit(1), which crashes the container on every deploy.
    #
    # Fix: Pass workers=1 explicitly (SAM2 ONNX uses too much RAM for multi-worker)
    #      AND pass app as import string "main:app" as belt-and-suspenders safety.

    # Override WEB_CONCURRENCY to prevent uvicorn from spawning multiple workers.
    # SAM2 ONNX inference is memory-intensive (~600MB+ per instance); multiple
    # workers would OOM on Render Pro (4GB RAM) with 2x model sessions.
    os.environ["WEB_CONCURRENCY"] = "1"

    try:
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=PORT,
            log_level="info",
            timeout_keep_alive=30,
            workers=1,
        )
    except SystemExit as e:
        # Re-raise SystemExit(0) cleanly (from uvicorn or signal)
        # For non-zero, let the entrypoint.sh handle the retry
        logger.info(f"uvicorn exiting with SystemExit({e.code})")
        raise
    except Exception as e:
        # Log the crash but let the process exit naturally
        # The entrypoint.sh wrapper will retry or keep container alive
        logger.error(f"uvicorn crashed: {e}")
        logger.error(traceback.format_exc())
        raise
