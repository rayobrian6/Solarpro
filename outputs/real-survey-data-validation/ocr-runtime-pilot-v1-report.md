# OCR Runtime Pilot V1 Report

## Scope

This report documents the smallest safe OCR runtime pilot implemented after the required audit-first readiness review in `outputs/real-survey-data-validation/ocr-runtime-readiness-audit-v1.md`. The pilot is intentionally narrow: it provides a governed assisted-evidence bridge for OCR text extraction while preserving OCR output as non-authoritative, review-required evidence only.

The implementation remains on the `dev` branch and does not create a feature branch. It follows the existing assisted-evidence source adapter architecture rather than duplicating upload, file storage, hashing, metadata, review, survey ingestion, CAD readiness, recommendation, workflow, or engineering requirement systems.

## Audit Findings Used Before Implementation

The readiness audit verified that OCR capability already existed in the repository. `tesseract.js` is present as a package dependency and native `tesseract` CLI usage is referenced by existing bill/debug OCR code, though native binary availability remains environment-dependent. The audit also found existing utility-bill and debug-oriented OCR/text extraction paths, including `app/api/ocr/route.ts`, `app/api/debug/ocr/route.ts`, `app/api/debug/bill/route.ts`, `app/api/bill-upload/route.ts`, `lib/billOcrEngine.ts`, `lib/billOcr.ts`, `lib/billParser.ts`, `lib/billImagePreprocess.ts`, and `lib/billClaudeExtractor.ts`.

Those existing OCR flows were not reused as canonical evidence pipelines because they are utility-bill/debug oriented and include parsing/extraction behavior outside the governed assisted-evidence candidate lifecycle. The implemented pilot instead reuses the existing assisted-evidence primitives for governed candidate normalization, review-required candidate creation, deterministic hashing, registered open-source tool governance, and projection-only review semantics.

## Implemented Runtime Pilot

The runtime pilot registers `tesseract-js-ocr-runtime@7.0.0` in `lib/assistedEvidenceSources/openSourceToolRegistry.ts` as a governed OCR runtime with runtime category `ocr_text_candidate`. The registered runtime is server-only, review-required, non-canonical, and limited to emitting `text_region_candidate` records in the allowed assisted-evidence categories `field_context` and `electrical_context`.

The runtime adapter is implemented in `lib/assistedEvidenceSources/ocrRuntimeAdapter.ts`. It dynamically imports `tesseract.js`, creates a Tesseract worker for English OCR, recognizes text from supplied image bytes, normalizes text deterministically, normalizes confidence without upgrading it, computes a runtime payload hash, and emits review-required candidates through the existing `createReviewRequiredCandidates()` flow. Empty image input returns a payload with method `none`, no text, no derived signals, and zero candidates.

The bridge is implemented in `lib/assistedEvidenceSources/ocrRuntimeBridge.ts`. It accepts existing survey attachment identity and image bytes, builds deterministic source metadata hashes from existing survey/file identity, delegates candidate creation to the OCR runtime adapter, and annotates candidates with source provenance. It does not write to `site_surveys`, `site_survey_files`, `project_physical_data`, CAD readiness, engineering recommendations, workflow orchestration, or requirement satisfaction systems.

The public assisted-evidence source exports in `lib/assistedEvidenceSources/index.ts` now include the OCR runtime adapter and bridge.

## Allowed Candidate Payload Labels

The OCR runtime type surface in `lib/assistedEvidenceSources/candidateAdapterTypes.ts` is limited to the allowed possible-text labels:

- `possible_utility_account_number`
- `possible_meter_number`
- `possible_service_panel_rating_text`
- `possible_breaker_rating_text`
- `possible_equipment_label_text`
- `possible_address_text`
- `possible_placard_text`
- `possible_invoice_or_bill_text`
- `possible_nameplate_text`

The runtime pilot currently emits text-region evidence with these labels only as possible text fields. It does not infer that a value is correct, canonical, or engineering-actionable.

## Candidate Safety Guarantees

OCR candidates emitted by the pilot are constrained to the existing review-required assisted-evidence lifecycle. The candidate output is marked `candidateStatus: 'review_required'`, `nonAuthoritative: true`, and `reviewRequired: true`. Candidate payloads include `canonicalMutationAllowed: false`, `textOnlyEvidence: true`, and `runtimePilot: true`.

