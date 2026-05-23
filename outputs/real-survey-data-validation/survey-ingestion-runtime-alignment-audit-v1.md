# Survey Ingestion Runtime Alignment Audit V1

## Executive finding

This audit confirms that SolarPro already has a canonical Survey V2 ingestion path and an existing governed assisted-evidence runtime namespace. The safe integration path for the first real survey-aligned metadata runtime is therefore not a new ingestion system, not a duplicate photo pipeline, and not a canonical image-quality processor. The safe path is a narrow bridge that receives an already-normalized survey attachment reference, delegates byte-level metadata extraction to the existing registered metadata runtime adapter, and emits only non-authoritative, review-required assisted-evidence candidates.

## Canonical survey ingestion architecture

`lib/survey/v2/types.ts` defines `SurveyV2Payload` as the final submitted payload sent to the ingest pipeline. The payload contains the survey identity, project identity, submitted timestamp, inspector name, structured survey sections, and the `photos` array. This establishes Survey V2 as the submitted field-survey contract and prevents runtime metadata from becoming a second survey payload.

`lib/survey/ingest/transformLayer.ts` converts the verified Survey V2 payload into transform output. Its photo extraction logic reads `payload.photos`, preserves the submitted photo category, and emits file records with an external id, name, URL, MIME type, and category. The transform comments explicitly state that the category is written to `site_survey_files.label` and avoids lossy filename guessing. This is the existing category source and must not be replaced by runtime inference.

`lib/survey/ingest/ingestPipeline.ts` documents `site_surveys` as the single source of truth for field survey submissions. The pipeline creates a `site_surveys` row containing the full raw Survey V2 payload as `survey_data`, inserts submitted photos into `site_survey_files`, and backfills `project_physical_data.source_survey_id` after the canonical survey id exists. `project_physical_data` is a linked engineering projection, not a replacement for the survey payload.

`lib/db/surveys.ts` contains database access for `site_surveys` and `site_survey_files`, including inserts and reads. The runtime bridge intentionally does not import this file and does not perform database writes or reads.

## Upload, validation, and storage architecture

`app/api/survey/upload-photo/route.ts` already owns survey upload validation. It validates MIME type against the existing image allowlist, enforces the configured max file size, reads bytes for magic-byte validation, rejects mismatches between declared MIME type and file content, and stores files in Vercel Blob when configured or a local development fallback otherwise. This route is the existing upload normalization and validation boundary. Runtime metadata extraction must not bypass it or create an alternate upload path.

The audited runtime bridge accepts image bytes only as an explicit caller-provided input paired with an existing survey attachment reference. It does not normalize uploads, accept user uploads, write storage objects, or validate replacement MIME rules. That keeps upload truth in the existing upload path.

## Existing evidence manifest, metadata, duplicate, and blur handling

`lib/survey/evidence/manifest.ts` already defines `SurveyEvidenceImageMetadata` fields for width, height, and orientation and `SurveyEvidenceQuality` fields for blur score, duplicate score, and warnings. The same manifest explicitly initializes image metadata to null and quality scores to null for current survey file items. Its processing history states that the photo is linked from `site_survey_files` and that image quality and duplicate analysis are not processed in v1.

`lib/survey/evidence/sessionGrouping.ts` similarly preserves manifest source-of-truth continuity and keeps quality and duplicate values at null in the grouped manifest path. Existing tests in `lib/survey/evidence/manifest.test.ts` assert that classified evidence items are built from `site_survey_files` without quality or AI overclaims.

The audit found canonical fields for metadata, blur, and duplicate information, but did not find an active authoritative blur-score processor, duplicate-score processor, EXIF processor, image dimension processor, or survey-ingestion quality runtime that currently populates those canonical fields. Because no existing blur score logic is available to reuse, this phase must not invent a blur heuristic. The bridge therefore records omission of `possible_blurry_photo` when no existing blur score exists rather than creating a parallel blur system.

## Existing governed runtime foundation

`lib/assistedEvidenceSources/openSourceToolRegistry.ts` already registers `sharp-metadata-runtime` version `0.34.5` as an approved open-source runtime tool. `lib/assistedEvidenceSources/metadataRuntimeAdapter.ts` already imports `sharp`, resolves the registered tool before execution, extracts deterministic metadata payload fields, normalizes candidate signals, and emits candidates through the shared review-required candidate normalization path. Existing runtime candidates are non-authoritative and include runtime source provenance.

`lib/assistedEvidenceSources/candidateAdapterTypes.ts` currently permits metadata runtime signals for `possible_image_orientation`, `possible_low_resolution_photo`, `possible_large_image_file`, `possible_missing_exif_metadata`, `possible_invalid_photo_dimensions`, and `possible_duplicate_photo`. The directive also allows `possible_blurry_photo`, but the audit found no existing blur processor to reuse, so this implementation deliberately omits blur candidate creation in the survey bridge.

## Admin review-only surfacing audit

The existing Engineering Intelligence Assisted Evidence Sandbox already distinguishes fixture and runtime data through `candidate.candidatePayload.runtimePilot`, renders a runtime label when that flag is true, and displays non-authoritative/review-required language. Because the new bridge reuses the existing candidate payload and provenance structure, no additional admin UI mutation was required for this phase. The bridge adds survey-specific provenance fields to the candidate payload so existing review surfacing can display the runtime candidate without altering canonical survey or engineering flows.

## Safety conclusion

The safe runtime integration point is after Survey V2 ingestion and upload normalization, not inside them. The bridge must consume existing survey attachment identity, preserve `site_surveys+site_survey_files` as canonical truth, delegate runtime extraction to the registered metadata adapter, emit only review-required candidates, and leave canonical survey evidence image and quality fields unchanged. The implemented bridge follows that path and avoids duplicate ingestion, duplicate photo storage, duplicate metadata systems, duplicate blur heuristics, duplicate hashing systems, OCR, CV escalation, geometry inference, engineering inference, CAD influence, recommendation influence, workflow influence, and database mutation.
