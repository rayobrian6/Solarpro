# Evidence Provenance + Requirement Traceability v1 Report

## Summary

Evidence Provenance + Requirement Traceability v1 adds deterministic explainability on top of the canonical survey evidence system. The implementation preserves the existing architectural boundary: `site_surveys` and raw uploads remain immutable history, while `evidenceHygiene.canonicalManifest` remains the downstream engineering and permit truth source. Requirement satisfaction, engineering bridge readiness, permit evidence reporting, and UI traceability now expose which canonical evidence item satisfied each required category, which survey session originated that representative, and how duplicate collapse affected provenance without allowing raw upload counts to inflate completeness or confidence.

## Source of Truth and Drift Control

The provenance layer is derived from the canonical manifest and optional duplicate hygiene context. The reusable builder `buildSurveyEvidenceTraceability()` accepts a `SurveyEvidenceManifest` and, when available, `EvidenceDuplicateGroup[]` plus `SurveySessionSummary[]`. It does not inspect image bytes, perform CV/OCR, generate CAD, or infer semantic content. Requirement satisfaction is bounded to the required canonical evidence categories already defined by the survey evidence registry, and missing requirements remain deterministic when no canonical representative exists.

The hygiene manifest now carries a `traceability` bundle created after canonical representative selection. Engineering and permit paths either consume that bundle via the existing hygiene context or rebuild the same bounded traceability from the canonical manifest. UI rendering reads the traceability bundle and does not manufacture provenance locally.

## Provenance Structures Added

The new `lib/survey/evidence/provenance.ts` module defines deterministic records for canonical evidence provenance, requirement-to-evidence traceability, metadata completeness, and survey lineage. The canonical provenance record includes `canonicalEvidenceId`, `originatingSurveyId`, `originatingSurveyCreatedAt`, `evidenceCategory`, `duplicateGroupSize`, `selectionReason`, `evidenceTruthSource`, `requirementSatisfied`, `requirementConfidenceSource`, and `metadataCompleteness` indicators. Requirement traceability records include satisfied/missing status, evidence lineage, confidence source, deterministic reasoning path, engineering bucket, and category label. Survey lineage records expose survey id, submitted timestamp, duplicate status, raw upload count labeled audit-only, canonical representative count, category coverage, and canonical-session status.

## Canonical Selection Explainability

Selection explainability is deterministic and metadata-only. Duplicate hygiene still chooses canonical representatives using the existing metadata score and timestamp comparator. The provenance layer describes that reason in bounded text: duplicate collapse representative, metadata-matched raw upload group size, categorized evidence outranking uncategorized evidence, presence of `site_survey_files` records, filename, MIME type, timestamp availability, newest timestamp tie behavior, and stable evidence-id tie ordering. The implementation does not add image-byte comparison, perceptual hashing, semantic inference, OpenCV, OCR, YOLO, or CAD generation.

## Engineering Traceability Paths Added

`SurveyEvidenceEngineeringBridge` now includes `requirementTraceability` and `missingRequirementTraceability` while preserving the existing evidence bucket arrays and counts. `collectEngineeringSurveyEvidence()` now returns `traceability` derived from the same canonical manifest that drives photos, missing categories, completeness, and bridge readiness. The permit API passes `evidenceHygiene.canonicalManifest`, `evidenceHygiene.evidenceDuplicateGroups`, and `evidenceHygiene.sessions` into the engineering adapter so duplicate-group provenance and survey lineage survive downstream.

## Permit Traceability Paths Added

The validation summary now renders three bounded traceability subsections inside the survey evidence audit table: Requirement Evidence Traceability, Canonical Evidence Provenance, and Survey Lineage. Requirement rows show satisfied vs missing state, canonical evidence id, originating survey id, duplicate group size, and confidence source. Canonical provenance rows show each canonical representative, originating survey timestamp, duplicate group size, and selection reason. Survey lineage rows show each survey session with raw uploads explicitly labeled audit-only and canonical representative counts separately displayed.

## UI Additions

The survey detail page now includes an expandable `Evidence Provenance + Requirement Traceability v1` card with three sections: Requirement Evidence Traceability, Canonical Evidence Provenance, and Survey Lineage. The page prefers `evidenceHygiene.traceability` and falls back to deterministic derivation from the displayed canonical manifest when hygiene context is unavailable. Existing duplicate hygiene and evidence manifest sections remain intact.

## Raw Upload Count Boundary

Raw upload counts continue to exist only as immutable audit/history data. They are displayed as raw uploads or raw photo uploads, and permit/survey lineage rows explicitly label them audit-only. Completeness, readiness, bridge counts, requirement satisfaction, and confidence provenance all derive from canonical evidence records rather than raw upload arrays.

## Tests Added or Extended

Focused regression coverage was extended in `lib/survey/evidence/sessionGrouping.test.ts`, `lib/engineering/surveyEvidence.test.ts`, and `lib/permit/validationPageSurveyEvidence.test.ts`. The tests now verify that seven repeated duplicate submissions still collapse from 28 raw uploads to 4 canonical representatives, provenance points to canonical representatives only, engineering traceability references canonical evidence ids, missing requirements remain deterministic with null evidence ids, survey lineage survives duplicate collapse, and permit validation renders requirement traceability, canonical provenance, and survey lineage while preserving raw upload audit wording.

## Validation Results

Focused tests were run with `npm test -- --run lib/survey/evidence/sessionGrouping.test.ts lib/engineering/surveyEvidence.test.ts lib/permit/validationPageSurveyEvidence.test.ts`. Result: exit code 0; 3 test files passed; 9 tests passed.

`npm run type-check` was run. Result: exit code 0; `tsc --noEmit` completed without errors after correcting type-only category/status issues exposed by the new traceability mocks.

`npm run build` was run. Result: exit code 0; Next.js production build completed successfully. The build emitted the existing environment-variable warnings for missing runtime secrets (`DATABASE_URL`, `JWT_SECRET`, and recommended optional values) but continued through compilation, page-data collection, and static page generation.

A prohibited boundary scan was run across all changed and untracked implementation/test/report surfaces plus dependency diffs. Result: no new prohibited dependency additions and no runtime implementation of OpenCV, OCR, YOLO, image-byte inspection, perceptual hashing, semantic inference, CAD generation, or engineering sizing logic. Matches were limited to existing/added guardrail documentation and explicit no-CV/OCR/CAD/image-byte statements.

## Prohibited Boundary Confirmation

This patch introduces provenance and explainability infrastructure only. It does not add OpenCV, OCR, YOLO, image-byte inspection, perceptual hashing, semantic inference, CAD generation, or engineering sizing changes. Existing future-boundary documentation strings remain documentation only and are not runtime additions.