Candidate limitations include review and authority boundaries such as `runtime-ocr-text-only`, `review-required`, `non-authoritative`, `no-engineering-authority`, `no-canonical-mutation`, `does-not-confirm-panel-rating`, `does-not-set-breaker-size`, and `does-not-satisfy-requirements`.

Accepted OCR review projections remain projection-only and are marked `canonicalParticipationStatus: 'eligible_for_mapping'`. Tests verify that accepting OCR text does not automatically mutate canonical evidence.

## Files Changed

Implemented or updated source files:

- `lib/assistedEvidenceSources/candidateAdapterTypes.ts`
- `lib/assistedEvidenceSources/candidateAdapterContracts.ts`
- `lib/assistedEvidenceSources/openSourceToolRegistry.ts`
- `lib/assistedEvidenceSources/openSourceToolValidation.ts`
- `lib/assistedEvidenceSources/candidateNormalization.ts`
- `lib/assistedEvidenceSources/ocrRuntimeAdapter.ts`
- `lib/assistedEvidenceSources/ocrRuntimeBridge.ts`
- `lib/assistedEvidenceSources/index.ts`
- `lib/assistedEvidenceSources/ocrRuntimeAdapter.test.ts`
- `lib/assistedEvidenceSources/metadataRuntimeAdapter.test.ts`
- `scripts/check-assisted-evidence-boundaries.js`

Generated reports and validation artifacts:

- `outputs/real-survey-data-validation/ocr-runtime-readiness-audit-v1.md`
- `outputs/real-survey-data-validation/ocr-runtime-pilot-v1-report.md`
- `outputs/real-survey-data-validation/ocr-runtime-boundary-v1-report.md`
- `outputs/real-survey-data-validation/ocr-runtime-validation-v1/`

## Tests Added or Updated

`lib/assistedEvidenceSources/ocrRuntimeAdapter.test.ts` adds coverage for the OCR runtime registry entry, unsafe registry rejection, text-only review-required candidate normalization, empty OCR safe rejection, deterministic source metadata hashing, preservation of survey attachment identity, non-participation in requirement/CAD/recommendation/workflow authority, and projection-only review behavior.

`lib/assistedEvidenceSources/metadataRuntimeAdapter.test.ts` was updated so registry validation still rejects unapproved visual categorization runtime definitions after OCR text runtime became an explicitly approved pilot category.

## Validation Results

All required validation commands completed with exit code `0`; logs and exit files are stored under `outputs/real-survey-data-validation/ocr-runtime-validation-v1/`.

- `npm run check:engineering-boundaries` — exit `0`; log reports: `Engineering Intelligence boundary scan passed: no prohibited OCR/CV/ML/image-byte/CAD-autogeneration runtime patterns found in 127 scoped file(s).`
- `npm run check:topology` — exit `0`; log reports `Dependency topology guard passed.` The log also records the existing unprotected circular dependency and directional warnings, with hard directional violations at `0`.
- `npm run check:assisted-evidence-boundaries` — exit `0`; log reports: `Assisted evidence boundary guard passed. Scanned 8 assistedEvidence files, 19 assistedEvidenceSources files, and 7 canonical/Engineering Intelligence boundary files.`
- Targeted OCR runtime tests — exit `0`; `3` test files and `18` tests passed.
- `npm run type-check` — exit `0`.
- `npm test` — exit `0`; `157` test files and `4917` tests passed.
- `npm run build` — exit `0`; build completed with known environment warnings about missing deployment/runtime secrets but no failing exit.
- `npm run lint` — exit `0`; lint completed with pre-existing warnings, primarily `no-console`, and no failing exit.

## Explicit Non-Authority Statement

The OCR runtime pilot is not an engineering inference system. It does not confirm service panel ratings, set breaker sizes, satisfy requirements, create CAD readiness, generate recommendations, create workflow items, mutate `project_physical_data`, mutate `site_surveys`, mutate `site_survey_files`, or make OCR output canonical. It only emits deterministic, text-only, non-authoritative, review-required assisted-evidence candidates for later human review and possible mapping.
