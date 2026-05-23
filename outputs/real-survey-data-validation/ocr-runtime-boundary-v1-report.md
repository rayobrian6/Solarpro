# OCR Runtime Boundary V1 Report

## Boundary Objective

The OCR Runtime Pilot V1 boundary is designed to allow exactly one narrow class of runtime behavior: server-side OCR text extraction that emits non-authoritative, review-required assisted-evidence `text_region_candidate` records. The boundary intentionally blocks OCR from becoming canonical evidence, engineering fact extraction, CAD readiness logic, recommendation logic, workflow orchestration, requirement satisfaction, or duplicated survey ingestion/file storage logic.

The implemented boundary follows the audit conclusion in `outputs/real-survey-data-validation/ocr-runtime-readiness-audit-v1.md`: OCR capability already existed in the repository, but existing bill/debug OCR flows were not safe to promote directly into canonical or assisted-evidence runtime behavior. The safe bridge is isolated under `lib/assistedEvidenceSources/` and governed by the open-source tool registry and assisted-evidence candidate lifecycle.

## Approved OCR Runtime Surface

The only approved executable OCR runtime import for this pilot is `tesseract.js`, and it is confined to:

- `lib/assistedEvidenceSources/ocrRuntimeAdapter.ts`

The approved survey-alignment OCR bridge is:

- `lib/assistedEvidenceSources/ocrRuntimeBridge.ts`

The bridge may reuse existing survey attachment identity as source context, but it may not create uploads, store files, write survey records, duplicate hashing systems, or mutate canonical tables. Its allowed role is to produce deterministic source context and pass image bytes to the governed runtime adapter.

The registered tool is:

- tool name: `tesseract-js-ocr-runtime`
- tool version: `7.0.0`
- runtime category: `ocr_text_candidate`
- allowed candidate type: `text_region_candidate`
- allowed candidate categories: `field_context`, `electrical_context`
- boundary: `server_adapter_contract`
- canonical mutation allowed: `false`
- review required: `true`

## Boundary Guard Expansion

`scripts/check-assisted-evidence-boundaries.js` was expanded to recognize OCR runtime risk explicitly. The guard now includes an approved OCR runtime import allowlist, approved survey alignment files, and forbidden OCR source imports. It permits `tesseract.js` execution only in the approved OCR runtime adapter, while allowing non-executing OCR metadata references in registry, type, and test files.

The guard blocks assisted-evidence code from importing utility-bill/debug OCR paths such as:

- `app/api/bill-upload`
- `app/api/debug/ocr`
- `app/api/debug/bill`
- `app/api/ocr`
- `lib/billOcr`
- `lib/billOcrEngine`
- `lib/billParser`
- `lib/billPipeline`
- `lib/billClaudeExtractor`
- `lib/intake/utilityBillIntelligence`

The guard also blocks OCR runtime code from converting text into engineering authority through patterns associated with panel ratings, breaker sizes, service sizes, `project_physical_data`, CAD readiness, engineering recommendations, workflow orchestration, or engineering requirement evaluation. It also rejects suspicious hard-coded high-confidence upgrades in OCR runtime implementation files.

## Registry and Validation Boundaries

`lib/assistedEvidenceSources/openSourceToolValidation.ts` now explicitly allows `ocr_text_candidate` only under strict constraints. OCR text runtime definitions must use `server_adapter_contract`, be explicitly enabled for runtime pilot execution, be server-only, not require model weights, emit only `text_region_candidate`, and not be browser-executed. The validation still rejects visual categorization runtime definitions as unapproved for this pilot.

`lib/assistedEvidenceSources/candidateNormalization.ts` now distinguishes fixture output, metadata runtime output, and controlled OCR runtime output in provenance notes. OCR provenance states that the output is text extraction only and that no semantic image understanding or engineering inference was executed.

## Candidate Lifecycle Boundary

The OCR adapter emits only normalized candidate records through `createReviewRequiredCandidates()`. The generated candidates remain in the review-required lifecycle and are marked non-authoritative. The runtime does not bypass review, does not write canonical records, and does not mark candidate evidence as authoritative.

The projection boundary remains unchanged: an accepted OCR candidate may produce a reviewed projection with `canonicalParticipationStatus: 'eligible_for_mapping'`, but tests verify that the projection does not automatically mutate canonical evidence.

## Survey Ingestion Boundary

The OCR runtime bridge uses existing survey ingestion identity as provenance only. It records source references such as survey ID, project ID, site survey file ID, evidence ID, file URL, blob key, filename, MIME type, submitted category, and the canonical source-of-truth label `site_surveys+site_survey_files`. This preserves alignment with the real survey ingestion system without duplicating upload, file storage, hashing, metadata, or survey review workflows.

The bridge explicitly reports `canonicalMutationAllowed: false` and returns omitted runtime signals when no OCR text is extracted.

## Explicitly Blocked Outcomes

The OCR runtime pilot does not and must not:

- make OCR output canonical or authoritative;
- infer engineering facts from text;
- confirm panel ratings;
- set breaker sizes;
- satisfy engineering requirements;
- mutate `project_physical_data`;
- mutate `site_surveys`;
- mutate `site_survey_files`;
- influence CAD readiness;
- influence recommendations;
- create workflow items;
- duplicate existing survey ingestion, file storage, hashing, blur, metadata, or review systems;
- import existing bill/debug OCR flows as assisted-evidence runtime logic;
- call external vision services for this pilot;
- run OCR in browser/client contexts.

## Boundary Tests

`lib/assistedEvidenceSources/ocrRuntimeAdapter.test.ts` verifies the boundary with deterministic tests covering:

- valid OCR runtime registry definition;
- rejection of unsafe OCR registry definitions;
- text-only `text_region_candidate` normalization;
- review-required and non-authoritative candidate status;
- empty OCR input yielding no candidates;
- deterministic survey source metadata hashing;
- preservation of survey attachment identity;
- no requirement satisfaction authority;
- no CAD readiness authority;
- no recommendation authority;
- no workflow authority;
- projection-only review behavior with no automatic canonical mutation;
- assisted-evidence boundary guard success with OCR containment.

## Validation Evidence

All boundary validations passed with exit code `0` and are captured under `outputs/real-survey-data-validation/ocr-runtime-validation-v1/`.

- `check-engineering-boundaries.exit` = `0`; the log reports no prohibited OCR/CV/ML/image-byte/CAD-autogeneration runtime patterns in scoped Engineering Intelligence files.
- `check-topology.exit` = `0`; the topology guard passed with zero hard directional violations.
- `check-assisted-evidence-boundaries.exit` = `0`; the assisted-evidence boundary guard passed after scanning assisted evidence, assisted evidence source, and canonical/Engineering Intelligence boundary files.
- `targeted-ocr-runtime.exit` = `0`; targeted runtime tests passed with `3` files and `18` tests.
- `type-check.exit` = `0`.
- `npm-test.exit` = `0`; full test suite passed with `157` files and `4917` tests.
- `build.exit` = `0`.
- `lint.exit` = `0`.

## Boundary Conclusion

The implemented OCR runtime boundary is the smallest safe pilot surface: one approved server-only OCR adapter, one survey-ingestion-aligned bridge, one governed open-source runtime registration, review-required candidate emission, deterministic source/runtime hashes, and expanded automated guards. OCR text remains possible evidence only. It is not canonical, not authoritative, not engineering inference, and not allowed to affect downstream engineering systems without explicit human review and future governed mapping work.
