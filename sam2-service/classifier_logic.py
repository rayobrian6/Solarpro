"""
Pure (model-free) classification logic for the SAM2 service.

Separated from main.py so it can be unit-tested without importing torch, cv2,
sam2, or transformers. main.py imports these symbols and wires them into the
/segment and /segment_prompted endpoints.

The semantic classifier produces an ADE20K per-pixel label map; each SAM2 mask
is majority-voted against it. When the winning ADE20K label is one the geometry
heuristic reliably gets wrong (sky, vehicles, vegetation, ground, fences,
windows, ...), the model class OVERRIDES the heuristic. ADE20K structure labels
(building/wall/house/...) are intentionally NOT mapped here, so roof-vs-wall is
left to the geometry heuristic (classify_mask_region in main.py).
"""

from __future__ import annotations

import numpy as np


# ADE20K label (first token, lowercased) -> SolarPro SegmentationClass.
# Only the classes the model should AUTHORITATIVELY override the heuristic on.
# Structure labels (building/wall/house/edifice/skyscraper/hovel) are absent on
# purpose — defer those to the geometry heuristic for the roof-vs-wall split.
ADE_NAME_TO_SOLARPRO: dict[str, str] = {
    "sky": "sky",
    # SegFormer reliably labels vertical wall surfaces as "wall" at the pixel
    # level. Mapping it fixes close-up wall photos that the position heuristic
    # mislabels as "roof". The ambiguous whole-structure labels (building, house,
    # edifice, skyscraper) are intentionally NOT mapped, so real roofs reach the
    # geometry heuristic's roof-vs-wall split.
    "wall": "wall",
    "tree": "tree",
    "palm": "tree",
    "plant": "bushes",
    "flower": "bushes",
    "grass": "grass",
    "field": "grass",
    "car": "car",
    "truck": "truck",
    "van": "truck",
    "bus": "truck",
    "minibike": "obstruction",
    "motorbike": "obstruction",
    "bicycle": "obstruction",
    "person": "person",
    "road": "driveway",
    "runway": "driveway",
    "sidewalk": "sidewalk",
    "earth": "ground",
    "sand": "ground",
    "dirt": "ground",
    "path": "ground",
    "fence": "fence",
    "ashcan": "trash_can",
    "windowpane": "window",
    "window": "window",
    "door": "door",
    "pole": "obstruction",
    "streetlight": "obstruction",
    "signboard": "obstruction",
    "water": "unknown",
    "river": "unknown",
    "lake": "unknown",
}


def normalize_ade_name(name: str) -> str:
    """ADE20K labels look like 'car;auto;automobile' or 'building;edifice' —
    take the first token, lowercased and stripped."""
    if not name:
        return ""
    return name.replace(";", ",").split(",")[0].strip().lower()


def model_override_class_for_mask(
    mask_binary,
    label_map,
    id2label: dict,
    min_agreement: float,
) -> str | None:
    """Majority-vote the semantic label map over a mask's pixels.

    Returns the mapped SolarPro class IFF:
      (a) the mask has pixels and matches the label-map shape,
      (b) the top label's pixel agreement >= min_agreement, AND
      (c) the ADE20K label is in ADE_NAME_TO_SOLARPRO (a trusted override).
    Otherwise returns None and the caller defers to the geometry heuristic.

    Pure function — no model required, fully unit-testable.
    """
    if label_map is None or mask_binary is None:
        return None
    m = np.asarray(mask_binary).astype(bool)
    label_map = np.asarray(label_map)
    if m.shape != label_map.shape:
        return None
    pixels = label_map[m]
    if pixels.size == 0:
        return None
    vals, counts = np.unique(pixels, return_counts=True)
    i = int(counts.argmax())
    top_id = int(vals[i])
    agreement = float(counts[i]) / float(pixels.size)
    if agreement < min_agreement:
        return None
    name = id2label.get(top_id)
    if name is None:
        name = id2label.get(str(top_id))  # tolerate string keys
    if not name:
        return None
    return ADE_NAME_TO_SOLARPRO.get(normalize_ade_name(name))
