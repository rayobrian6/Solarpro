# SolarVision Dataset — Labeling Guide

## Overview

This guide explains how to label survey photos for the SolarVision YOLOv8 model.
Labels are used to train the model to detect roof obstructions and electrical
components in site survey photos.

**Goal:** 30–100 labeled images minimum before first training run.
**Format:** YOLO v8 (normalized bounding boxes)
**Tool:** LabelImg (free, local, no account required)

---

## Setup

```bash
pip install labelImg
labelImg
```

In LabelImg:
1. Click **Open Dir** → select `datasets/solarvision/images/train/`
2. Click **Change Save Dir** → select `datasets/solarvision/labels/train/`
3. Set format to **YOLO** (View → YOLO format or the format button)
4. Load classes: Edit → Edit Labels → paste from `classes.txt`

---

## Class Definitions

| ID | Class | What it looks like | Typical location |
|----|-------|--------------------|-----------------|
| 0 | `vent` | Round metal flashing, pipe sticking up | Scattered on roof surface |
| 1 | `skylight` | Rectangular glass panel flush with roof | Mid-roof |
| 2 | `hvac_unit` | Large metal box, often with pipes/wiring | Flat sections, lower roof |
| 3 | `chimney` | Brick or metal vertical stack | Upper roof, near ridge |
| 4 | `pipe` | Metal pipe jack / soil stack with rubber boot | Scattered, small |
| 5 | `meter` | Round or square utility meter box on wall | Exterior wall, lower half |
| 6 | `main_panel` | Metal electrical panel box, breakers inside | Exterior wall or garage |
| 7 | `disconnect` | Small metal box near meter or panel | Wall-mounted, near panel |

---

## Labeling Rules

### DO:
- Draw boxes **tight** around the object (not loose)
- Label every visible instance, even partial ones (≥50% visible)
- Label from multiple angles and distances
- Include objects in shade, shadow, glare
- Label objects at the edge of the frame if identifiable

### DON'T:
- Don't label objects you're not confident about (confidence < 80%)
- Don't label objects that are less than 10×10 pixels in the image
- Don't include shadow as part of the bounding box
- Don't label the same object twice from different photos in the same pass

### Edge cases:
- **Multiple vents close together:** label each separately
- **Panel door open:** label the panel box, not the door
- **HVAC with piping:** label only the main unit body
- **Chimney at angle:** label the visible portion only

---

## Photo Collection Tips

Survey photos that work best for training:
- Taken from ground level (inspector's perspective)
- Include the whole object in frame
- Good lighting (not backlit)
- Multiple angles of the same object

Photo categories to collect:
- Roof overview photos (best for vent, skylight, hvac, chimney)
- Electrical photos (best for meter, main_panel, disconnect)
- Closeup photos (best for pipe, vent detail)

---

## Workflow

```
For each image:
  1. Open in LabelImg
  2. Draw box around each visible object
  3. Assign correct class label
  4. Save (Ctrl+S)
  5. Next image (D key)
```

---

## Validation Split

After labeling, split ~20% of images to validation:
```bash
python3 scripts/split_dataset.py --val_pct 0.2
```

---

## Quality Check

Before training, verify:
- [ ] Every label file exists for every image
- [ ] No empty label files (unless image truly has no objects)
- [ ] Class distribution is reasonable (not all one class)
- [ ] Boxes are tight and correctly assigned

```bash
python3 scripts/validate_labels.py
```

---

## Training Trigger

Once 30+ images are labeled:
```bash
cd services/vision
python3 train.py
```

Model outputs to: `services/vision/runs/train/solarvision/weights/best.pt`
Copy to: `services/vision/models/solarvision.pt`