# Master Directive — Align Site Survey Data
## Status: EXECUTING

### Phase 1 — Field Map Audit
- [x] Read lib/survey/v2/types.ts — all SurveyV2Payload fields extracted
- [x] Read lib/survey/ingest/transformLayer.ts — field mapping verified
- [x] Run Python audit script — zero gaps confirmed
- [x] Document all 35 meaningful fields with storage + display status

### Phase 2 — Storage Verification
- [x] Read ingestPipeline.ts — rawPayload stored verbatim in survey_data
- [x] Verify site_survey_files.label = photos[n].category (canonical key)
- [x] Verify project_physical_data = derived/normalized only (no raw duplication)
- [x] Read migrations 016/017 — schema confirmed
- [x] Read db-neon.ts SiteSurvey/SiteSurveyFile functions — read path confirmed

### Phase 3 — Single Read Source
- [x] getProjectSurveyContext confirmed as single read source
- [x] getSurveyDetailContext confirmed for detail page
- [x] API routes confirmed — /api/site-surveys/[surveyId] + /api/projects/[id]/survey-context

### Phase 4 — Clean Field Display
- [x] Survey detail page mirrors survey app 5-step structure exactly
- [x] All 8 human-readable label maps confirmed complete
- [x] Empty field handling confirmed (FieldRow shows "Not captured")
- [x] Photos grouped by canonical PhotoCategory order

### Phase 5 — No Extra Logic
- [x] Confirmed no new tables, pipelines, auth flows, or schemas added
- [x] Complexity audit passed — all components are minimal read paths
- [x] Over-engineering audit passed

### Phase 6 — Validation Output
- [x] Write MASTER_DIRECTIVE_VALIDATION.md with full field map, storage verification, mismatch list
- [x] Commit validation report to dev branch (78e5584)