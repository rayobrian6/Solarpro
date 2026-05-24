# Professional Site Survey Parser V1 — Implementation and Boundary Report

## Summary

Professional Site Survey Parser V1 adds a deterministic, read-only parser boundary between the existing site-survey normalization/enrichment pipeline and CAD-input construction. The implementation is intentionally conservative: it creates evidence, canonical geometry, and readiness DTOs, but it does not execute the CAD solver, mutate CAD artifacts, write to persistence, or promote survey data into engineering, NEC, BOM, permit, workflow, recommendation, or downstream authority.

The new module is `lib/siteSurvey/professionalSurveyParser.ts`. It consumes existing `NormalizedSiteSurvey` or `EnrichedSiteSurvey` objects and emits three versioned DTOs: `ProfessionalSiteSurveyEvidenceBundleV1`, `CanonicalSurveyGeometryV1`, and `SurveyCADReadinessV1`.

## Existing pipeline audited

The implementation was placed after the existing pure survey pipeline:

`RawSurveyPayload → normalizeSurvey() → NormalizedSiteSurvey → enrichSurvey() → EnrichedSiteSurvey → buildCADFromSurvey()`

The audited modules were:

- `lib/siteSurvey/types.ts`
- `lib/siteSurvey/fromPhysicalData.ts`
- `lib/siteSurvey/normalizeSurvey.ts`
- `lib/siteSurvey/enrichSurvey.ts`
- `lib/cad/buildCADFromSurvey.ts`

The parser module uses the existing `buildCADFromSurvey()` bridge only when the input has already been enriched and the canonical geometry gate is ready. It does not call `generateCADLayout()` or any CAD solver/export path.

## New DTO boundaries

### Evidence bundle

`parseProfessionalSiteSurvey()` creates `ProfessionalSiteSurveyEvidenceBundleV1`, including:

- survey identity and source pipeline metadata
- deterministic source hash and bundle hash
- extracted field presence flags
- roof geometry candidates
- electrical service candidates
- structural candidates
- missing required fields
- blocking issues
- review status: `cad_ready`, `review_required`, or `blocked`
- explicit no-authority flags

### Canonical geometry

`buildCanonicalSurveyGeometry()` creates `CanonicalSurveyGeometryV1`, including:

- local XY coordinate space: `survey_local_xy_meters`
- origin resolved from survey GPS location or first roof vertex
- canonicalized roof-plane polygons in meters
- projected polygon validation
- blocking issues and warnings
- deterministic geometry hash
- explicit no-authority flags

### CAD readiness

`buildSurveyCADReadiness()` creates `SurveyCADReadinessV1`, including:

- source bundle and geometry hashes
- readiness status
- `canBuildCADInput`
- optional `cadInputPreview` produced only through the existing pure `buildCADFromSurvey()` bridge
- required review items
- blocking issues and warnings
- deterministic readiness hash
- explicit no-authority flags

## Authority and mutation constraints

Every emitted DTO carries authority flags fixed to `false`:

- `persistenceAllowed`
- `solverExecutionAllowed`
- `cadMutationAllowed`
- `canonicalGeometryMutationAllowed`
- `engineeringAuthorityAllowed`
- `necAuthorityAllowed`
- `bomAuthorityAllowed`
- `permitAuthorityAllowed`
- `downstreamAuthority`

This parser is not a permit source, engineering source, NEC source, BOM source, construction drawing source, proposal source, or CAD solver. It is a deterministic evidence and readiness boundary for future clean-CAD workflows.

## Validation behavior covered by tests

Focused tests were added in `lib/siteSurvey/professionalSurveyParser.test.ts` for:

1. Clean enriched roof survey → evidence bundle, canonical geometry, and CAD-input preview are `cad_ready` with no authority flags enabled.
2. Normalized-only roof survey → review required, no CAD-input preview is built, enrichment is required.
3. Self-intersecting roof polygon → blocked before CAD-input readiness and no CAD-input preview is built.
4. Ground survey → no false roof-plane requirement, readiness can build a ground-mount CAD-input preview.
5. Fence survey → no false roof-plane requirement, readiness can build a solar-fence CAD-input preview.

## Validation commands

Focused parser test command:

```bash
npm test -- lib/siteSurvey/professionalSurveyParser.test.ts --reporter=verbose
```

Observed result:

- 1 test file passed
- 5 tests passed

Type-check command:

```bash
npm run type-check
```

Observed result:

- TypeScript check completed with no reported errors.

## Next roadmap phase

The next high-leverage phase is to wire this parser into a real site-survey ingestion/report endpoint or job in read-only mode, then store or display the emitted DTOs as an operator-facing evidence/readiness artifact. The parser should remain non-authoritative until later phases introduce explicit review sign-off and controlled CAD solver handoff.
