# Full System Regression + Architecture Audit v1 Report

Repository: `rayobrian6/Solarpro`
Branch audited: `dev`
Audit scope: survey evidence ingestion, canonical manifests, evidence hygiene, requirement registry, provenance, document binding, decision provenance, engineering state invalidation, selective regeneration planning, permit validation/generation, render context / plan-set render paths, SLD and BOM metadata integrations, survey detail UI, and related admin/project summary surfaces.

## Executive conclusion

The audit found and fixed three high-impact regressions or architectural boundary violations before feature work continued. First, engineering decision provenance could crash when `surveyEvidence` existed but `fieldEvidence` was missing. Second, survey ingest still had a reachable asynchronous CV/vision inference path for file-present surveys, which violated the canonical survey evidence truth boundary and the explicit stop on CV/OCR/AI/image-byte feature work. Third, the permit validation page directly dereferenced `surveyEvidence.fieldEvidence`, creating a broken render path for partial or legacy survey evidence objects.

After the fixes and regression tests, the full validation suite passes. `npm run type-check`, `npm test`, `npm run build`, and `npm run lint` all exited `0`. Full Vitest results were 140 test files passed and 4828 tests passed. The refreshed scan suite reports zero hits for the unsafe `surveyEvidence?.fieldEvidence.` optional-chain pattern. Remaining prohibited-boundary scan hits are classified as either informational future-capability labels, existing CAD solver/render paths outside this no-feature-work audit, explicit quarantine text/tests, or deferred architectural debt rather than new active CV/OCR/image-byte execution from survey ingest.

`dev` is safe to continue from for the audited regression scope after these changes, with deferred architecture debt documented below. The main deferred risk is the existing circular dependency set reported by `madge`, plus legacy/direct CAD generation paths that were not refactored because the prompt forbade broad CAD/CV/OCR feature work and full validation is passing.

## Issues found and fixed

### 1. Engineering decision provenance missing-field crash

Severity: high/blocker runtime regression.

Evidence: full tests initially exposed `TypeError: Cannot read properties of undefined (reading 'hasRoofGeometry')` from `lib/engineeringDecisionProvenance/evaluator.ts`. The unsafe expression was `input.surveyEvidence?.fieldEvidence.hasRoofGeometry`, where optional chaining protected only `surveyEvidence` and not `fieldEvidence`.

Fix: changed the expression to `input.surveyEvidence?.fieldEvidence?.hasRoofGeometry`, preserving deterministic fallback output of `survey.fieldEvidence.hasRoofGeometry:false` when field evidence is absent.

Regression coverage: added `does not crash geometry decision provenance when survey field evidence is missing` in `lib/engineeringDecisionProvenance/engineeringDecisionProvenance.test.ts`.

### 2. Survey ingest prohibited-boundary leak through active vision pipeline

Severity: high architectural truth-boundary violation.

Evidence: the prohibited-boundary scan found reachable code in `lib/survey/ingest/ingestPipeline.ts` that triggered `_runVisionPipelineAsync` after file-present survey ingestion. That helper read `VISION_SERVICE_URL`, posted image URLs to `/vision/infer`, imported the vision aggregator, updated `survey_meta.visionStatus`, and logged CAD rebuild metadata. This violated the audit constraints: no CV/OCR/AI/image-byte logic, no autonomous inference, and no mutation of engineering truth from raw uploads.

Fix: removed the active trigger and removed the `_runVisionPipelineAsync` / `_updateVisionStatus` helper implementation from the ingest pipeline. Step G now explicitly logs a prohibited-boundary quarantine and stops after persistence. The ingest pipeline preserves immutable survey evidence and canonical file history; downstream engineering must use canonical manifests and provenance-aware evaluation paths.

Regression coverage: added `persists file-present surveys without calling vision inference even when VISION_SERVICE_URL is configured` in `lib/survey/ingest/ingestPipeline.test.ts`. The test stubs `globalThis.fetch`, configures `VISION_SERVICE_URL`, ingests one photo, verifies status `ingested`, verifies file count `1`, and verifies `fetch` was not called.

### 3. Permit validation page render crash on missing field evidence

Severity: high render-path regression risk.

