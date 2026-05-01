#!/usr/bin/env python3
"""
services/vision/infer.py
------------------------
Core YOLOv8 inference function for SolarVision.

Accepts an image URL or local file path, runs the loaded YOLO model,
and returns a list of detection dicts that match the VisionDetection
TypeScript interface in lib/vision/types.ts.

Detection shape returned (mirrors VisionDetection in types.ts):
    {
        "type"      : str,    # class name, e.g. "vent", "hvac_unit"
        "classId"   : int,    # 0-7
        "bbox"      : {       # normalised 0-1
            "x"     : float,  # left edge
            "y"     : float,  # top edge
            "width" : float,
            "height": float,
        },
        "bboxPixels": {       # absolute pixels
            "x"     : int,
            "y"     : int,
            "width" : int,
            "height": int,
        },
        "confidence": float,  # 0-1
        "imageWidth" : int,
        "imageHeight": int,
    }

Usage (standalone):
    python3 infer.py --image https://example.com/roof.jpg
    python3 infer.py --image /path/to/local/roof.jpg --model models/solarvision.pt
    python3 infer.py --image roof.jpg --conf 0.35 --json
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

# ─── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [INFER] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("solarvision.infer")

# ─── constants ─────────────────────────────────────────────────────────────────
CLASS_NAMES: list[str] = [
    "vent",       # 0
    "skylight",   # 1
    "hvac_unit",  # 2
    "chimney",    # 3
    "pipe",       # 4
    "meter",      # 5
    "main_panel", # 6
    "disconnect", # 7
]

SCRIPT_DIR     = Path(__file__).parent.resolve()
DEFAULT_MODEL  = SCRIPT_DIR / "models" / "solarvision.pt"
FALLBACK_MODEL = "yolov8n.pt"  # downloads pretrained nano if no custom checkpoint

DEFAULT_CONF    = float(os.getenv("VISION_CONF_THRESHOLD", "0.25"))
DEFAULT_IOU     = float(os.getenv("VISION_IOU_THRESHOLD",  "0.45"))
MAX_IMAGE_BYTES = 20 * 1024 * 1024   # 20 MB
DOWNLOAD_TIMEOUT_S = 15

# ─── module-level model cache ───────────────────────────────────────────────────
# The FastAPI server calls load_model() once at startup; subsequent calls hit cache.
_cached_model: Any = None
_cached_model_path: str = ""


# ═══════════════════════════════════════════════════════════════════════════════
# Model loading
# ═══════════════════════════════════════════════════════════════════════════════

def load_model(model_path: str | None = None) -> Any:
    """
    Load (or return cached) YOLOv8 model.

    Priority:
        1. model_path argument
        2. VISION_MODEL_PATH env var
        3. models/solarvision.pt  (trained custom checkpoint)
        4. yolov8n.pt             (pretrained fallback — downloads on first run)
    """
    global _cached_model, _cached_model_path

    # resolve path
    resolved = (
        model_path
        or os.getenv("VISION_MODEL_PATH")
        or (str(DEFAULT_MODEL) if DEFAULT_MODEL.exists() else FALLBACK_MODEL)
    )

    if _cached_model is not None and _cached_model_path == resolved:
        return _cached_model

    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError:
        log.error("ultralytics not installed — run: pip install ultralytics")
        raise

    log.info("Loading model: %s", resolved)
    t0 = time.perf_counter()
    model = YOLO(resolved)
    elapsed = time.perf_counter() - t0
    log.info("Model loaded in %.2fs", elapsed)

    _cached_model      = model
    _cached_model_path = resolved
    return model


# ═══════════════════════════════════════════════════════════════════════════════
# Image loading
# ═══════════════════════════════════════════════════════════════════════════════

def _load_image_from_url(url: str) -> "np.ndarray":  # type: ignore[name-defined]
    """Download image from URL → numpy array (BGR, uint8)."""
    import numpy as np
    import cv2  # type: ignore

    log.info("Downloading image: %s", url)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "SolarVision/1.0"},
    )
    with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_S) as resp:
        data = resp.read(MAX_IMAGE_BYTES)

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Could not decode image from URL: {url}")
    log.info("Downloaded image shape: %s", img.shape)
    return img


def _load_image_from_path(path: str) -> "np.ndarray":  # type: ignore[name-defined]
    """Load image from local filesystem → numpy array (BGR, uint8)."""
    import cv2  # type: ignore

    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(f"Image not found or unreadable: {path}")
    log.info("Loaded local image shape: %s", img.shape)
    return img


def load_image(source: str) -> "np.ndarray":  # type: ignore[name-defined]
    """Load image from URL or local path."""
    if source.startswith("http://") or source.startswith("https://"):
        return _load_image_from_url(source)
    return _load_image_from_path(source)


# ═══════════════════════════════════════════════════════════════════════════════
# Detection formatting
# ═══════════════════════════════════════════════════════════════════════════════

def _box_to_dict(
    xyxy:       list[float],
    confidence: float,
    class_id:   int,
    img_w:      int,
    img_h:      int,
) -> dict:
    """
    Convert YOLO xyxy absolute box → normalised + pixel VisionDetection dict.
    """
    x1, y1, x2, y2 = xyxy
    px = int(round(x1))
    py = int(round(y1))
    pw = int(round(x2 - x1))
    ph = int(round(y2 - y1))

    class_name = CLASS_NAMES[class_id] if class_id < len(CLASS_NAMES) else f"cls_{class_id}"

    return {
        "type"       : class_name,
        "classId"    : class_id,
        "bbox": {
            "x"      : round(x1 / img_w, 6),
            "y"      : round(y1 / img_h, 6),
            "width"  : round((x2 - x1) / img_w, 6),
            "height" : round((y2 - y1) / img_h, 6),
        },
        "bboxPixels": {
            "x"      : px,
            "y"      : py,
            "width"  : pw,
            "height" : ph,
        },
        "confidence" : round(float(confidence), 6),
        "imageWidth" : img_w,
        "imageHeight": img_h,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Main inference entry point
# ═══════════════════════════════════════════════════════════════════════════════

def run_inference(
    image_source: str,
    model_path:   str | None = None,
    conf:         float = DEFAULT_CONF,
    iou:          float = DEFAULT_IOU,
) -> dict:
    """
    Run YOLOv8 inference on an image URL or local path.

    Returns:
        {
            "source"    : str,
            "modelPath" : str,
            "imageWidth": int,
            "imageHeight": int,
            "inferenceMs": float,
            "detectionCount": int,
            "detections": [ VisionDetection, ... ]
        }

    Raises:
        RuntimeError  if model fails to load
        ValueError    if image cannot be decoded
        FileNotFoundError if local path not found
    """
    model = load_model(model_path)

    img = load_image(image_source)
    img_h, img_w = img.shape[:2]

    log.info("Running inference: conf=%.2f  iou=%.2f  size=%dx%d", conf, iou, img_w, img_h)
    t0 = time.perf_counter()

    results = model.predict(
        source=img,
        conf=conf,
        iou=iou,
        verbose=False,
    )

    inference_ms = round((time.perf_counter() - t0) * 1000, 1)
    log.info("Inference done in %.1f ms", inference_ms)

    detections: list[dict] = []

    for r in results:
        if r.boxes is None:
            continue
        boxes = r.boxes
        for i in range(len(boxes)):
            xyxy       = boxes.xyxy[i].tolist()
            confidence = float(boxes.conf[i])
            class_id   = int(boxes.cls[i])
            det = _box_to_dict(xyxy, confidence, class_id, img_w, img_h)
            detections.append(det)
            log.debug(
                "  [%s] conf=%.3f  bbox=(%d,%d,%d,%d)",
                det["type"], confidence,
                det["bboxPixels"]["x"], det["bboxPixels"]["y"],
                det["bboxPixels"]["width"], det["bboxPixels"]["height"],
            )

    log.info("Detections: %d total", len(detections))

    return {
        "source"         : image_source,
        "modelPath"      : _cached_model_path,
        "imageWidth"     : img_w,
        "imageHeight"    : img_h,
        "inferenceMs"    : inference_ms,
        "detectionCount" : len(detections),
        "detections"     : detections,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CLI entry point
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="SolarVision YOLOv8 inference")
    p.add_argument("--image",  required=True,
                   help="Image URL or local file path")
    p.add_argument("--model",  default=None,
                   help="Path to .pt checkpoint (default: auto-detect)")
    p.add_argument("--conf",   type=float, default=DEFAULT_CONF,
                   help=f"Confidence threshold (default: {DEFAULT_CONF})")
    p.add_argument("--iou",    type=float, default=DEFAULT_IOU,
                   help=f"IoU NMS threshold (default: {DEFAULT_IOU})")
    p.add_argument("--json",   action="store_true",
                   help="Print results as JSON")
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        result = run_inference(
            image_source=args.image,
            model_path=args.model,
            conf=args.conf,
            iou=args.iou,
        )
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"\nImage     : {result['source']}")
            print(f"Size      : {result['imageWidth']}x{result['imageHeight']}")
            print(f"Inference : {result['inferenceMs']} ms")
            print(f"Detections: {result['detectionCount']}")
            for d in result["detections"]:
                bp = d["bboxPixels"]
                print(
                    f"  [{d['type']:12s}]  conf={d['confidence']:.3f}"
                    f"  px=({bp['x']},{bp['y']},{bp['width']}x{bp['height']})"
                )
        return 0
    except Exception as exc:
        log.error("Inference failed: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())