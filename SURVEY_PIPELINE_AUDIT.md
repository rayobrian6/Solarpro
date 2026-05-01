# Site Survey Pipeline Audit — v60.4-save

**Audit date:** 2026-04-28
**Auditor:** Continuation session
**Scope:** End-to-end integration of the Site Survey app into the SolarPro website pipeline.

---

## TL;DR

The site survey pipeline has **two parallel, partially-connected implementations**, a **desktop-to-mobile dead-end on the Start Survey button**, a **dead web upload endpoint whose target table does not exist in any migration**, and **5 override modules in `lib/siteSurvey/` with zero callers** (except one — the engineering generate route — which does wire through `applyToSystemDefinition`).

The **ingest-from-partner webhook path is LIVE and working**, and writes to `project_physical_data`. The **engineering reports read 4 of 20 captured fields**. The **CAD / Permit / Proposal systems do not consume survey data at all.**

---

## 1. High-level data flow (as implemented today)

```
                         ┌──────────────────────────────────────────┐
                         │  Partner mobile field app (EXTERNAL)     │
                         │  - Captures photos + physical + electrical  │
                         │  - Stores in partner DB                  │
                         └────────────────┬─────────────────────────┘
                                          │  HMAC-signed webhook
                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ POST /api/webhooks/survey-complete          [LIVE]                  │
│   - Verify HMAC (SURVEY_WEBHOOK_SECRET)                             │
│   - Record webhook_deliveries row                                   │
│   - resolveIngestOwner() → ownerId                                  │
│   - runIngestPipeline()                                             │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ runIngestPipeline (lib/survey/ingest/ingestPipeline.ts)  [LIVE]     │
│   A. validate ownerId                                               │
│   B. resolveProjectLink (create | attach | triage)                  │
│   C. fetchFullPayload(surveyId)  ← GET partner /api/surveys/{id}    │
│   D. transform (v1.0 or v2.0 transformer)                           │
│   E. _upsertProject → projects table                                │
│      _upsertPhysicalData → project_physical_data  ← ENGINEERING DB  │
│      _insertFiles → project_files                                   │
│   F. mark webhook_deliveries as 'ingested'                          │
│   G-J. Fire-and-forget vision pipeline (YOLOv8 inference → SysDef)  │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
                       [project_physical_data]
                       20 fields captured
                             │
                             ▼
   ┌─────────────────────────┴─────────────────────────┐
   │ Engineering consumers (read via getProjectPhysicalData)│
   │                                                         │
   │  app/api/engineering/generate       → fromPhysicalData → normalize → enrich → applyToSystemDefinition  │
   │  app/api/engineering/permit         → fromPhysicalData → normalize → enrich (used in permit context)    │
   │  app/api/engineering/preliminary    → fromPhysicalData → normalize → enrich (used in preliminary context)│
   │  lib/engineering/reportGenerator    → reads 4 raw fields: panel_rating_amps, rafter_spacing_in,         │
   │                                        roof_material, interconnection_point                             │
   └─────────────────────────────────────────────────────────┘

   ─── Separate, isolated, likely-broken path ─────────────────
   POST /api/site-survey/upload    [DEAD]
     → normalizeSurvey → enrichSurvey → INSERT project_site_surveys
     (project_site_surveys table has NO migration in repo)
     (ZERO callers anywhere in app/)
```

---

## 2. File map of the pipeline

| File | Role | Status |
|---|---|---|
| `app/survey/[token]/page.tsx` | Web-based survey form (6 steps) | **LIVE but unreachable** — see §4.1 |
| `app/api/survey/submit/route.ts` | JWT-authed submission endpoint from web form | LIVE (only reachable if user lands on `/survey/[token]`) |
| `app/api/webhooks/survey-complete/route.ts` | HMAC-verified webhook from partner app | **LIVE (production path)** |
| `app/api/projects/[id]/survey-handoff/route.ts` | Mints JWT + returns survey launch URL | LIVE — but returns `sitesurvey://` deep link only |
| `app/api/projects/[id]/physical-data/route.ts` | GET project_physical_data for UI panel | LIVE |
| `app/api/site-survey/upload/route.ts` | Alternate upload endpoint | **DEAD — 0 callers, target table missing** |
| `lib/survey/ingest/ingestPipeline.ts` | Main partner-webhook pipeline | LIVE |
| `lib/survey/ingest/transformLayer.ts` | v1.0 + v2.0 transformers | LIVE |
| `lib/survey/ingest/payloadFetcher.ts` | Fetches full payload from partner API | LIVE (degraded if env vars missing) |
| `lib/survey/ingest/ownerResolver.ts` | Resolves `solarpro_user_id` → ownerId | LIVE |
| `lib/survey/ingest/projectLinkResolver.ts` | create/attach/triage decision | LIVE |
| `lib/survey/handoff/tokenMinter.ts` | JWT mint + verify | LIVE |
| `lib/siteSurvey/normalizeSurvey.ts` | Raw → Normalized | LIVE (used by engineering routes) |
| `lib/siteSurvey/enrichSurvey.ts` | Normalized → Enriched | LIVE (used by engineering routes) |
| `lib/siteSurvey/applyToSystemDefinition.ts` | Enriched → patched SystemDefinition | **Only 1 caller: engineering/generate** |
| `lib/siteSurvey/fromPhysicalData.ts` | DB row → RawSurveyPayload | LIVE (engineering-side bridge) |
| `lib/siteSurvey/buildCADFromSurvey.ts` | Enriched → CAD surfaces | **0 callers** |
| `lib/siteSurvey/permitIntegration.ts` | Enriched → permit sheets | **0 callers** |
| `lib/siteSurvey/electricalFromSurvey.ts` | Enriched → electrical params | **0 callers** |
| `lib/siteSurvey/engineeringIntegration.ts` | Enriched → engineering report | **0 callers** |
| `components/project/FieldSurveyPanel.tsx` | UI readout for project.survey tab | LIVE |

