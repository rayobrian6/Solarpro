# Stage 2 YOLO + Supervision semantic detection worker

## Audit current Stage 1 implementation
- [x] Confirm branch/status and inspect current external OpenCV worker architecture, request/response schema, hashing, thumbnail generation, and health reporting
- [x] Inspect Next client/route persistence path, UI/operator action, and render overlay path for existing review-only enforcement

## Design Stage 2 boundary
- [x] Define YOLO/Supervision tool availability, model provenance, candidate schema, deterministic hash behavior, and unavailable fallback behavior
- [x] Define minimal integration path that reuses the existing review-only candidate store and does not duplicate persistence

## Implement Stage 2 only
- [x] Add YOLO + Supervision worker module with startup model loading, CPU-safe defaults, image/batch limits, bounding boxes, class mapping, confidence, limitations, and review-only flags
- [x] Extend worker health and job response to include YOLO/Supervision diagnostics and object_detection candidates without fabricated detections
- [x] Extend Next external worker client/route/UI/render support for YOLO detections, requestedTools, filtering, provenance, and review-only overlays
- [x] Update worker README with model setup, Docker usage, CPU/GPU notes, safety limits, limitations, and future stages

## Verify
- [x] Add tests for YOLO availability/unavailability, deterministic detection hashes, persistence reuse, overlays, and no CAD/permit/BOM/engineering/canonical mutation
- [x] Run targeted tests and typecheck
- [ ] Commit and push dev with final report

## Audit/design record
- Stage 1/2 worker now runs from external-workers/opencv-photo-vision/app/main.py with /health and /v1/photo-vision/jobs; it fetches actual image bytes, enforces MAX_IMAGE_BYTES, runs OpenCV Canny/Hough/contour extraction, emits thumbnails, hashes candidates, and returns review-only candidates only.
- Next integration uses lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient.ts and app/api/site-surveys/[surveyId]/open-source-photo-vision-pass/route.ts; authorization and persistence happen in Next, not in the worker.
- Existing store open_source_photo_vision_candidates remains sufficient for Stage 2 object_detection candidates; do not create another table/store.
- Render overlays consume persisted payload.region and payload.line; YOLO boxes can reuse payload.region with sourceModel/provenance and explicit review-only labels.
- Stage 2 boundary: YOLO/Supervision detections are semantic review cues only, derived from actual model inference when available. If no model or dependency is available, the worker returns diagnostics and emits no fabricated object detections.
