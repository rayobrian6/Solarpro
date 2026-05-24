# Professional Survey Parser Read-Only Integration v1

## Scope

This phase wires the completed Professional Site Survey Parser V1 into a real, authorized survey review path without promoting parser output to production authority. The integration remains read-only, review-first, deterministic, and preview-safe.

The integration produces an operator-facing `ProfessionalSurveyReadinessReportV1` from an authorized `SiteSurvey` row and its `SiteSurveyFile[]` attachments. The report includes the parser-derived `ProfessionalSiteSurveyEvidenceBundleV1`, `CanonicalSurveyGeometryV1`, and `SurveyCADReadinessV1`, plus operator readiness states and summary issue lists.

## Additive Backend Boundary

A new authorized GET-only endpoint was added:

```text
GET /api/site-surveys/[surveyId]/professional-readiness
```

The route follows the existing survey detail authorization pattern: it authenticates the request with `getUserFromRequest(req)`, validates the UUID with `isValidUUID`, loads the user-scoped survey with `getSiteSurveyById(surveyId, user.id)`, loads files with `getSiteSurveyFiles(surveyId)`, and returns a derived report.

The endpoint performs no persistence and exposes response metadata confirming the boundary:

```json
{
  "readOnly": true,
  "previewOnly": true,
  "nonAuthoritative": true,
  "cadSolverExecuted": false,
  "cadMutationPerformed": false,
  "downstreamTriggered": false
}
```

## Report Service

A new pure reporting service was added at:

```text
lib/siteSurvey/professionalSurveyReadinessReport.ts
```

The service exports `buildProfessionalSurveyReadinessReport(survey, files)` and a local `siteSurveyToEnrichedSurvey(survey, files)` adapter. The adapter converts DB-backed survey records into the existing normalized/enriched survey pipeline and then calls the parser V1 functions. It intentionally does not import private Engineering Intelligence hydration internals, does not write to the database, does not execute CAD solvers, and does not trigger permit, BOM, engineering, or production CAD flows.

The report exposes the required operator readiness states:

- `blocked`
- `review_required`
- `geometry_ready`
- `cad_preview_ready`

A bug discovered during regression testing was fixed: the report no longer treats the existence of a CAD input preview as sufficient for `cad_preview_ready` when the underlying parser readiness is still `review_required`. `cad_preview_ready` now requires `readinessStatus === 'cad_ready'`, `canBuildCADInput === true`, and a non-null `cadInputPreview`.

## Operator Readiness Panel

A read-only operator panel was added to the existing survey detail page:

```text
app/projects/[id]/survey/[surveyId]/page.tsx
```

The panel fetches `/api/site-surveys/${surveyId}/professional-readiness` independently from the existing survey detail fetch. It is displayed near the existing evidence manifest and traceability panels so operators can review parser readiness alongside evidence provenance.

The UI explicitly labels outputs as:

- Survey Derived
- Parser Derived
- Canonicalized
- Preview Only
- Review Required or Review Clear
- Non-Authoritative

The panel surfaces readiness state, system type, evidence item count, canonical roof plane count, obstruction count, setback count, invalid canonical geometry count, CAD preview eligibility/build status, blocking issues, missing required fields, parser and geometry warnings, review/confidence gaps, deterministic hashes, and no-authority enforcement flags.

## No-Authority Enforcement

The implementation preserves all parser V1 authority boundaries. The report and panel remain advisory and do not promote canonical geometry or CAD preview inputs to production truth.

Explicit enforcement flags in the report remain false:

- `dbWritesAllowed`
- `cadSolverExecutionAllowed`
- `productionCADMutationAllowed`
- `downstreamEngineeringAllowed`
- `downstreamPermitAllowed`
- `downstreamBOMAllowed`

## Regression Coverage

Focused regression coverage was added in:

```text
lib/siteSurvey/professionalSurveyReadinessReport.test.ts
```

Covered behavior includes deterministic clean-survey reporting, no-authority and no downstream execution flags, blocked reporting for self-intersecting roof geometry, and review-required reporting when required evidence is missing.

Focused parser/report validation command:

```bash
npm test -- lib/siteSurvey/professionalSurveyParser.test.ts lib/siteSurvey/professionalSurveyReadinessReport.test.ts --reporter=verbose
```

Observed result:

```text
Test Files 2 passed (2)
Tests 9 passed (9)
```

## Fixture / Real-Path Validation Notes

This phase validates the real application path from an authorized DB-backed `SiteSurvey` plus `SiteSurveyFile[]` through the read-only report service and into the survey detail UI. No uploaded survey fixture is persisted as canonical authority. The endpoint and panel are additive and do not change existing survey ingestion, PATCH behavior, CAD generation, permit generation, engineering intelligence execution, or BOM generation.

## Next Phase Recommendations

Future phases may add richer fixture replay and operator screenshots, but production authority promotion should remain a separate explicit architecture phase. Any future persistence of parser output should use a dedicated review/audit table or artifact store with clear non-authoritative labels until a formal authority-promotion design is approved.