---

## 3. What's working

1. **Partner webhook path end-to-end.**
   Admin `/admin/topography` shows steps 1–9 GREEN: HMAC, idempotency, payload fetch, transform, projects + project_physical_data upsert all LIVE.

2. **`project_physical_data` population.**
   After the v47.438 transformer work, all 20 survey fields are mapped and written to the table. `_upsertPhysicalData` uses `ON CONFLICT (project_id) DO UPDATE` so replays and re-submissions are idempotent.

3. **Engineering report partial consumption.**
   `reportGenerator.ts` consumes 4 of the 20 fields:
   - `panel_rating_amps` → NEC 705.12B calculations
   - `rafter_spacing_in` → structural schedule
   - `roof_material` → load type
   - `interconnection_point` → SLD diagram

4. **Engineering generate uses override pipeline.**
   `app/api/engineering/generate/route.ts` lines 81–131 run the **full** Raw → Normalize → Enrich → applyToSystemDefinition chain when `physicalData` exists. This is the only route that actually uses `applyToSystemDefinition`.

5. **Field survey UI tab.**
   Project page has a "Field Survey" tab rendering `FieldSurveyPanel` → `GET /api/projects/{id}/physical-data`. It displays all 20 fields or "Not captured".

6. **Vision pipeline (G–J).**
   Fire-and-forget YOLOv8 inference on photos. Patches SystemDefinition with obstructions + electrical nodes. Logs with `[VISION PIPELINE]` / `[SYSDEF PATCH]` tags. Gracefully disabled if `VISION_SERVICE_URL` missing.

---

## 4. What's broken or dead

### 4.1 "Start Survey" button is a desktop dead-end
**File:** `app/api/projects/[id]/survey-handoff/route.ts` line 118
```ts
url = `sitesurvey://new-survey?token=${encodeURIComponent(result.token)}`;
```
The handoff always returns a `sitesurvey://` mobile URI scheme. Caller `app/projects/[id]/page.tsx` line 497 does `window.open(data.url, '_blank')`, which on desktop browsers simply fails silently (no app handler). **Desktop users cannot launch a survey.**

A working `/survey/[token]` web form exists at `app/survey/[token]/page.tsx` (6-step React form, localStorage autosave, submits to `/api/survey/submit`) but there is **no way to reach it from the UI** — the handoff endpoint never issues a web URL.

**Fix needed:** Either (a) return a web URL `https://<host>/survey/<token>` as the default and `sitesurvey://` only when requested, or (b) return both and let the UI pick based on platform.

### 4.2 `POST /api/site-survey/upload` is dead code
- **Zero callers** anywhere in `app/` (verified by grep).
- Writes to `project_site_surveys` table, which has **no migration** in `migrations/` or `lib/migrations/`.
- Any call would fail at step 6 (DB upsert) with "relation does not exist".
- Referenced only by `/admin/topography/page.tsx` for diagnostic metadata.

**Fix needed:** Either remove the endpoint or add migration `016_project_site_surveys.sql` and wire a caller (probably an admin replay tool).

### 4.3 Five override modules are built but not wired
From `/admin/topography/page.tsx` (self-documented):
| Module | Callers in `app/` |
|---|---|
| `applyToSystemDefinition` | **1** (engineering/generate) — was listed as 0 in admin doc but IS now wired |
| `buildCADFromSurvey` | 0 |
| `permitIntegration` | 0 |
| `electricalFromSurvey` | 0 |
| `engineeringIntegration` | 0 |

CAD, permit, and proposal generators still use hardcoded defaults instead of survey data.

### 4.4 Two parallel pipelines with different DB tables

| Pipeline | DB table | Status |
|---|---|---|
| Partner webhook → ingestPipeline | `project_physical_data` | LIVE |
| `/api/site-survey/upload` → upsertSiteSurvey | `project_site_surveys` | DEAD |

These **don't share storage**. An enriched-survey row saved by the dead upload path would never be visible to the engineering generate route (which reads `project_physical_data`).

### 4.5 Engineering read ratio: 4 / 20 fields
The majority of captured data is dropped on the floor at report generation time. Documented on admin page as **PARTIAL / degraded**.

