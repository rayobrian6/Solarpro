#!/usr/bin/env python3
"""
split_dataset.py
================
Splits labeled images into train/val sets.

USAGE:
  python3 split_dataset.py --val_pct 0.2

Moves files from images/train → images/val and labels/train → labels/val.
"""

import os
import shutil
import random
import argparse
from pathlib import Path


def split_dataset(base_dir: Path, val_pct: float, seed: int = 42):
    train_img_dir   = base_dir / 'images' / 'train'
    val_img_dir     = base_dir / 'images' / 'val'
    train_label_dir = base_dir / 'labels' / 'train'
    val_label_dir   = base_dir / 'labels' / 'val'

    val_img_dir.mkdir(parents=True, exist_ok=True)
    val_label_dir.mkdir(parents=True, exist_ok=True)

    images = sorted(
        list(train_img_dir.glob('*.jpg')) +
        list(train_img_dir.glob('*.png')) +
        list(train_img_dir.glob('*.webp'))
    )

    if len(images) == 0:
        print("No images found in images/train/")
        return

    random.seed(seed)
    random.shuffle(images)
    val_count = max(1, int(len(images) * val_pct))
    val_images = images[:val_count]

    moved = 0
    skipped = 0
    for img_path in val_images:
        label_path = train_label_dir / (img_path.stem + '.txt')
        
        # Move image
        shutil.move(str(img_path), str(val_img_dir / img_path.name))
        
        # Move label if exists
        if label_path.exists():
            shutil.move(str(label_path), str(val_label_dir / label_path.name))
            moved += 1
        else:
            skipped += 1
            print(f"  WARNING: No label for {img_path.name}")

    print(f"Split complete: {len(images) - val_count} train, {val_count} val")
    print(f"Moved: {moved} image+label pairs, {skipped} images without labels")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base_dir', default='..', help='Dataset root')
    parser.add_argument('--val_pct',  default=0.2, type=float)
    parser.add_argument('--seed',     default=42,  type=int)
    args = parser.parse_args()

    split_dataset(Path(args.base_dir), args.val_pct, args.seed)


if __name__ == '__main__':
    main()