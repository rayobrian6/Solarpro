"""
Unit tests for the pure semantic-classifier override logic (classifier_logic.py).

Runs without torch/cv2/transformers — only numpy. Run:
    pip install numpy
    python -m pytest sam2-service/test_classifier_logic.py
or:
    python sam2-service/test_classifier_logic.py
"""

import numpy as np

from classifier_logic import (
    ADE_NAME_TO_SOLARPRO,
    normalize_ade_name,
    model_override_class_for_mask,
)

# A representative ADE20K id->label slice (real SegFormer/ADE ids).
ID2LABEL = {
    0: "wall",
    1: "building;edifice",
    2: "sky",
    4: "tree",
    9: "grass",
    13: "earth;ground",
    20: "car;auto;automobile;machine;motorcar",
    32: "fence;fencing",
    83: "truck;motortruck",
}


def _full_mask(label_map):
    return np.ones_like(label_map, dtype=bool)


def test_normalize_ade_name():
    assert normalize_ade_name("car;auto;automobile") == "car"
    assert normalize_ade_name("building;edifice") == "building"
    assert normalize_ade_name("earth;ground") == "earth"
    assert normalize_ade_name("  Sky ") == "sky"
    assert normalize_ade_name("") == ""


def test_sky_overrides_heuristic():
    # A uniform-sky mask -> "sky" (the overcast-sky-as-roof bug this fixes).
    lm = np.full((10, 10), 2, dtype=np.int32)  # all sky
    out = model_override_class_for_mask(_full_mask(lm), lm, ID2LABEL, 0.5)
    assert out == "sky"


def test_truck_overrides_to_truck_not_garage():
    lm = np.full((8, 8), 83, dtype=np.int32)  # truck
    assert model_override_class_for_mask(_full_mask(lm), lm, ID2LABEL, 0.5) == "truck"


def test_car_overrides():
    lm = np.full((8, 8), 20, dtype=np.int32)
    assert model_override_class_for_mask(_full_mask(lm), lm, ID2LABEL, 0.5) == "car"


def test_building_defers_to_heuristic():
    # ADE "building" is NOT mapped -> returns None so the geometry heuristic
    # decides roof vs wall.
    lm = np.full((8, 8), 1, dtype=np.int32)
    assert model_override_class_for_mask(_full_mask(lm), lm, ID2LABEL, 0.5) is None


def test_wall_overrides_to_wall():
    # ADE "wall" -> wall, fixing close-up wall photos mislabeled "roof".
    lm = np.full((8, 8), 0, dtype=np.int32)
    assert model_override_class_for_mask(_full_mask(lm), lm, ID2LABEL, 0.5) == "wall"


def test_low_agreement_defers():
    # Half sky, half building -> sky agreement 0.5 exactly passes; make it mixed
    # below threshold: 40% sky, 60% building -> top is building (not mapped) =>
    # None. Here test a 3-way split where top class is below min_agreement.
    lm = np.array([[2, 2, 1, 0]], dtype=np.int32)  # 50% sky, 25% building, 25% wall
    # min_agreement 0.6 -> top (sky 0.5) below threshold -> None
    assert model_override_class_for_mask(_full_mask(lm), lm, ID2LABEL, 0.6) is None
    # min_agreement 0.5 -> sky exactly meets -> "sky"
    assert model_override_class_for_mask(_full_mask(lm), lm, ID2LABEL, 0.5) == "sky"


def test_majority_vote_picks_dominant_class():
    # Mostly sky with a few tree pixels -> sky wins.
    lm = np.full((10, 10), 2, dtype=np.int32)
    lm[0, 0] = 4  # one tree pixel
    assert model_override_class_for_mask(_full_mask(lm), lm, ID2LABEL, 0.5) == "sky"


def test_mask_restricts_voting_region():
    # Top half sky, bottom half tree; a mask covering only the bottom -> tree.
    lm = np.zeros((10, 10), dtype=np.int32)
    lm[:5, :] = 2  # sky
    lm[5:, :] = 4  # tree
    mask = np.zeros((10, 10), dtype=bool)
    mask[5:, :] = True
    assert model_override_class_for_mask(mask, lm, ID2LABEL, 0.5) == "tree"


def test_shape_mismatch_returns_none():
    lm = np.full((10, 10), 2, dtype=np.int32)
    mask = np.ones((8, 8), dtype=bool)
    assert model_override_class_for_mask(mask, lm, ID2LABEL, 0.5) is None


def test_none_inputs_return_none():
    lm = np.full((4, 4), 2, dtype=np.int32)
    assert model_override_class_for_mask(None, lm, ID2LABEL, 0.5) is None
    assert model_override_class_for_mask(_full_mask(lm), None, ID2LABEL, 0.5) is None


def test_empty_mask_returns_none():
    lm = np.full((4, 4), 2, dtype=np.int32)
    mask = np.zeros((4, 4), dtype=bool)
    assert model_override_class_for_mask(mask, lm, ID2LABEL, 0.5) is None


def test_unmapped_label_returns_none():
    # An ADE id present in id2label but not in our override map (e.g. a class we
    # didn't list) -> None (defer to heuristic).
    id2 = {77: "ceiling"}
    lm = np.full((4, 4), 77, dtype=np.int32)
    assert model_override_class_for_mask(_full_mask(lm), lm, id2, 0.5) is None


def test_mapping_covers_key_confusions():
    # The classes the heuristic notoriously gets wrong must be mapped.
    for ade, expected in [("sky", "sky"), ("tree", "tree"), ("car", "car"),
                          ("truck", "truck"), ("grass", "grass")]:
        assert ADE_NAME_TO_SOLARPRO.get(ade) == expected
    # Ambiguous whole-structure labels must NOT be mapped (deferred so the
    # heuristic can split roof vs wall). "wall" IS mapped (reliable at pixel
    # level); "building"/"house"/"edifice" are not.
    for ade in ["building", "house", "edifice", "skyscraper"]:
        assert ade not in ADE_NAME_TO_SOLARPRO
    assert ADE_NAME_TO_SOLARPRO.get("wall") == "wall"


if __name__ == "__main__":
    import sys
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {fn.__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