Evidence: `lib/permit/sections/validationPage.ts` dereferenced `surveyEvidence.fieldEvidence.hasPhysicalData`, `hasRoofGeometry`, electrical fields, and structural fields directly. Partial or legacy survey evidence objects could cause permit validation rendering to throw instead of reporting missing data.

Fix: added a local fallback `fieldEvidence` object with explicit missing/default values and changed rendering rows to use the fallback. Missing field evidence now renders as missing physical/roof/electrical/structural data instead of crashing.

Regression coverage: added `renders missing field evidence as missing instead of crashing` in `lib/permit/validationPageSurveyEvidence.test.ts`.

## Architecture scan classifications

### Prohibited boundary scan

Result: scan completed. The active survey-ingest CV/vision execution path was removed. Remaining hits include revision text false positives, existing CAD solver/generation references, future capability labels explicitly stating OCR/CV/CAD/semantic extraction are off or future-only, explicit quarantine comments/logs/tests, and existing API route names such as `/api/ocr` that are outside the surgical fixes made in this audit.

Important remaining examples:

- `lib/survey/ingest/ingestPipeline.ts` now contains only the quarantine text and log, not a vision call.
- `lib/survey/ingest/ingestPipeline.test.ts` verifies no fetch/vision inference call occurs with `VISION_SERVICE_URL` configured.
- `lib/survey/evidence/engineeringRequirements.ts` and survey detail UI expose future capability labels and deterministic notes that capabilities do not activate OCR, CV, semantic extraction, CAD inference, or image-byte inspection.
- `lib/permit/generatePermit.ts` and `lib/drafting/composers/index.ts` still use existing `generateCADLayout` flows. These are existing CAD render/generation paths, not new feature work from this audit, and were not refactored because the prompt prohibited broad CAD work.

### TODO/FIXME/HACK/temp bypass scan

Result: scan completed. Hits are limited and not newly introduced hidden bypasses. Notable hits include a pre-existing SLD compliance bypass comment, cache bypass comments in project page, lint disable comments in UI image/hook areas, a document provenance test intentionally named for bypass failure, and pre-existing TODO comments in drafting template spacing and survey ingest type URL-scheme confirmation. No new test-weakening or guard-bypass code was added.

### Raw survey/photo count scan

Result: scan completed. Raw count fields remain in audit/history/debug/UI metadata and in tests that prove duplicate raw upload counts do not inflate engineering truth. Notable engineering paths use canonical manifest totals and canonical evidence IDs for downstream truth. `lib/permit/sections/validationPage.ts` still renders raw upload counts explicitly labeled `audit-only`; this is acceptable as metadata. `lib/engineering/surveyEvidence.ts` carries `rawPhotoCount` and `canonicalEvidenceCount`, but the deterministic engineering bridge and provenance paths derive from canonical manifests and traceability.

### Direct evidenceManifest/canonicalManifest scan

Result: scan completed. The direct `evidenceManifest` fallback in `app/projects/[id]/survey/[surveyId]/page.tsx` is confined to survey detail display and explicitly prefers `evidenceHygiene?.canonicalManifest`. Engineering permit route consumes `evidenceHygiene.canonicalManifest` where available. `lib/engineering/surveyEvidence.ts`, requirement evaluation, provenance, and bridge builders are canonical-manifest-oriented. No new downstream engineering truth path was found that prefers raw `evidenceManifest` over `evidenceHygiene.canonicalManifest`.

### Document provenance guard scan

Result: scan completed. Document provenance bundle construction and guard assertions exist in `lib/documentProvenance`. `lib/permit/generatePermit.ts` builds decision provenance, document provenance, engineering state registry, invalidation lineage, decision-aware BOM metadata, and decision-aware SLD metadata before rendering. `buildRenderContext` and `renderPlanSet` accept and carry provenance/decision/state metadata. Tests cover registry-bypass guard failure and render-context provenance survival. No failing provenance guard validation was found in the final regression run.

### Decision/state dependency lineage scan

Result: scan completed. Decision provenance records include `dependencyNodeIds` and `derivedFrom`; engineering decision guards enforce lineage. Engineering state invalidation records carry provenance and dependency hashes; selective regeneration planning remains a bounded plan only and does not execute autonomous regeneration. Tests cover missing-lineage guard failure, deterministic selective regeneration plans, and duplicate raw upload count changes not invalidating canonical state hashes.

