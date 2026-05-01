#!/usr/bin/env python3
"""
services/vision/validate.py
---------------------------
Post-training validation for the SolarVision YOLOv8 model.

Usage:
    python3 validate.py
    python3 validate.py --model models/solarvision.pt --data ../../datasets/solarvision/dataset.yaml
    python3 validate.py --model models/solarvision.pt --save-json

Outputs:
    - Console: mAP50, mAP50-95, per-class precision / recall / F1
    - File:    models/validation_results.json  (if --save-json)
    - File:    models/validation_results_<timestamp>.json (timestamped copy)

Exit codes:
    0  validation passed (mAP50 >= MIN_MAP50_THRESHOLD)
    1  validation failed or error occurred
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# ─── thresholds ────────────────────────────────────────────────────────────────
MIN_MAP50_THRESHOLD   = 0.40   # minimum acceptable mAP@0.50 to "pass"
WARN_MAP50_THRESHOLD  = 0.60   # warn if below this but above minimum
TARGET_MAP50          = 0.75   # production-ready target

CLASS_NAMES = [
    "vent", "skylight", "hvac_unit", "chimney",
    "pipe", "meter", "main_panel", "disconnect",
]

# ─── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent.resolve()
DEFAULT_MODEL = SCRIPT_DIR / "models" / "solarvision.pt"
DEFAULT_DATA  = SCRIPT_DIR / ".." / ".." / "datasets" / "solarvision" / "dataset.yaml"


# ═══════════════════════════════════════════════════════════════════════════════
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Validate SolarVision YOLOv8 model and emit metrics JSON"
    )
    p.add_argument("--model",     default=str(DEFAULT_MODEL),
                   help="Path to .pt checkpoint (default: models/solarvision.pt)")
    p.add_argument("--data",      default=str(DEFAULT_DATA),
                   help="Path to dataset.yaml")
    p.add_argument("--imgsz",     type=int, default=640,
                   help="Inference image size (default: 640)")
    p.add_argument("--batch",     type=int, default=16,
                   help="Batch size (default: 16)")
    p.add_argument("--conf",      type=float, default=0.25,
                   help="Confidence threshold for validation (default: 0.25)")
    p.add_argument("--iou",       type=float, default=0.50,
                   help="IoU threshold for NMS (default: 0.50)")
    p.add_argument("--split",     default="val", choices=["train", "val", "test"],
                   help="Dataset split to evaluate on (default: val)")
    p.add_argument("--save-json", action="store_true",
                   help="Save results to models/validation_results.json")
    p.add_argument("--verbose",   action="store_true",
                   help="Print per-image details")
    return p.parse_args()


# ═══════════════════════════════════════════════════════════════════════════════
def check_model_exists(model_path: str) -> bool:
    """Return True if the model file exists; print helpful hint if not."""
    p = Path(model_path)
    if p.exists():
        return True

    print(f"\n[VALIDATE] ✗ Model not found: {model_path}")
    print("[VALIDATE]   Run train.py first, or pass --model path/to/checkpoint.pt")

    # look for any .pt in models/ as a hint
    models_dir = SCRIPT_DIR / "models"
    if models_dir.exists():
        pts = list(models_dir.glob("*.pt"))
        if pts:
            print(f"[VALIDATE]   Found checkpoints in models/: {[p.name for p in pts]}")
    return False


# ═══════════════════════════════════════════════════════════════════════════════
def run_validation(args: argparse.Namespace) -> dict:
    """
    Run YOLOv8 validation and return a structured results dict.
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[VALIDATE] ✗ ultralytics not installed.")
        print("[VALIDATE]   Run: pip install ultralytics")
        sys.exit(1)

    print(f"\n{'═'*60}")
    print("  SolarVision — YOLOv8 Validation")
    print(f"{'═'*60}")
    print(f"  Model  : {args.model}")
    print(f"  Data   : {args.data}")
    print(f"  Split  : {args.split}")
    print(f"  ImgSz  : {args.imgsz}")
    print(f"  Conf   : {args.conf}")
    print(f"  IoU    : {args.iou}")
    print(f"{'═'*60}\n")

    model = YOLO(args.model)

    metrics = model.val(
        data=str(args.data),
        imgsz=args.imgsz,
        batch=args.batch,
        conf=args.conf,
        iou=args.iou,
        split=args.split,
        verbose=args.verbose,
    )

    # ── extract scalar metrics ──────────────────────────────────────────────
    map50     = float(metrics.box.map50)       # mAP@0.50
    map50_95  = float(metrics.box.map)         # mAP@0.50:0.95
    precision = float(metrics.box.mp)          # mean precision
    recall    = float(metrics.box.mr)          # mean recall
    f1        = 2 * precision * recall / max(precision + recall, 1e-9)

    # ── per-class metrics ───────────────────────────────────────────────────
    per_class = []
    if hasattr(metrics.box, "ap_class_index") and metrics.box.ap_class_index is not None:
        for i, cls_idx in enumerate(metrics.box.ap_class_index):
            cls_name = CLASS_NAMES[cls_idx] if cls_idx < len(CLASS_NAMES) else f"cls_{cls_idx}"
            per_class.append({
                "class_id"  : int(cls_idx),
                "class_name": cls_name,
                "ap50"      : float(metrics.box.ap50[i]),
                "ap50_95"   : float(metrics.box.ap[i]),
            })

    # ── build result dict ───────────────────────────────────────────────────
    result = {
        "timestamp"       : datetime.now(timezone.utc).isoformat(),
        "model"           : str(args.model),
        "data"            : str(args.data),
        "split"           : args.split,
        "imgsz"           : args.imgsz,
        "conf_threshold"  : args.conf,
        "iou_threshold"   : args.iou,
        "metrics": {
            "mAP50"       : round(map50,    4),
            "mAP50_95"    : round(map50_95, 4),
            "precision"   : round(precision, 4),
            "recall"      : round(recall,   4),
            "f1"          : round(f1,       4),
        },
        "per_class"       : per_class,
        "thresholds": {
            "minimum_map50" : MIN_MAP50_THRESHOLD,
            "warn_map50"    : WARN_MAP50_THRESHOLD,
            "target_map50"  : TARGET_MAP50,
        },
    }

    return result