Unconsumed fields: `roof_pitch`, `roof_condition`, `roof_age_years`, `attic_access`, `panel_brand`, `available_breaker_slots`, `meter_socket_type`, `service_entrance_type`, `has_sub_panel`, `sub_panel_rating_amps`, `obstructions`, `usable_roof_pct`, `inspector_name`, `surveyed_at`, `structure_type`, `stories`.

---

## 5. Integration gaps by consumer

### Engineering
- **Generate:** ✅ Full pipeline wired (fromPhysicalData → normalize → enrich → applyToSystemDefinition).
- **Permit:** ⚠ Partial — calls fromPhysicalData/normalize/enrich but does NOT call applyToSystemDefinition.
- **Preliminary:** ⚠ Partial — same as permit.
- **Report generator (reportGenerator.ts):** Reads raw `project_physical_data` fields directly, 4/20 consumed.

### CAD (Design Studio)
- **No survey data consumed.** `buildCADFromSurvey` exists but 0 callers. CAD surfaces + exclusion zones from the survey are not used.

### Permit
- **Partially consumed.** Permit route reads physical data but `permitIntegration` module has 0 callers.

### Proposal
- **No survey data consumed.** No imports of any `lib/siteSurvey/*` modules in the proposal pipeline.

### Project page UI
- ✅ **FieldSurveyPanel** displays all 20 fields read-only.
- ✅ Handoff button generates JWT.
- ❌ Button opens mobile-only URI scheme.

---

## 6. Critical environment variables

| Env var | Required for | Failure mode |
|---|---|---|
| `SURVEY_WEBHOOK_SECRET` | HMAC verify inbound webhook | 500 — webhook rejected, partner retries |
| `SURVEY_INGEST_DEFAULT_USER_ID` | Fallback owner if JWT claim missing | Ingest fails with MISSING_OWNER_ID |
| `PARTNER_BASE_URL` | Handoff URL + payload fetch | Handoff returns 500; payload fetch returns null (degraded) |
| `PARTNER_API_BEARER_TOKEN` | GET /api/surveys/{id} from partner | Payload fetch returns null (degraded — fields missing) |
| `HANDOFF_JWT_SECRET` | Mint + verify handoff JWT | 500 on handoff |
| `NEXT_PUBLIC_APP_URL` | Build internal webhook URL for /api/survey/submit | Falls back to localhost:3000 |
| `VISION_SERVICE_URL` | YOLOv8 photo inference | Vision pipeline silently skipped |
| `VISION_API_KEY` | Vision service auth | Vision pipeline fails per-photo |

---

## 7. Recommended remediation (priority order)

### P0 — Unblock desktop users
1. **Fix `/api/projects/[id]/survey-handoff` to return a web URL by default** when the requester is a desktop browser, and keep `sitesurvey://` as an opt-in for the mobile app.
   ```ts
   const webUrl = `${process.env.NEXT_PUBLIC_APP_URL}/survey/${encodeURIComponent(result.token)}`;
   return NextResponse.json({ url: webUrl, deepLink: `sitesurvey://new-survey?token=${token}` });
   ```
   Caller chooses based on device capability.

### P1 — Close the data consumption gap
2. **Wire remaining `lib/siteSurvey/*` modules into permit + CAD + proposal** so all 20 survey fields are consumed. `applyToSystemDefinition` is already registered in engineering/generate — repeat that pattern elsewhere.
3. **Expand `reportGenerator.ts` to consume the remaining 16 physical-data fields** (roof_condition, usable_roof_pct, etc.) — documented on admin page as the partial/degraded step.

### P2 — Dead code cleanup
4. **Decide the fate of `/api/site-survey/upload` + `project_site_surveys`:**
   - **Option A:** Remove both the endpoint and all `lib/siteSurvey/types.ts` references to `project_site_surveys`.
   - **Option B:** Add migration `016_project_site_surveys.sql` and make the endpoint a legitimate admin replay/backfill tool.
5. **Harmonize the two pipelines** so there's one canonical storage target (`project_physical_data`) for all survey data, or one canonical "full enriched" target (`project_site_surveys` with migration).

### P3 — Observability
6. **Add a `/admin/surveys` page** exposing `webhook_deliveries` + `project_physical_data` + vision patch logs so ops can debug without shell access.
7. **Emit metrics** (delivery count, ingested vs failed, transform-summary stats, vision pipeline hit rate).

---

## 8. Signals of health to monitor

- `webhook_deliveries.status` distribution — expect mostly `'ingested'`, small `'failed'`, zero long-lived `'verified'`.
- `projects.origin = 'survey'` count over time — quantifies partner integration.
- `project_physical_data.source = 'survey'` ratio — vs. manual-entry projects.
- `[VISION PIPELINE]` log volume vs photo-upload count — catches silent YOLOv8 outages.
- `[SURVEY APPLIED]` log line in engineering/generate — confirms `applyToSystemDefinition` actually fires.

---

## 9. Deliverables (audit artefacts)

- This document: `SURVEY_PIPELINE_AUDIT.md` (repo root)
- Existing ops dashboard: `/admin/topography` (self-documents steps 1-11 with LIVE/PARTIAL/NOT-WIRED badges)
- Working partner integration logs in Vercel under `/api/webhooks/survey-complete` handler

---

**End of audit.**