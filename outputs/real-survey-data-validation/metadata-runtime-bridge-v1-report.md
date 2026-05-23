# Metadata Runtime Bridge V1 Report

## Implemented bridge

This phase adds `lib/assistedEvidenceSources/surveyIngestionRuntimeBridge.ts` and exports it from `lib/assistedEvidenceSources/index.ts`. The bridge is intentionally narrow. It accepts a `SurveyIngestionRuntimeSourceRef`, image bytes, runtime execution identifiers, and provenance timestamps. It returns an assisted-evidence source context, a deterministic source metadata hash, review-required candidates, a summary of reused survey signals, and a list of intentionally omitted runtime signals.

## Survey identity reuse

The bridge requires the caller to provide existing survey attachment identity: survey id, project id, site survey file id, evidence id, file URL, blob key, filename, MIME type, submitted category, canonical source-of-truth label, existing image metadata, and existing quality fields. This design avoids database reads and writes inside the runtime bridge and prevents the runtime from becoming a second survey ingestion path.

The bridge builds `sourceContext.sourceFileId` from the existing site survey file id when present and falls back to the evidence id only for already-created evidence references. It builds `sourceContext.sourceUploadKey` from the existing blob key when present and falls back to the file URL. It preserves the existing survey id, project id, tool run id, tool config hash, creation timestamp, and creator in the assisted-evidence source context.

## Deterministic source metadata hash

The bridge creates a deterministic source metadata hash from existing survey attachment identity and existing manifest metadata/quality fields. Warning arrays are de-duplicated and sorted before hashing so replay is stable. This hash uses the existing `deterministicHash()` utility from `lib/assistedEvidence`; it does not add a duplicate checksum or fingerprinting system.

## Runtime delegation

The bridge delegates actual metadata runtime execution to `generateMetadataRuntimeCandidates()` from `metadataRuntimeAdapter.ts`. It does not import `sharp`, does not resolve packages directly, does not parse EXIF directly, and does not create candidate objects manually. The existing metadata runtime adapter remains responsible for resolving the registered tool and routing candidates through the shared review-required normalization path.

## Candidate annotations

Each returned candidate is annotated with survey ingestion provenance: `surveyRuntimeBridge: true`, canonical source-of-truth, evidence id, site survey file id, submitted category, existing image metadata, existing quality fields, and `canonicalMutationAllowed: false`. Candidate limitations are expanded with survey-alignment and canonical-truth-preservation labels. Candidate provenance deterministic inputs include the survey source reference and evidence id, and notes state that survey attachment truth is preserved and survey evidence image/quality fields remain unchanged.

## Blur handling

The directive allowed `possible_blurry_photo` only as a review-required candidate. Audit alignment found no existing blur-score processor to reuse. The bridge therefore does not implement any blur heuristic and does not emit a blur candidate. When `existingQuality.blurScore` is null, the result includes `possible_blurry_photo:no-existing-blur-score-to-reuse` in `omittedRuntimeSignals`. This preserves the directive's reuse-first rule and avoids creating a duplicate blur system.

## Canonical isolation

The bridge does not import `lib/survey/ingest`, `lib/survey/evidence`, `lib/db/surveys`, `app/api/survey`, engineering requirements, CAD readiness, recommendations, workflow orchestration, or database clients. It does not write `site_surveys`, `site_survey_files`, `project_physical_data`, manifest fields, CAD metadata, recommendation outputs, workflow state, or engineering requirements. Its output remains non-authoritative and review-required.

## Test coverage

`lib/assistedEvidenceSources/surveyIngestionRuntimeBridge.test.ts` verifies deterministic source hashing, reuse of existing survey identity and category, omission of blur candidates when no existing blur score exists, stable review-required runtime candidates with survey provenance annotations, and absence of canonical/CAD/recommendation/workflow authority. The test uses a deterministic one-pixel PNG byte array and fixed runtime provenance fields for stable replay.
