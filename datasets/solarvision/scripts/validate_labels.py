#!/usr/bin/env python3
"""
validate_labels.py
==================
Pre-training sanity check for YOLO label files.

Checks:
- Every image has a corresponding label file
- All label values are in valid range (0.0–1.0)
- Class IDs are within bounds (0–7)
- No duplicate detections at nearly the same position
- Reports class distribution

USAGE:
  python3 validate_labels.py
"""

import os
import argparse
from pathlib import Path
from collections import defaultdict

CLASSES = {
    0: 'vent', 1: 'skylight', 2: 'hvac_unit', 3: 'chimney',
    4: 'pipe', 5: 'meter', 6: 'main_panel', 7: 'disconnect'
}
NUM_CLASSES = 8


def validate_label_file(label_path: Path) -> list[str]:
    errors = []
    lines = label_path.read_text().strip().splitlines()
    
    if not lines or (len(lines) == 1 and lines[0] == ''):
        return []  # empty label = image with no objects (valid)

    seen_positions = []
    for i, line in enumerate(lines):
        parts = line.strip().split()
        if len(parts) != 5:
            errors.append(f"Line {i+1}: expected 5 values, got {len(parts)}: {line!r}")
            continue

        try:
            cls_id = int(parts[0])
            x, y, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
        except ValueError as e:
            errors.append(f"Line {i+1}: parse error: {e}")
            continue

        if cls_id < 0 or cls_id >= NUM_CLASSES:
            errors.append(f"Line {i+1}: invalid class_id {cls_id} (valid: 0–{NUM_CLASSES-1})")

        for val, name in [(x,'x'), (y,'y'), (w,'w'), (h,'h')]:
            if val < 0 or val > 1:
                errors.append(f"Line {i+1}: {name}={val:.4f} out of range [0,1]")

        if w < 0.005 or h < 0.005:
            errors.append(f"Line {i+1}: bbox too small (w={w:.4f}, h={h:.4f}) — possible labeling error")

        # Check for near-duplicate positions
        for prev_x, prev_y, prev_cls in seen_positions:
            if prev_cls == cls_id and abs(x - prev_x) < 0.02 and abs(y - prev_y) < 0.02:
                errors.append(f"Line {i+1}: possible duplicate detection at ({x:.3f},{y:.3f})")
        seen_positions.append((x, y, cls_id))

    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base_dir', default='..', help='Dataset root directory')
    args = parser.parse_args()

    base = Path(args.base_dir)
    splits = ['train', 'val']

    total_images = 0
    total_labels = 0
    total_errors = 0
    class_counts = defaultdict(int)
    missing_labels = []

    for split in splits:
        img_dir   = base / 'images' / split
        label_dir = base / 'labels' / split

        if not img_dir.exists():
            continue

        images = sorted(
            list(img_dir.glob('*.jpg')) +
            list(img_dir.glob('*.png')) +
            list(img_dir.glob('*.webp'))
        )

        print(f"\n── {split}: {len(images)} images ──────────────────────────────")

        for img_path in images:
            total_images += 1
            label_path = label_dir / (img_path.stem + '.txt')

            if not label_path.exists():
                missing_labels.append(str(img_path))
                print(f"  MISSING LABEL: {img_path.name}")
                continue

            total_labels += 1
            errors = validate_label_file(label_path)
            
            if errors:
                print(f"  ERRORS in {img_path.name}:")
                for err in errors:
                    print(f"    ✗ {err}")
                    total_errors += len(errors)
            
            # Count classes
            for line in label_path.read_text().strip().splitlines():
                parts = line.strip().split()
                if len(parts) == 5:
                    try:
                        class_counts[int(parts[0])] += 1
                    except ValueError:
                        pass

    print(f"\n── Summary ──────────────────────────────────────────────────")
    print(f"  Total images:        {total_images}")
    print(f"  Images with labels:  {total_labels}")
    print(f"  Missing labels:      {len(missing_labels)}")
    print(f"  Validation errors:   {total_errors}")

    print(f"\n── Class Distribution ───────────────────────────────────────")
    total_dets = sum(class_counts.values())
    for cls_id in range(NUM_CLASSES):
        count = class_counts.get(cls_id, 0)
        bar = '█' * min(40, int(count / max(1, total_dets) * 40))
        pct = count / max(1, total_dets) * 100
        print(f"  {cls_id} {CLASSES[cls_id]:<15} {count:4d}  {pct:5.1f}%  {bar}")

    if total_errors == 0 and len(missing_labels) == 0:
        print(f"\n✅ Dataset is valid — ready for training")
    else:
        print(f"\n⚠️  Fix {total_errors} errors and {len(missing_labels)} missing labels before training")

    return 0 if (total_errors == 0 and len(missing_labels) == 0) else 1


if __name__ == '__main__':
    exit(main())