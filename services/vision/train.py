#!/usr/bin/env python3
"""
train.py — SolarVision YOLOv8 Training Script
==============================================

Trains a YOLOv8n (nano) model on the SolarVision dataset.
YOLOv8n is chosen for:
  - Fastest inference (runs on CPU if no GPU available)
  - Smallest model size (~6MB)
  - Still accurate enough for large objects (vents, skylights, panels)

USAGE:
  cd services/vision
  python3 train.py

  # Custom options:
  python3 train.py --epochs 100 --imgsz 640 --batch 16 --model yolov8s.pt

MODEL SIZES (in order of accuracy vs speed):
  yolov8n.pt  — nano   (fastest, use this first)
  yolov8s.pt  — small  (good balance)
  yolov8m.pt  — medium (more accurate, needs GPU)
  yolov8l.pt  — large  (high accuracy, GPU required)

OUTPUT:
  runs/train/solarvision/weights/best.pt    ← best checkpoint
  runs/train/solarvision/weights/last.pt    ← final checkpoint
  runs/train/solarvision/results.csv        ← training metrics
  runs/train/solarvision/confusion_matrix.png

After training:
  cp runs/train/solarvision/weights/best.pt models/solarvision.pt
"""

import os
import sys
import argparse
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='Train SolarVision YOLOv8 model')
    parser.add_argument('--model',   default='yolov8n.pt', help='Base model (yolov8n.pt, yolov8s.pt, yolov8m.pt)')
    parser.add_argument('--epochs',  default=50,  type=int,   help='Training epochs')
    parser.add_argument('--imgsz',   default=640, type=int,   help='Input image size (pixels)')
    parser.add_argument('--batch',   default=16,  type=int,   help='Batch size (-1 for auto)')
    parser.add_argument('--device',  default='',  help='Device: cpu, 0, 0,1 (empty=auto)')
    parser.add_argument('--workers', default=4,   type=int,   help='DataLoader workers')
    parser.add_argument('--patience',default=20,  type=int,   help='Early stopping patience')
    parser.add_argument('--resume',  action='store_true',     help='Resume from last checkpoint')
    parser.add_argument('--data',    default=None, help='Override dataset.yaml path')
    args = parser.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print("ERROR: ultralytics not installed")
        print("Run: pip install ultralytics")
        sys.exit(1)

    # ── Resolve dataset path ─────────────────────────────────────────────────
    script_dir  = Path(__file__).parent
    repo_root   = script_dir.parent.parent
    dataset_yaml = args.data or str(repo_root / 'datasets' / 'solarvision' / 'dataset.yaml')

    if not Path(dataset_yaml).exists():
        print(f"ERROR: dataset.yaml not found at {dataset_yaml}")
        print("Create the dataset first: python3 datasets/solarvision/scripts/generate_synthetic_labels.py")
        sys.exit(1)

    # ── Model output dir ─────────────────────────────────────────────────────
    runs_dir = script_dir / 'runs' / 'train'
    runs_dir.mkdir(parents=True, exist_ok=True)

    models_dir = script_dir / 'models'
    models_dir.mkdir(parents=True, exist_ok=True)

    print(f"""
╔══════════════════════════════════════════════════════════╗
║         SolarVision YOLOv8 Training                      ║
╠══════════════════════════════════════════════════════════╣
║  Base model : {args.model:<44}║
║  Dataset    : {str(dataset_yaml)[-44:]:<44}║
║  Epochs     : {args.epochs:<44}║
║  Image size : {args.imgsz:<44}║
║  Batch size : {args.batch:<44}║
║  Device     : {(args.device or 'auto'):<44}║
╚══════════════════════════════════════════════════════════╝
""")

    # ── Load model ───────────────────────────────────────────────────────────
    if args.resume:
        last_ckpt = runs_dir / 'solarvision' / 'weights' / 'last.pt'
        if last_ckpt.exists():
            print(f"Resuming from {last_ckpt}")
            model = YOLO(str(last_ckpt))
        else:
            print(f"No checkpoint found at {last_ckpt} — starting fresh")
            model = YOLO(args.model)
    else:
        model = YOLO(args.model)

    # ── Train ────────────────────────────────────────────────────────────────
    results = model.train(
        data      = dataset_yaml,
        epochs    = args.epochs,
        imgsz     = args.imgsz,
        batch     = args.batch,
        device    = args.device or None,
        workers   = args.workers,
        patience  = args.patience,
        project   = str(runs_dir),
        name      = 'solarvision',
        exist_ok  = args.resume,
        # Augmentation (good for survey photos with varied lighting)
        hsv_h     = 0.015,   # hue augmentation (lighting variation)
        hsv_s     = 0.7,     # saturation augmentation
        hsv_v     = 0.4,     # brightness/value augmentation
        flipud    = 0.0,     # no vertical flip (roof photos are oriented)
        fliplr    = 0.5,     # horizontal flip OK (left/right symmetric)
        mosaic    = 1.0,     # mosaic augmentation (combine 4 images)
        mixup     = 0.1,     # mixup augmentation
        # Optimizer
        optimizer = 'AdamW',
        lr0       = 0.001,
        lrf       = 0.01,
        weight_decay = 0.0005,
        # Logging
        verbose   = True,
        save      = True,
        save_period = 10,    # save checkpoint every 10 epochs
    )

    # ── Copy best model to models/ ───────────────────────────────────────────
    best_ckpt = runs_dir / 'solarvision' / 'weights' / 'best.pt'
    output_model = models_dir / 'solarvision.pt'

    if best_ckpt.exists():
        shutil.copy2(str(best_ckpt), str(output_model))
        print(f"\n✅ Training complete!")
        print(f"   Best model: {output_model}")
        print(f"   mAP50:      {results.results_dict.get('metrics/mAP50(B)', 'N/A')}")
        print(f"   mAP50-95:   {results.results_dict.get('metrics/mAP50-95(B)', 'N/A')}")
        print(f"\nNext step: restart the inference server to load new model")
        print(f"  kill $(cat /tmp/vision_server.pid)")
        print(f"  python3 server.py &")
    else:
        print(f"\n⚠️  Training complete but best.pt not found at {best_ckpt}")
        print(f"   Check runs/train/solarvision/ for output files")


if __name__ == '__main__':
    main()