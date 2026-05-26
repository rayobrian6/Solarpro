# Fix Photo Vision Pass Batch Failures

## Problem
- Photo vision pass completed with 142 failed batches and 0 candidates
- All CV components showing "unavailable_batch_fallback" status
- Batches were failing with "This operation was aborted" errors

## Root Cause Analysis
1. **Batch size too large**: 10 photos per batch, but Render worker processes images sequentially (~8-12s each)
2. **Batch timeout too short**: 80s timeout, but 10 photos × ~8-12s = 80-120s total → exceeds timeout → AbortController fires
3. **Too many batches per poll**: Processing 3-5 batches per poll = 200-300s, exceeding Vercel's serverless function timeout

## Fixes Applied (3 commits)

### Commit 362a4b1: Reduce batch size and increase timeout
- Batch size: 10 → 5 photos per batch
- Batch timeout: 80s → 120s
- Added timeout-specific error logging (distinguishes AbortError from HTTP errors)

### Commit 7b88b1f: Process 1 batch per poll + maxDuration
- maxBatchesPerPoll: 5 → 1 (each batch takes ~40-60s, must fit in Vercel's 60s limit)
- Added `export const maxDuration = 60` to route for explicit timeout control
- Updated comments to reflect actual timing

## Tasks
- [x] Reduce batch size from 10 to 5 photos per batch
- [x] Increase batch timeout from 80s to 120s
- [x] Process only 1 batch per poll (not 3-5) to stay within Vercel's 60s maxDuration
- [x] Add maxDuration = 60 to the API route
- [x] Improve error logging for timeout aborts
- [x] Commit and push to dev branch
- [ ] Wait for Vercel deployment and test end-to-end

## Render Worker Health (Verified)
- Status: OK
- OpenCV: available v4.13.0
- YOLO: available (yolov8n.pt, model loaded)
- Supervision: available v0.25.1
- Tesseract: available v5.5.0
- pytesseract: available v0.3.13

## Expected Behavior After Fix
- Each batch: 5 photos × ~8-12s = ~40-60s per batch
- Each poll: processes 1 batch, returns progress
- Client polls every 2s, max 30 min
- For ~490 photos: 98 batches × ~45s each ≈ ~73 min worst case (may need to increase timeout further)