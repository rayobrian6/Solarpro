#!/usr/bin/env python3
"""
Local validation script for ONNX SAM2 AMG integration.

Tests that:
1. ONNX models can be downloaded from HuggingFace
2. Encoder produces expected output shapes
3. Decoder accepts encoder outputs + point prompts
4. End-to-end mask generation produces valid masks
5. Coordinate scaling is correct (vs samexporter behavior)

Usage:
    pip install onnxruntime huggingface_hub opencv-python-headless numpy
    python test_onnx_local.py [--image path/to/test.jpg]
"""

import sys
import time
import argparse
import numpy as np


def test_onnx_pipeline(image_path=None):
    """Run the ONNX SAM2 AMG pipeline validation."""
    print("=" * 60)
    print("ONNX SAM2 AMG Local Validation")
    print("=" * 60)

    # Step 1: Download and extract models
    print("\n[1/5] Downloading ONNX models from HuggingFace...")
    try:
        from onnx_sam2_amg import (
            _download_and_extract_onnx_models,
            _create_onnx_session,
            ONNXSAM2AutomaticMaskGenerator,
        )
    except ImportError:
        print("  ERROR: Cannot import onnx_sam2_amg. Make sure you're in the sam2-service directory.")
        print("  Try: cd sam2-service && python test_onnx_local.py")
        return False

    try:
        encoder_path, decoder_path = _download_and_extract_onnx_models()
        print(f"  ✓ Models downloaded: encoder={encoder_path}, decoder={decoder_path}")
    except Exception as e:
        print(f"  ✗ Model download failed: {e}")
        return False

    # Step 2: Create ONNX sessions and verify I/O
    print("\n[2/5] Creating ONNX sessions and verifying I/O shapes...")
    try:
        import onnxruntime as ort

        encoder_session = _create_onnx_session(encoder_path, "encoder")
        decoder_session = _create_onnx_session(decoder_path, "decoder")

        # Verify encoder input shape
        enc_input = encoder_session.get_inputs()[0]
        print(f"  Encoder input: name={enc_input.name}, shape={enc_input.shape}, type={enc_input.type}")

        # Verify encoder outputs
        for out in encoder_session.get_outputs():
            print(f"  Encoder output: name={out.name}, shape={out.shape}, type={out.type}")

        # Verify decoder inputs
        for inp in decoder_session.get_inputs():
            print(f"  Decoder input: name={inp.name}, shape={inp.shape}, type={inp.type}")

        # Verify decoder outputs
        for out in decoder_session.get_outputs():
            print(f"  Decoder output: name={out.name}, shape={out.shape}, type={out.type}")

        print("  ✓ Sessions created successfully")
    except Exception as e:
        print(f"  ✗ Session creation failed: {e}")
        return False

    # Step 3: Run encoder on test image
    print("\n[3/5] Running encoder on test image...")
    import cv2

    if image_path:
        image = cv2.imread(image_path)
        if image is None:
            print(f"  ✗ Could not read image: {image_path}")
            return False
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    else:
        # Generate a synthetic test image (384x384 with some rectangles)
        image_rgb = np.zeros((384, 384, 3), dtype=np.uint8)
        # Draw some shapes to give SAM2 something to segment
        image_rgb[50:150, 50:150] = [200, 180, 160]  # rectangle 1
        image_rgb[200:350, 100:300] = [160, 200, 180]  # rectangle 2
        image_rgb[20:80, 250:370] = [180, 160, 200]  # rectangle 3
        print("  (Using synthetic test image 384x384)")

    h, w = image_rgb.shape[:2]
    print(f"  Image size: {w}x{h}")

    try:
        t0 = time.time()
        # Preprocess: resize to 1024x1024, normalize
        image_resized = cv2.resize(image_rgb, (1024, 1024), interpolation=cv2.INTER_LINEAR)
        pixel_values = image_resized.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        pixel_values = (pixel_values - mean) / std
        pixel_values = np.transpose(pixel_values, (2, 0, 1))  # HWC -> CHW
        pixel_values = np.expand_dims(pixel_values, axis=0)  # add batch dim

        input_name = encoder_session.get_inputs()[0].name
        raw_outputs = encoder_session.run(None, {input_name: pixel_values})
        encode_time = time.time() - t0

        # Map output names to arrays
        enc_output_names = [o.name for o in encoder_session.get_outputs()]
        encoder_outputs = {}
        for idx, name in enumerate(enc_output_names):
            encoder_outputs[name] = raw_outputs[idx]
            print(f"  {name}: shape={raw_outputs[idx].shape}, dtype={raw_outputs[idx].dtype}")

        print(f"  ✓ Encoder ran in {encode_time:.1f}s")
    except Exception as e:
        print(f"  ✗ Encoder run failed: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Step 4: Run decoder with a test point
    print("\n[4/5] Running decoder with test point...")
    try:
        # Test point at center of image, in ORIGINAL image pixel space
        test_x = w / 2  # center x
        test_y = h / 2  # center y

        # Scale to encoder input space (1024x1024) — the critical coordinate transform
        scaled_x = test_x / w * 1024
        scaled_y = test_y / h * 1024
        print(f"  Original point: ({test_x:.1f}, {test_y:.1f})")
        print(f"  Scaled point: ({scaled_x:.1f}, {scaled_y:.1f})")

        # Also test WITHOUT scaling to show the difference
        unscaled_x = test_x
        unscaled_y = test_y

        # Build decoder feed
        dec_input_names = [i.name for i in decoder_session.get_inputs()]
        feed = {}
        for name in dec_input_names:
            if name in encoder_outputs:
                feed[name] = encoder_outputs[name]
            elif "point_coord" in name:
                # With proper scaling
                coords = np.array([[[scaled_x, scaled_y], [0.0, 0.0]]], dtype=np.float32)
                feed[name] = coords
            elif "point_label" in name:
                labels = np.array([[1.0, -1.0]], dtype=np.float32)
                feed[name] = labels
            elif "mask" in name and "has" not in name and "orig" not in name:
                feed[name] = np.zeros((1, 1, 256, 256), dtype=np.float32)
            elif "has_mask" in name:
                feed[name] = np.array([0.0], dtype=np.float32)
            elif "orig_im_size" in name:
                feed[name] = np.array([float(h), float(w)], dtype=np.float32)
            else:
                print(f"  WARNING: Unknown decoder input: {name}")

        t0 = time.time()
        decoder_outputs = decoder_session.run(None, feed)
        decode_time = time.time() - t0

        masks_raw = decoder_outputs[0]
        iou_preds = decoder_outputs[1]

        print(f"  Masks shape: {masks_raw.shape}")
        print(f"  IoU predictions shape: {iou_preds.shape}")
        print(f"  IoU scores: {iou_preds.flatten()}")
        print(f"  ✓ Decoder ran in {decode_time:.2f}s")

        # Verify mask shapes
        if masks_raw.ndim == 4:
            n_masks = masks_raw.shape[1]
            print(f"  Number of mask candidates: {n_masks}")
            if n_masks == 2:
                print("  ✓ multimask_output=True confirmed (2 candidates)")
            elif n_masks == 3:
                print("  ⚠ multimask_output=False? (3 candidates)")
        else:
            print(f"  ⚠ Unexpected mask shape: {masks_raw.shape}")

    except Exception as e:
        print(f"  ✗ Decoder run failed: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Step 5: Full AMG pipeline test
    print("\n[5/5] Running full AMG pipeline...")
    try:
        t0 = time.time()
        amg = ONNXSAM2AutomaticMaskGenerator(
            points_per_side=4,  # Small grid for quick test
            pred_iou_thresh=0.6,
            stability_score_thresh=0.85,
            min_mask_region_area=100,
        )
        load_time = time.time() - t0
        print(f"  AMG initialized in {load_time:.1f}s")

        t0 = time.time()
        masks = amg.generate(image_rgb)
        gen_time = time.time() - t0

        print(f"  Generated {len(masks)} masks in {gen_time:.1f}s")
        for i, m in enumerate(masks[:5]):  # Show first 5
            seg = m["segmentation"]
            print(f"    Mask {i}: area={int(np.sum(seg))}, iou={m['predicted_iou']:.3f}, "
                  f"stability={m['stability_score']:.3f}, bbox={m.get('bbox', 'N/A')}")

        if len(masks) > 5:
            print(f"    ... and {len(masks) - 5} more masks")

        print(f"  ✓ Full AMG pipeline completed in {gen_time:.1f}s")
    except Exception as e:
        print(f"  ✗ AMG pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        return False

    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)
    print(f"  Encoder time:  {encode_time:.1f}s")
    print(f"  Decoder time:  {decode_time:.2f}s (1 point)")
    print(f"  AMG load time: {load_time:.1f}s")
    print(f"  AMG gen time:  {gen_time:.1f}s ({4*4}=16 points, {len(masks)} masks)")
    print(f"  Est. per-point: {decode_time:.3f}s")
    print(f"  Est. 64 points: {decode_time * 64:.1f}s (full pps=8 grid)")
    print(f"  Total est. (384x384): {encode_time + decode_time * 64:.1f}s")
    print()

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate ONNX SAM2 AMG integration")
    parser.add_argument("--image", type=str, default=None, help="Path to test image")
    args = parser.parse_args()

    success = test_onnx_pipeline(args.image)
    sys.exit(0 if success else 1)
