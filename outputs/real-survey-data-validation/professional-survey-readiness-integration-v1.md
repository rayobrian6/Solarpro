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

## Expanded Fixture Coverage Addendum v1

The follow-up fixture expansion phase added reusable messy real-world survey fixtures in:

```text
lib/siteSurvey/professionalSurveyExpandedFixtures.ts
```

The fixture set covers all requested cases: clean roof survey, missing roof pitch, missing azimuth, duplicate roof planes, bad/self-intersecting polygon, obstruction-only survey, ground mount survey, solar fence survey, conflicting panel count, wrong/mixed units, incomplete electrical service data, meter location present with MSP missing, MSP present with utility/service detail missing, roof geometry present but no usable CAD preview, uploaded/document-derived survey with partial evidence, and a normalized-only survey with enough canonical geometry for `geometry.readyForCADInput` but without enriched CAD preview availability.

Dedicated regression coverage was added in:

```text
lib/siteSurvey/professionalSurveyExpandedFixtures.test.ts
```

The expanded tests verify parser and report readiness states, deterministic source/bundle/geometry/readiness hashes, no-authority flags, no false `cad_preview_ready` promotion, no raw fixture mutation, no blocked-case CAD preview generation, roof/ground/fence classification, unsupported/invalid roof geometry blocking, confidence gaps for missing electrical evidence, and the parser-level `geometry_ready` without CAD preview condition for normalized-only input.

The fixture assertions intentionally reflect current parser behavior. Missing roof pitch and missing azimuth are defaulted by the existing normalizer and currently remain `cad_preview_ready` when all other required evidence is present. Duplicate roof planes are retained without de-duplication or warning. Conflicting panel-count notes are not parsed as structured conflicts. Missing utility/provider detail is not currently a required parser field when MSP rating and interconnection point are present. Mixed area strings such as `850 sq ft` are not parsed as area and can normalize to zero, causing blocked geometry. These are documented as native hardening opportunities rather than silently changed in this phase.

Focused expanded fixture validation command:

```bash
npm test -- lib/siteSurvey/professionalSurveyExpandedFixtures.test.ts --reporter=verbose
```

Observed result:

```text
Test Files 1 passed (1)
Tests 34 passed (34)
```

## OSS Candidate Decision Matrix Addendum v1

The follow-up audit phase produced two additional reports:

```text
outputs/real-survey-data-validation/oss-candidate-decision-matrix-v1.md
outputs/real-survey-data-validation/oss-first-adapter-recommendation-v1.md
```

The matrix evaluates polygon validation/topology repair, geometry clipping/intersections, DXF/SVG CAD utilities, OCR/document parsing, computer vision, spatial indexing, and snapping/constraint utility categories. It compares `polygon-clipping`, `martinez-polygon-clipping`, `jsts`, `@turf/turf`, `rbush`, `flatbush`, `makerjs`, `dxf-writer`, `svg-pathdata`, `tesseract.js`, `sharp`, and `opencv.js` using extracted npm metadata and the existing audit findings.

The first safe adapter recommendation is a future, isolated, non-authoritative geometry predicate/topology cross-check adapter using `polygon-clipping` as the preferred candidate. No OSS package was integrated during this phase. The recommended adapter must remain optional, review-only, deterministic, fixture-tested, and unable to mutate CAD, persist canonical geometry, trigger solvers, or promote downstream engineering/permit/BOM authority.

## Expanded Phase Validation Notes

The expanded fixture phase remains fixture/test/audit only. No broad OSS package was integrated. No SolarPro geometry authority was replaced. No CAD solver was triggered. No CAD or canonical production geometry was mutated. No parser output was promoted to permit, engineering, NEC, BOM, or production CAD authority.

Combined focused validation command for the expanded phase:

```bash
npm test -- lib/siteSurvey/professionalSurveyParser.test.ts lib/siteSurvey/professionalSurveyReadinessReport.test.ts lib/siteSurvey/professionalSurveyExpandedFixtures.test.ts --reporter=verbose
npm run type-check
```

Observed combined result:

```text
Test Files 3 passed (3)
Tests 43 passed (43)
tsc --noEmit completed with no reported errors
```
