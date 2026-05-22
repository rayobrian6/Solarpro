# Deterministic Repeated Survey Hygiene v1 Report

Date: 2026-05-22
Branch: `dev`
Scope: Metadata-only duplicate hygiene for repeated survey sessions and repeated photo evidence.

## Correction accepted

The operational issue is not one survey with 140 duplicate photos. The correct model is multiple preserved `site_surveys` rows for the same project, where a technician walked the same path and uploaded roughly the same photo set several times. This implementation treats duplicate hygiene at two levels:

1. Survey session grouping: repeated `site_surveys` are grouped and marked, but never merged or deleted.
2. Photo evidence grouping: repeated photo metadata is grouped and collapsed by default for evidence coverage and engineering/permit confidence, but raw uploads remain accessible.

No image bytes are read. No OpenCV, perceptual hashing, OCR, AI/CV/CAD, segmentation, or CAD automation was introduced.

## Preservation guarantee

All `site_surveys` remain preserved. The new model does not delete, merge, mutate, or hide database rows. It creates a deterministic project-level evidence hygiene view over existing rows and files. Older sessions are marked as historical overlapping submissions when appropriate and remain expandable/inspectable in the viewer.

## Output model implemented

The project-level hygiene model exposes:

- `surveySessionGroupId`
- `canonicalSurveyId`
- `surveySessionDuplicateStatus`
- `evidenceDuplicateGroupId`
- `canonicalEvidenceId`
- `duplicateCount`
- `duplicateReason`
- canonical evidence count
- raw evidence count
- collapsed duplicate evidence count
- per-session summaries
- evidence duplicate groups
- canonical project-level manifest
- canonical engineering bridge derived from deduped evidence representatives

The UI banner is exactly shaped to show: `7 survey submissions detected with overlapping evidence.` when seven overlapping submissions are detected.

## Session duplicate detection v1

Session grouping is deterministic and metadata-only. It uses:

- same `project_id`
- overlapping evidence fingerprints across survey IDs
- close submitted/created windows where available
- similar photo counts
- similar canonical category coverage
- same technician/source where available

The canonical survey is selected by deterministic score: required coverage first, classified evidence count next, raw photo count next, and newest timestamp as tie-breaker. Older sessions become `overlapping_duplicate`; singletons are `unique`.

## Photo duplicate detection v1

Photo evidence duplicate grouping is deterministic and metadata-only. It uses:

- `project_id`
- normalized filename or filename inferred from URL/storage key
- URL/storage key filename hints
- content type when present
- submitted category label
- canonical category
- survey ID grouping preservation

The canonical evidence representative is selected by deterministic score: categorized evidence first, persisted `site_survey_files` evidence next, filename/mime/capture metadata next, and newest timestamp as tie-breaker.

## Viewer behavior

The survey detail viewer now shows a `Survey Session Duplicate Hygiene v1` section when multiple submissions exist. It shows:

- survey submissions count
- raw photo upload count
- canonical evidence count
- collapsed repeat count
- canonical/current survey session
- older repeated submissions collapsed under an expandable section
- photo evidence duplicate groups under an expandable section
- explicit text that raw uploads are preserved and required coverage / engineering / permit evidence confidence uses canonical metadata representatives

The regular `SurveyEvidenceViewer` receives the canonical project-level manifest when hygiene is available, so coverage and bridge counts do not multiply-count repeated survey walks.

## Required coverage, engineering bridge, and permit confidence

Required evidence coverage now uses canonical evidence representatives across repeated sessions when project-level hygiene is available. A project that has the same meter photo uploaded seven times still contributes one canonical meter evidence item, not seven. The engineering bridge is built from the canonical manifest, so it does not inflate electrical/roof/site counts from repeated batches. Permit summaries can consume the same canonical manifest behavior and should not infer higher confidence simply because the same walking path was submitted repeatedly.

## Validation results

Focused tests:

```text
npm test -- --run lib/survey/evidence/sessionGrouping.test.ts lib/survey/evidence/manifest.test.ts lib/engineering/surveyEvidence.test.ts lib/permit/validationPageSurveyEvidence.test.ts
Result: 4 files passed, 13 tests passed
```

The new seven-session test verifies:

- seven `site_surveys` are preserved
- raw evidence count is 28 for 7 sessions x 4 repeated photos
- canonical evidence count collapses to 4
- collapsed duplicate evidence count is 24
- one canonical/latest/best survey is selected
- six historical overlapping submissions remain accessible
- four evidence duplicate groups are produced
- required categories count once each
- engineering bridge counts canonical representatives only

Type-check:

```text
npm run type-check
Result: exit 0
```

Production build:

```text
npm run build
Result: exit 0
```

Boundary scan:

```text
Targeted grep across survey evidence/API/UI/topology/permit surfaces
Result: 0 prohibited runtime imports/usages found
```

Build warnings were the expected sandbox missing-runtime-env warnings for variables such as `DATABASE_URL` and `JWT_SECRET`.

## Real-data caveat

The previously available `partner_db_audit.md` artifact does not fully encode the seven-submissions-for-one-project production case because that audit showed partner `projects` not yet used and `project_id=NULL` on all surveys. Therefore, the core seven-session behavior is covered by focused deterministic tests using realistic survey/file metadata. Live validation against the actual seven project-linked submissions still requires live DB access or a fresh export containing the affected `site_surveys` and `site_survey_files` rows.

## Boundaries and blockers

This is not OpenCV duplicate detection. It is not perceptual hashing. It does not compare image bytes. It cannot detect visual duplicates when metadata differs completely. It can only identify likely repeated sessions and duplicate evidence batches from deterministic metadata.

Before image-based duplicate scoring begins, provide real photo bytes and confirm this metadata grouping model remains the canonical evidence-preserving layer underneath future worker outputs.
