# Fix Photo Vision Pass Batch Failures

## Problem
- Photo vision pass completed with 142 failed batches and 0 candidates
- All CV components showing "unavailable_batch_fallback" status
- Batches are failing during processing on Render worker with "This operation was aborted" errors
- Root cause: Batch timeout (80s) is too short for 10 photos per batch

## Analysis
- Current batch size: 10 photos (recently increased from 5)
- Current batch timeout: 80 seconds (OPEN_SOURCE_PHOTO_VISION_WORKER_BATCH_TIMEOUT_MS)
- Render worker processes images SEQUENTIALLY
- Each image: fetch (12s timeout) + OpenCV + YOLO + Tesseract OCR ≈ 8-12s per image
- With 10 photos × 8-12s = 80-120s total → exceeds 80s timeout → AbortController fires
- Also: Render starter plan has ~90s request timeout, adding another constraint

## Fix Plan
1. Reduce batch size from 10 back to 5 photos per batch (keeps each batch well within timeout)
2. Increase batch timeout from 80s to 120s (2 min) as safety margin
3. Process more batches per poll (increase from 3 to 5) to compensate for smaller batch size

## Tasks
- [ ] Reduce batch size default from 10 to 5 in asyncPhotoVisionJobManager.ts
- [ ] Increase batch timeout from 80_000ms to 120_000ms
- [ ] Increase maxBatchesPerPoll from 3 to 5 to compensate for smaller batches
- [ ] Commit and push to dev branch
- [ ] Verify deployment and test