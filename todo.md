# Survey Client/Project Association — Audit + Plan

## Phase 0: Audit [x]
- [x] lib/survey/types.ts — webhook contract
- [x] lib/survey/v2/types.ts — SurveyV2Draft/Payload types
- [x] lib/survey/v2/defaults.ts — JWT claims decode + draft builder
- [x] lib/survey/handoff/tokenMinter.ts — JWT minting (project_id required)
- [x] app/api/projects/[id]/survey-handoff/route.ts — handoff endpoint
- [x] app/api/survey/submit/route.ts — survey submission
- [x] lib/survey/ingest/ownerResolver.ts — 6-strategy owner resolution
- [x] lib/survey/ingest/projectLinkResolver.ts — project link resolution
- [x] lib/survey/ingest/ingestPipeline.ts — full pipeline
- [x] app/api/auth/mobile-session/route.ts — mobile SSO
- [x] components/survey/SurveyShell.tsx — shell UI
- [x] components/survey/StepSiteOverview.tsx — Step 1 UI
- [x] app/survey/[token]/page.tsx — survey page entry point
- [x] components/project/FieldSurveyPanel.tsx — project-side survey panel
- [x] types/index.ts — Client + Project types
- [x] lib/db-neon.ts — getClientsByUser, getProjectsByUser, createProject
- [x] app/api/clients/route.ts — clients API
- [x] app/api/projects/route.ts — projects API
- [x] migrations/011_survey_ingest.sql + 012_survey_ingest_v2.sql — DB schema
- [x] app/mobile-login/page.tsx — mobile SSO page

## Phase 1: Plan of Action (present to user) [x]
- [x] Write architectural plan document and present to user

## Phase 2: Implementation [ ]
### Decisions locked:
# Q1: picker REQUIRED (no orphans)
# Q2: B+A — show existing projects under client; "New project" option also available (for door knockers)
# Q3: Searchable combobox
# Q4: All users (mainly field techs)

- [ ] Step 2a: Update lib/survey/v2/types.ts — add standalone/selectedClientId/selectedProjectId fields
- [ ] Step 2b: Update lib/survey/handoff/tokenMinter.ts — allow standalone (no project_id)
- [ ] Step 2c: Update lib/survey/v2/defaults.ts — handle standalone JWT, update decodeTokenClaims
- [ ] Step 2d: New POST /api/survey/standalone-handoff route
- [ ] Step 2e: New GET /api/survey/lookup-data route (JWT-auth, returns clients+projects)
- [ ] Step 2f: Update lib/survey/types.ts — add solarpro_selected_project_id/client_id to webhook contract
- [ ] Step 2g: Update lib/survey/ingest/projectLinkResolver.ts — new strategies for selected project/client
- [ ] Step 2h: Update app/api/survey/submit/route.ts — handle standalone, forward selection
- [ ] Step 2i: Update components/survey/StepSiteOverview.tsx — add searchable client/project picker
- [ ] Step 2j: Update app/survey/[token]/page.tsx — fetch lookup data when standalone
- [ ] Step 2k: Update components/survey/SurveyShell.tsx — unassigned header state

## Phase 3: Testing [ ]
- [ ] Verify TypeScript compiles clean (tsc --noEmit)
- [ ] Verify no regressions to existing JWT-with-project flow