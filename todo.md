# Field Survey System — Master Directive Implementation
# Branch: dev only

## PHASE 1 — Database Migration
- [x] Read existing migrations to understand current schema
- [ ] Create migrations/016_site_surveys.sql — site_surveys + site_survey_files tables

## PHASE 2 — DB Layer (lib/db-neon.ts additions)
- [x] Add getSiteSurveysByProject, getSiteSurveysByClient, getSiteSurveyById
- [x] Add createSiteSurvey, updateSiteSurvey, addSiteSurveyFile, getSiteSurveyFiles

## PHASE 3 — API Routes
- [x] POST/GET /api/projects/[id]/site-surveys
- [x] GET /api/site-surveys/[surveyId]
- [x] GET /api/clients/[id]/site-surveys
- [x] PATCH /api/site-surveys/[surveyId]

## PHASE 4 — Ingest Integration
- [x] Update ingestPipeline.ts: create site_surveys row on submit
- [x] Wire photos into site_survey_files on ingest
- [x] Thread client_id through for both PM-initiated and standalone flows

## PHASE 5 — FieldSurveyCard component
- [x] Create components/project/FieldSurveyCard.tsx
- [x] State 1: No survey — CTA card (Start Survey + QR Code)
- [x] State 2: Survey exists — summary card + actions

## PHASE 6 — Survey Detail Page
- [x] Create app/projects/[id]/survey/[surveyId]/page.tsx
- [x] Photos grid, key observations, full data expandable

## PHASE 7 — Client Page Survey Tab
- [x] Add Site Surveys section to app/clients/[id]/page.tsx

## PHASE 8 — Project Page Integration
- [x] Insert FieldSurveyCard above tab nav (always visible)
- [x] QR code modal with copy link
- [x] Keep existing survey tab / FieldSurveyPanel intact

## PHASE 9 — TypeScript Check + Commit
- [ ] npx tsc --noEmit
- [ ] Fix errors, git commit to dev