# ═══════════════════════════════════════════════════════════════════════════════
def print_summary(result: dict) -> None:
    m = result["metrics"]
    print(f"\n{'─'*60}")
    print("  VALIDATION RESULTS")
    print(f"{'─'*60}")
    print(f"  mAP@0.50        : {m['mAP50']:.4f}")
    print(f"  mAP@0.50:0.95   : {m['mAP50_95']:.4f}")
    print(f"  Mean Precision  : {m['precision']:.4f}")
    print(f"  Mean Recall     : {m['recall']:.4f}")
    print(f"  F1 Score        : {m['f1']:.4f}")
    print(f"{'─'*60}")

    # per-class table
    if result.get("per_class"):
        print(f"  {'Class':<16} {'AP50':>8} {'AP50-95':>10}")
        print(f"  {'─'*16} {'─'*8} {'─'*10}")
        for pc in result["per_class"]:
            print(f"  {pc['class_name']:<16} {pc['ap50']:>8.4f} {pc['ap50_95']:>10.4f}")
        print(f"{'─'*60}")

    # verdict
    map50 = m["mAP50"]
    if map50 >= TARGET_MAP50:
        verdict = f"✓ PRODUCTION READY  (mAP50={map50:.3f} ≥ {TARGET_MAP50})"
        status  = "PASS"
    elif map50 >= WARN_MAP50_THRESHOLD:
        verdict = f"~ ACCEPTABLE        (mAP50={map50:.3f} ≥ {WARN_MAP50_THRESHOLD}, target {TARGET_MAP50})"
        status  = "WARN"
    elif map50 >= MIN_MAP50_THRESHOLD:
        verdict = f"⚠ BELOW TARGET      (mAP50={map50:.3f} ≥ {MIN_MAP50_THRESHOLD}, needs more data/epochs)"
        status  = "WARN"
    else:
        verdict = f"✗ FAILED            (mAP50={map50:.3f} < minimum {MIN_MAP50_THRESHOLD})"
        status  = "FAIL"

    print(f"\n  STATUS: {verdict}")
    print(f"{'═'*60}\n")
    result["status"] = status


# ═══════════════════════════════════════════════════════════════════════════════
def save_results(result: dict, base_path: Path) -> None:
    base_path.parent.mkdir(parents=True, exist_ok=True)

    # write canonical path
    with open(base_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"[VALIDATE] Saved → {base_path}")

    # write timestamped copy
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    tsf = base_path.parent / f"validation_results_{ts}.json"
    with open(tsf, "w") as f:
        json.dump(result, f, indent=2)
    print(f"[VALIDATE] Saved → {tsf}")


# ═══════════════════════════════════════════════════════════════════════════════
def main() -> int:
    args = parse_args()

    if not check_model_exists(args.model):
        return 1

    data_path = Path(args.data)
    if not data_path.exists():
        print(f"[VALIDATE] ✗ dataset.yaml not found: {args.data}")
        return 1

    result = run_validation(args)
    print_summary(result)

    if args.save_json:
        out_path = SCRIPT_DIR / "models" / "validation_results.json"
        save_results(result, out_path)

    status = result.get("status", "FAIL")
    return 0 if status in ("PASS", "WARN") else 1


# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    sys.exit(main())