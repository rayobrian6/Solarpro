# OSS photo vision assisted-evidence worker

## Audit current OSS boundaries
- [x] Confirm current branch/status and inspect assisted evidence/photo intelligence/CAD preview/render files
- [x] Document which tools execute, which are placeholders, which outputs are synthetic, and which use image bytes

## Implement bounded worker/store/API/UI
- [x] Add review-only open-source photo vision worker module using actual image bytes where available
- [x] Add assisted evidence candidate persistence without canonical/CAD/permit mutation
- [x] Add operator-triggered API and UI diagnostics separate from OpenAI classification preview
- [x] Update read-only render/preview to use real thumbnails and review-only overlays when candidates exist
- [x] Mark synthetic reconstruction regions fallback-only and prefer real worker candidates

## Verify
- [x] Add tests for review-only worker, deterministic hashes, unavailable diagnostics, thumbnails, overlays, fallback marking
- [x] Run targeted tests and typecheck
- [x] Commit and push dev with final report

## Phase 1 audit record
- sharp actually executes today in lib/siteSurvey/photoIntelligence.ts and lib/assistedEvidenceSources/metadataRuntimeAdapter.ts using image bytes for metadata, hashes, quality, and duplicate hygiene.
- tesseract.js is registered and adapter-tested as bounded OCR; it is not part of current CAD preview overlays and remains review-only text evidence.
- OpenCV, YOLO/Supervision, Open3D, and FreeCAD are not executing in the live survey render path; Open3D/FreeCAD remain future-only, and CV geometry has no native runtime today.
- photo-classification-preview uses OpenAI Vision for labels when configured; OSS analysis there is quality/duplicate context only, not open-source CV classification.
- evidenceDerivedCadReconstruction.ts currently creates hardcoded normalized regions from labels/categories; those regions are synthetic and must be fallback-only unless replaced by real worker candidates.
- planSetRenderOutput.ts A-201 uses placeholder photo boxes, not actual thumbnails; A-101 renders synthetic review overlays from reconstruction candidates.
- lib/survey/evidence/manifest.ts remains canonical source-of-truth from site_surveys + site_survey_files; OSS CV candidates must stay separate and cannot mutate canonical evidence, CAD geometry, project_physical_data, permits, BOM, or engineering workflow state.
