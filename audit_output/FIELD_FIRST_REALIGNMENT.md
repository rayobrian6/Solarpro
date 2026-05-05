# FIELD-FIRST REALIGNMENT — FINAL SYSTEM STATE
## Commit: 709a2bc | Branch: dev | Date: post-MASTER-DIRECTIVE

---

## CORE TRUTH (Enforced)

> SolarPro ONLY stores, displays, and uses survey data.
> It does NOT start surveys, control survey flow, or require buttons to initiate surveys.
> The mobile app owns all survey initiation and client/project selection.

---

## 1. REMOVED / DISABLED COMPONENTS

### API Routes → 410 Gone

| Route | Was | Now |
|-------|-----|-----|
| `POST /api/projects/[id]/survey-handoff` | Minted HS256 handoff JWT + QR for SolarPro-initiated surveys | **410** `SURVEY_INITIATION_DISABLED` |
| `POST /api/survey/standalone-handoff` | Minted standalone JWT for self-initiated surveys | **410** `SURVEY_INITIATION_DISABLED` |
| `POST /api/auth/mobile-session` | SSO bridge — minted session JWT for mobile login from SolarPro | **410** `MOBILE_SSO_DISABLED` |
| `GET /api/survey/lookup-data` | Served client/project lists to SolarPro-initiated standalone picker | **410** `ENDPOINT_DISABLED` (redirects to `/api/mobile/clients`) |

### Pages

| Page | Was | Now |
|------|-----|-----|
| `app/mobile-login/page.tsx` | SSO bridge UI calling `POST /api/auth/mobile-session` | Static "Mobile Login Unavailable" message |

### UI Components / Props Removed

| File | Removed |
|------|---------|
| `app/projects/[id]/page.tsx` | `handleStartSurvey`, `handleShowQR`, `surveyHandoffLoading`, `showQRModal`, `qrToken`, `qrWebUrl` state; Start Survey quick action; QR modal (~45 lines); `import QRCode from 'react-qr-code'` |
| `components/project/FieldSurveyCard.tsx` | `onStartSurvey`, `surveyHandoffLoading`, `onShowQR` props; `NoSurveyState` Start Survey + QR buttons; `SurveyExistsCard` Retake Survey + Send to Field buttons |
| `components/project/FieldSurveyPanel.tsx` | `onStartSurvey`, `surveyHandoffLoading` props; `NoDataState` Start Survey button |

### Library Functions (orphaned — no callers remain)

| Function | File | Status |
|----------|------|--------|
| `mintHandoffToken()` | `lib/survey/handoff/tokenMinter.ts` | No app/component imports it. Dead code. Safe to delete in future cleanup. |
| `buildHandoffUrl()` | `lib/survey/handoff/tokenMinter.ts` | No app/component imports it. Dead code. Safe to delete in future cleanup. |

**Total removed/disabled:** 4 routes disabled, 1 page disabled, 3 UI components cleaned, ~956 lines net removed.

---

## 2. RETAINED COMPONENTS (Active, Correct)

### Survey Receive & Ingest Chain

| Component | Route / File | Purpose |
|-----------|-------------|---------|
| Survey submit | `POST /api/survey/submit` | Accepts completed SurveyV2Payload from mobile, verifies JWT, forwards to ingest |
| Webhook ingest | `POST /api/webhooks/survey-complete` | HMAC-verified ingest entry point |
| Ingest pipeline | `lib/survey/ingest/ingestPipeline.ts` | Orchestrates all ingest steps |
| Project link resolver | `lib/survey/ingest/projectLinkResolver.ts` | Links survey to correct project |
| Transform layer | `lib/survey/ingest/transformLayer.ts` | Maps payload fields → `project_physical_data` |
| Payload fetcher | `lib/survey/ingest/payloadFetcher.ts` | Fetches full raw payload |
| Owner resolver | `lib/survey/ingest/ownerResolver.ts` | Resolves owning user |

### Database Storage

| Table | Content |
|-------|---------|
| `site_surveys` | Full raw `survey_data` JSONB + metadata |
| `site_survey_files` | Photos with `label` = `PhotoCategory` key |
| `project_physical_data` | Derived/normalized engineering values only |
| `webhook_deliveries` | Ingest status tracking per delivery |

### Survey Read / UI Chain

| Component | File | Purpose |
|-----------|------|---------|
| Survey context | `lib/survey/getProjectSurveyContext.ts` | Single read source — assembles surveys, files, typed payload |
| Survey card | `components/project/FieldSurveyCard.tsx` | Displays survey summary on project page (read-only) |
| Survey panel | `components/project/FieldSurveyPanel.tsx` | Full survey data display panel (read-only) |
| Site surveys API | `GET /api/site-surveys/[surveyId]` | Returns individual survey record |

### Mobile App Selection (New — Phase 4)

