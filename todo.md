# Stage 3 Tesseract OCR worker extension

## Audit current Stage 2 worker and integration
- [x] Confirm branch/status and inspect external worker OpenCV/YOLO architecture, health, requestedTools, candidate hashing, and safety limits
- [x] Inspect Next client, route, review-only persistence, UI candidate display, and A-201 evidence sheet rendering paths

## Design Stage 3 OCR boundary
- [x] Define Tesseract/pytesseract availability reporting, OCR candidate schema, crop behavior, hint extraction, deterministic hash behavior, and unavailable fallback behavior
- [x] Define minimal integration path that reuses the existing review-only candidate store and avoids canonical/permit/BOM/engineering mutation

## Implement Stage 3 only
- [x] Add Tesseract system packages and pytesseract dependency to the existing worker
- [x] Add OCR worker module with preprocessing, full-image OCR, YOLO-box crop OCR, text cleanup, confidence scoring, equipment regex hints, and review-only limitations
- [x] Extend worker health/job flow for requestedTools tesseract_ocr and ocr_equipment_labels without fabricated OCR text
- [x] Extend Next client/UI/render support for OCR candidates, snippets, hints, source crop metadata, and review-only labels
- [x] Update worker README with OCR setup, Docker usage, limitations, and future-stage boundaries

## Verify
- [x] Add/update tests for OCR unavailable path, candidate normalization, review-only persistence, A-201 snippets, and no CAD/permit/BOM/engineering/canonical mutation
- [x] Run targeted tests and typecheck
- [x] Commit and push dev with final report

## Stage 3 audit/design notes
- Current external worker already fetches real photo bytes, enforces byte/file/time limits, produces thumbnails, OpenCV candidates, optional YOLO/Supervision candidates, deterministic candidate hashes, and a run hash. It has no database write path.
- Current Next route authorizes the operator, calls the external worker, persists returned candidates through the existing open-source photo vision candidate store, and returns explicit no-mutation metadata for canonical evidence, CAD, permits, BOM, and engineering workflows.
- OCR will be reported as Tesseract/pytesseract availability only. If unavailable or not requested, the worker emits diagnostics and zero OCR text candidates; it must not fabricate text or add fake fallbacks.
- OCR candidates will use candidateType `ocr_text`, candidateCategory `electrical_context`, reviewStatus `review_required`, nonAuthoritative true, confidence from actual Tesseract word confidences, normalized bbox/region, sourceCrop metadata, cleaned text, equipment hints, model/version provenance, limitations, and deterministic hashes.
- Crop behavior: when YOLO boxes exist, OCR may run on bounded equipment/object crops; full-image OCR remains a real-photo fallback. Duplicate/empty low-confidence text is suppressed, not fabricated.
- Integration path: extend requestedTools with `tesseract_ocr` and `ocr_equipment_labels`, normalize/store/display candidates through the existing bundle, and add A-201 snippets only as review-only evidence annotations.