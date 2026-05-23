# Full System Regression Audit v1 Failures and Deferred Findings

## Final blocker status

No blocker remains after the fixes in this audit. Full validation passes:

- Type-check exit: `0`
- Full test exit: `0`
- Build exit: `0`
- Lint exit: `0`

## Failures found and fixed

### Fixed: engineering decision provenance crash on missing field evidence

Original failure class: runtime TypeError / render-adjacent provenance crash.

Root cause: `input.surveyEvidence?.fieldEvidence.hasRoofGeometry` optional-chained `surveyEvidence` but not `fieldEvidence`.

Fix: changed to `input.surveyEvidence?.fieldEvidence?.hasRoofGeometry` in `lib/engineeringDecisionProvenance/evaluator.ts`.

Regression test: `lib/engineeringDecisionProvenance/engineeringDecisionProvenance.test.ts` now verifies missing `fieldEvidence` does not crash and produces `survey.fieldEvidence.hasRoofGeometry:false`.

Status: fixed and covered.

### Fixed: active survey ingest CV/vision boundary violation

Original failure class: prohibited-boundary architectural violation.

Root cause: `lib/survey/ingest/ingestPipeline.ts` still launched `_runVisionPipelineAsync` after file-present ingest. That path could call a vision service, aggregate detections, update vision status metadata, and log CAD rebuild metadata from raw image URLs.

Fix: removed the active async vision trigger and helper functions from survey ingest. Step G is now a deterministic prohibited-boundary quarantine log. Ingest preserves persisted field evidence and canonical file history only.

Regression test: `lib/survey/ingest/ingestPipeline.test.ts` now verifies a file-present survey with `VISION_SERVICE_URL` configured is ingested without calling `fetch`.

Status: fixed and covered.

### Fixed: permit validation page crash on missing field evidence

Original failure class: broken render path.

Root cause: `lib/permit/sections/validationPage.ts` directly dereferenced `surveyEvidence.fieldEvidence` fields.

Fix: added explicit missing/default fallback `fieldEvidence` values and render rows now use the fallback.

Regression test: `lib/permit/validationPageSurveyEvidence.test.ts` now verifies missing field evidence renders `missing`, `planes: 0`, and `MSP: —A` instead of crashing.

Status: fixed and covered.

## Deferred findings

### Deferred: circular dependencies

`madge` reported 9 circular dependencies:

1. `lib/bom-engine-v4.ts > lib/bom-system-profiles.ts`
2. `lib/cad/adapter.ts > lib/drafting/index.ts > lib/drafting/composers/index.ts`
3. `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/fence/fenceCAD.ts`
4. `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/ground/groundCAD.ts`
5. `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/roof/roofCAD.ts`
6. `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts`
7. `lib/drafting/index.ts > lib/drafting/composers/index.ts`
8. `lib/survey/evidence/engineeringBridge.ts > lib/survey/evidence/engineeringRequirements.ts > lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts`
9. `lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts`

Reason deferred: full type-check, tests, build, and lint pass. Fixing these cycles would require broader module topology refactoring, especially around CAD/drafting and survey evidence modules, which is outside this audit's surgical regression-fix scope.

Risk: future integration drift, test-order sensitivity, and hidden initialization coupling. Recommended follow-up: dedicated dependency inversion cleanup with no feature work.

### Deferred: existing CAD generation/render references

The prohibited-boundary scan still finds existing `generateCADLayout` references in permit and drafting paths. These are existing CAD solver/render paths, not newly introduced audit changes. The audit did not refactor them because the prompt explicitly prohibited new CAD work or broad refactors unless required to fix proven regressions.

Risk: CAD/drafting cycles overlap with the circular dependency findings. Recommended follow-up: separate architecture cleanup to isolate pure render context/provenance adapters from CAD solver entry points.

### Deferred: existing lint warnings

`npm run lint` exits `0` but reports warnings, primarily `no-console` and existing Next.js/react lint warnings. These were not weakened and were not converted to errors in this audit.

Risk: warning noise can hide future lint signal. Recommended follow-up: gradual lint cleanup by domain, not bundled with this regression audit.

### Deferred: UI/future capability text and existing OCR route references

The prohibited-boundary scan still finds future capability labels and UI text around OCR/CV/CAD/semantic extraction, plus existing route names such as `/api/ocr`. The audited survey evidence registry text states these future capabilities are off/documented/future-only and do not activate OCR, CV, semantic extraction, CAD inference, or image-byte inspection.

Risk: user-facing text may imply capability availability if not carefully worded. Recommended follow-up: product/UX review of future capability language.

## Non-failures classified during scan

Raw upload/photo count hits in validation UI, survey detail UI, provenance guards, and tests are metadata/audit/history usages. They are not used as downstream engineering truth after the fixes. Tests explicitly verify duplicate raw upload counts do not inflate canonical truth or invalidation hashes.

Direct `evidenceManifest` usage in survey detail route/page is either a per-survey detail artifact or a fallback for display. Downstream engineering paths prefer or consume `evidenceHygiene.canonicalManifest` and canonical traceability.

Decision/state lineage scan hits demonstrate lineage fields, guards, and tests rather than missing lineage. Guard tests intentionally construct missing-lineage records and assert failure.