### Imports/exports/circular dependency scan

Result: `madge` found 9 circular dependencies. These are documented as deferred architecture debt because full type-check/test/build/lint pass and broad refactoring of CAD/drafting/survey evidence module topology was outside the allowed surgical fix scope.

Circular dependencies reported:

1. `lib/bom-engine-v4.ts > lib/bom-system-profiles.ts`
2. `lib/cad/adapter.ts > lib/drafting/index.ts > lib/drafting/composers/index.ts`
3. `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/fence/fenceCAD.ts`
4. `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/ground/groundCAD.ts`
5. `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/roof/roofCAD.ts`
6. `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts`
7. `lib/drafting/index.ts > lib/drafting/composers/index.ts`
8. `lib/survey/evidence/engineeringBridge.ts > lib/survey/evidence/engineeringRequirements.ts > lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts`
9. `lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts`

## Validation summary

- `npm run type-check`: passed, exit `0`.
- `npm test`: passed, exit `0`; 140 test files passed, 4828 tests passed.
- `npm run build`: passed, exit `0`; Next.js build completed. Build log contains sandbox/environment warnings about missing optional runtime environment variables but no build failure.
- `npm run lint`: passed, exit `0`; warnings remain, primarily pre-existing `no-console`, hook dependency, image/font warnings, and similar lint warnings.
- Focused changed-area tests: passed; 4 files passed, 35 tests passed in the post-boundary focused run.
- Prohibited-boundary scan: active survey-ingest CV/vision execution path fixed; remaining hits classified above.
- Unsafe field-evidence scan: zero hits for `surveyEvidence?.fieldEvidence.` after fixes.

## Files changed

Code and tests:

- `lib/engineeringDecisionProvenance/evaluator.ts`
- `lib/engineeringDecisionProvenance/engineeringDecisionProvenance.test.ts`
- `lib/survey/ingest/ingestPipeline.ts`
- `lib/survey/ingest/ingestPipeline.test.ts`
- `lib/permit/sections/validationPage.ts`
- `lib/permit/validationPageSurveyEvidence.test.ts`

Audit support and deliverables:

- `scripts/full-system-regression-audit-scans.sh`
- `todo.md`
- `outputs/real-survey-data-validation/full-system-regression-audit-v1-report.md`
- `outputs/real-survey-data-validation/full-system-regression-audit-v1-failures.md`
- `outputs/real-survey-data-validation/full-system-regression-audit-v1-validation.md`
- refreshed validation and scan logs under `outputs/real-survey-data-validation/`

## Tests added

- Decision provenance regression: missing `surveyEvidence.fieldEvidence` does not crash and records `survey.fieldEvidence.hasRoofGeometry:false`.
- Survey ingest prohibited-boundary regression: file-present ingest does not call vision inference/fetch even when `VISION_SERVICE_URL` is configured.
- Permit validation render regression: missing field evidence renders explicit missing defaults instead of throwing.

## Deferred issues

The following are intentionally deferred because they are not failing validation after the surgical fixes and broad refactors/new feature work were prohibited:

- Nine circular dependencies reported by `madge`, mostly CAD/drafting and survey evidence module cycles.
- Existing CAD generation/render paths using `generateCADLayout` in permit/drafting flows. These are established render/generation paths and were not modified beyond audit classification.
- Existing lint warnings. Lint exits `0`, so warnings were not treated as blockers.
- Existing UI/future capability mentions of OCR/CV/CAD/semantic extraction, where text states they are documented, off, or future-only.
- Existing `/api/ocr` route and other non-survey-ingest OCR references outside this audit's surgical fix path.

## Safety status

For the audited systems, `dev` is safe to continue from after these changes. The branch passes full validation and the active survey-ingest prohibited-boundary leak has been removed. Engineering truth remains bounded by canonical manifests, provenance, requirement evaluation, dependency lineage, and deterministic state invalidation planning. Continued work should address the deferred circular dependency debt in a separate architecture cleanup, not as hidden feature work.
