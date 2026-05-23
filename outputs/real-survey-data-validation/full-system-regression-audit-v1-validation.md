# Full System Regression Audit v1 Validation Report

## Commands run after fixes

All required validation commands were rerun after the final code changes.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run type-check` | 0 | Passed |
| `npm test` | 0 | Passed: 140 test files, 4828 tests |
| `npm run build` | 0 | Passed |
| `npm run lint` | 0 | Passed with warnings |
| `bash scripts/full-system-regression-audit-scans.sh` | 0 | Completed scan log refresh |

## Type-check

Command: `npm run type-check`

Result: passed, exit `0`.

Log: `outputs/real-survey-data-validation/full-system-regression-audit-typecheck.log`

Key output:

```text
> solar-platform@1.0.0 type-check
> tsc --noEmit
```

No TypeScript errors were reported.

## Full test suite

Command: `npm test`

Result: passed, exit `0`.

Log: `outputs/real-survey-data-validation/full-system-regression-audit-npm-test.log`

Key output:

```text
Test Files  140 passed (140)
Tests       4828 passed (4828)
Duration    34.89s
```

Focused changed-area post-boundary tests also passed:

```text
4 files passed
35 tests passed
```

Focused log: `outputs/real-survey-data-validation/full-system-regression-audit-focused-tests-post-boundary.log`

## Build

Command: `npm run build`

Result: passed, exit `0`.

Log: `outputs/real-survey-data-validation/full-system-regression-audit-build.log`

The Next.js build completed successfully. The build log includes environment/sandbox warnings for missing runtime variables such as database/API keys, but those warnings did not fail the build.

## Lint

Command: `npm run lint`

Result: passed, exit `0`.

Log: `outputs/real-survey-data-validation/full-system-regression-audit-lint.log`

Warnings remain, primarily existing `no-console`, React hooks dependency, image/font, and related lint warnings. No lint rule was weakened and lint did not fail.

## Architecture and prohibited-boundary scans

Command: `bash scripts/full-system-regression-audit-scans.sh`

Result: completed, exit `0`.

Scan logs refreshed under `outputs/real-survey-data-validation/`:

- `full-system-regression-audit-prohibited-boundary.log`
- `full-system-regression-audit-todo-fixme-hack.log`
- `full-system-regression-audit-raw-count-usage.log`
- `full-system-regression-audit-evidence-manifest-direct.log`
- `full-system-regression-audit-provenance-guards.log`
- `full-system-regression-audit-decision-state-lineage.log`
- `full-system-regression-audit-imports-exports-types.log`
- `full-system-regression-audit-unsafe-field-evidence.log`
- `full-system-regression-audit-scan-summary.log`

Scan summary after fixes:

```text
full-system-regression-audit-prohibited-boundary.log 54
full-system-regression-audit-todo-fixme-hack.log 10
full-system-regression-audit-raw-count-usage.log 88
full-system-regression-audit-evidence-manifest-direct.log 69
full-system-regression-audit-provenance-guards.log 187
full-system-regression-audit-decision-state-lineage.log 199
full-system-regression-audit-imports-exports-types.log 1440
full-system-regression-audit-unsafe-field-evidence.log 0
```

Important interpretation:

- Unsafe optional-chain pattern `surveyEvidence?.fieldEvidence.`: zero hits.
- Active survey-ingest CV/vision execution path: removed.
- Remaining prohibited-boundary hits are classified in the main report as existing CAD paths, future-only/off labels, explicit quarantine text/tests, route-name/text hits, or false positives such as `revision` containing `vision`.
- Raw count hits are audit/history/debug/UI metadata or tests proving raw counts do not determine engineering truth.
- Provenance/decision/state lineage hits demonstrate guard and lineage implementations; no final validation failure was found.

## Circular dependency scan

Tool: `madge` output captured in `outputs/real-survey-data-validation/full-system-regression-audit-circular.log`.

Result: 9 circular dependencies found. This is documented as deferred architecture debt, not an unresolved validation blocker, because full type-check, tests, build, and lint pass and broad module refactoring was outside the surgical regression-fix scope.

## Regression tests added in this audit

1. `lib/engineeringDecisionProvenance/engineeringDecisionProvenance.test.ts`
   - Verifies missing `surveyEvidence.fieldEvidence` does not crash decision provenance and records explicit false geometry assumption.

2. `lib/survey/ingest/ingestPipeline.test.ts`
   - Verifies file-present survey ingest does not call vision inference/fetch even when `VISION_SERVICE_URL` is configured.

3. `lib/permit/validationPageSurveyEvidence.test.ts`
   - Verifies permit validation page renders missing field evidence as explicit missing defaults instead of crashing.

## Final validation status

The audited branch is validation-clean after the surgical fixes. All required validation commands pass. Deferred circular dependencies and legacy CAD/OCR text/path findings are documented in the failures report for follow-up and are not hidden by weakened tests or disabled guards.