| Route | Purpose |
|-------|---------|
| `GET /api/mobile/clients` | Returns all clients for authenticated user. Auth: session cookie OR Bearer handoff JWT. |
| `GET /api/mobile/clients/:clientId/projects` | Returns projects for a specific client. Validates client ownership. Same dual auth. |

### Auth / Token Infrastructure (Retained — read-side use)

| Component | File | Retained Use |
|-----------|------|-------------|
| `verifyHandoffToken()` | `lib/survey/handoff/tokenMinter.ts` | Used by submit route + new mobile endpoints to verify incoming Bearer JWTs |
| `getUserFromRequest()` | `lib/auth` | Session cookie auth for all routes |

### Survey Form Shell (Retained — receive path only)

| Component | File | Note |
|-----------|------|------|
| Survey form | `app/survey/[token]/page.tsx` | Renders survey steps for mobile field device. JWT comes from mobile app, not SolarPro. Standalone branch (`claims.standalone === true`) is now unreachable dead code (no minter exists) but harmless. |

---

## 3. FIELD-FIRST ARCHITECTURE (Confirmed)

```
MOBILE FIELD APP
    │
    ├── GET /api/mobile/clients              ← NEW: mobile self-selects client
    ├── GET /api/mobile/clients/:id/projects ← NEW: mobile self-selects project
    │
    ├── [Field tech completes survey on device]
    │
    └── POST /api/survey/submit
            │
            └── POST /api/webhooks/survey-complete  (HMAC verified)
                    │
                    └── runIngestPipeline()
                            │
                            ├── projectLinkResolver   → links to project
                            ├── transformLayer        → project_physical_data
                            └── DB writes
                                    ├── site_surveys.survey_data (full raw JSONB)
                                    ├── site_survey_files        (photos)
                                    └── project_physical_data    (derived values)

SOLARPRO WEB APP (READ-ONLY for survey data)
    │
    └── getProjectSurveyContext(projectId)
            │
            ├── site_surveys        → SiteSurvey[]
            ├── site_survey_files   → SiteSurveyFile[]
            └── project_physical_data
                    │
                    ├── FieldSurveyCard  (summary display)
                    └── FieldSurveyPanel (full display)
```

**SolarPro has NO outbound connections to the mobile app.**
**SolarPro has NO survey-initiation buttons, QR codes, or handoff flows.**
**All survey data flows: Mobile → Webhook → Storage → UI (one direction).**

---

## 4. REMAINING RISKS / WEAK POINTS

| Risk | Severity | Notes |
|------|----------|-------|
| `mintHandoffToken` / `buildHandoffUrl` are dead code | Low | Still exist in `lib/survey/handoff/tokenMinter.ts`. No callers. Safe to delete in a dedicated lib cleanup pass. |
| `app/survey/[token]/page.tsx` standalone branch | Low | `claims.standalone === true` branch is unreachable (no minter exists). Will never trigger. Safe to prune in a dedicated cleanup. |
| No rate limiting on new mobile endpoints | Medium | `GET /api/mobile/clients` and `GET /api/mobile/clients/:clientId/projects` have no rate limiter applied. Should add `applyRateLimit()` consistent with other mobile-facing routes. |
| `verifyHandoffToken` still accepts expired tokens check | Low | Confirm JOSE/jsonwebtoken verifies `exp` claim strictly. Submit route handles this; confirm new mobile endpoints reject expired JWTs (they call same `verifyHandoffToken` — should be fine). |
| Real survey data validation pending | High | The original "validate real SurveyV2Payload against DB" task (Phase 2 of previous directive) was not completed due to missing DB credentials. Should be done once DB access is available: capture live webhook payload, diff against `site_surveys.survey_data`, verify `project_physical_data` mapping. |

---

## 5. COMMIT HISTORY (This Directive)

| Commit | Description |
|--------|-------------|
| `78e5584` | audit: MASTER_DIRECTIVE_VALIDATION report (previous session) |
| `709a2bc` | feat: field-first realignment — disable survey initiation, add mobile client/project endpoints |

---

## 6. NEXT RECOMMENDED ACTIONS

1. **Rate-limit the new mobile endpoints** — apply `applyRateLimit()` to `GET /api/mobile/clients` and `GET /api/mobile/clients/:clientId/projects`
2. **Delete dead minting code** — remove `mintHandoffToken`, `buildHandoffUrl`, and their JSDoc from `lib/survey/handoff/tokenMinter.ts`; prune standalone branch from `app/survey/[token]/page.tsx`
3. **Real data validation** — provide DB credentials and capture a live `SurveyV2Payload` from webhook; diff against `site_surveys.survey_data` and `project_physical_data` to confirm field mapping accuracy
4. **Mobile app integration test** — test `GET /api/mobile/clients` and `GET /api/mobile/clients/:clientId/projects` with a real Bearer JWT from the mobile app