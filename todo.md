# External OpenCV worker architecture Stage 1

## Audit current implementation
- [x] Confirm branch/status and identify current Sharp/internal photo vision pass, candidate store, APIs, render overlays, and authority flags
- [x] Document existing storage/API/UI/render boundaries and any gaps for an external worker

## Design Stage 1 worker boundary
- [x] Define external worker job/result contract, health/tool availability contract, provenance/run hash behavior, and review-only authority boundary
- [x] Decide minimal reuse path for existing candidate persistence without duplicate systems

## Implement Stage 1 only
- [x] Add Dockerized external OpenCV worker service that processes actual image bytes into edges/lines/contours/rectangles review candidates
- [x] Add Next app client/orchestration that sends authorized jobs to worker, handles unavailable worker cleanly, persists returned candidates through existing review-only store, and never lets worker write DB directly
- [x] Wire operator-triggered Stage 1 action/UI diagnostics and render overlays/thumbnails using persisted external worker candidates

## Verify
- [x] Add tests proving external worker contract, unavailable handling, deterministic provenance, persistence reuse, and no CAD/canonical/permit/BOM/engineering mutation
- [x] Run targeted tests and typecheck
- [x] Commit and push dev with final report

## Audit/design record
- Current internal pass exists in lib/assistedEvidenceSources/openSourcePhotoVisionWorker.ts and uses Sharp inside Next.js for metadata, thumbnails, quality, edge projections, dominant lines, and dense edge regions; it remains bounded/review-only but is not true OpenCV execution.
- Existing persistence table open_source_photo_vision_candidates and lib/db/openSourcePhotoVision.ts are sufficient for Stage 1; implementation reuses this store instead of creating a duplicate candidate system.
- Survey detail API already loads stored candidates; CAD preview API and planSetRenderOutput already render persisted thumbnails/overlays as review-only/non-authoritative/not CAD geometry.
- evidenceDerivedCadReconstruction.ts legacy hardcoded regions remain fallback-only and cannot masquerade as source-derived CAD.
- Stage 1 boundary is external-workers/opencv-photo-vision: Dockerized FastAPI/OpenCV service with /health and /v1/photo-vision/jobs; worker fetches actual image bytes and returns edges/lines/contours/rectangles only.
- Next.js route app/api/site-surveys/[surveyId]/open-source-photo-vision-pass/route.ts now orchestrates the external worker, handles unavailable worker with 503 diagnostics, and persists only returned review candidates through the existing authorized store.
- The external worker has no DB credentials/path and must not mutate canonical evidence, CAD geometry, project_physical_data, permits, BOM, engineering workflow state, or homeowner-facing outputs.
- Stage 2 YOLO/Supervision, Stage 3 OCR/Tesseract, Open3D, and FreeCAD are explicitly reported as unavailable/future-stage and are not marked complete.
