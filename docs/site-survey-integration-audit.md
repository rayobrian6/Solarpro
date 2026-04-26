# Site Survey Integration Audit
**SolarPro — Read-Only Architecture Audit**
**Date:** June 2025 | **Auditor:** AI Code Review
**Scope:** Topography map · Partner survey app/build · Integration path · Evidence · Verdict · Implementation plan

---

## Executive Summary

The partner site survey is **partially integrated (Verdict B)** into SolarPro. A complete, working data collection path exists from field device → API → DB (`project_physical_data`), and that table is **actively consumed** by the engineering report generator to improve electrical and structural calculations. However, significant gaps remain: the topography map is a hardcoded static iframe with zero data integration; the new `lib/siteSurvey/` pipeline (Phases 1–10) is built but not wired to any downstream system; and no CAD, proposal, or permit engine reads survey data at all.

---

## 1. Topography Map Implementation

**File:** `app/admin/topography/page.tsx`
**Component:** `AdminTopography` (default export)
**Integration type:** Static external embed — NO data integration

The topography map is a single `<iframe>` pointing to a hardcoded external URL:

```
const TOPO_URL = 'https://sites.super.myninja.ai/399ee147-1c47-4168-953c-039b63bf656e/a29238b9/index.html';
```

The component has exactly three pieces of state: `loading`, `error`, and `refreshKey` (used to reload the iframe). There are no API calls, no props passed into the iframe, no `postMessage` communication, no project ID, no survey data, and no GPS coordinates. The "Live" badge in the UI refers to the iframe load state, not live data. The refresh button simply remounts the iframe with a new key.

The word "topography" in this context refers to a third-party map visualization tool embedded as a static page. It is completely isolated from the SolarPro data model.

**Evidence:** `app/admin/topography/page.tsx` — hardcoded `TOPO_URL`, no imports from any lib, no fetch calls, no props.

---

## 2. Partner Site Survey App/Build

Two parallel survey systems exist in the repository. They are independent and do not cross-reference each other.

### System A — `lib/survey/` (Production, LIVE)

This is the operational system. It implements a complete partner-facing webhook pipeline.

**Data flow:**
1. `POST /api/projects/[id]/survey-handoff` → mints a HS256 JWT, returns `/survey/<token>` URL
2. Field technician opens `/survey/[token]` (Next.js page: `app/survey/[token]/page.tsx`)
3. Field tech fills 6 steps: SiteOverview, RoofConditions, ElectricalService, Obstructions, Photos, Review
4. `POST /api/survey/submit` → JWT-verified, validates `SurveyV2Payload`, calls `POST /api/webhooks/survey-complete` internally with HMAC signature
5. `POST /api/webhooks/survey-complete` → HMAC-verified, idempotency check, inserts `webhook_deliveries` row, calls `runIngestPipeline()`
6. `runIngestPipeline()` → fetches full payload via `PARTNER_BASE_URL/api/surveys/{id}`, transforms via `transformLayer.ts`, writes to `project_physical_data` table

**Note from webhook route (v47.435):** "payload fetch (Step C) is a stub: `rawPayload=null` (blocked on Q2)" — meaning the `PARTNER_BASE_URL` fetch in `payloadFetcher.ts` is implemented but was blocked on an external dependency at time of writing. The internal submission path (`/api/survey/submit` → `/api/webhooks/survey-complete`) does work end-to-end for the in-house survey tool.

**Key files:**
- `lib/survey/types.ts` — webhook contract v1.0 (FROZEN)
- `lib/survey/v2/types.ts` — `SurveyV2Payload` (5 steps)
- `lib/survey/ingest/ingestPipeline.ts` — 6-step orchestrator
- `lib/survey/ingest/transformLayer.ts` — `extractPhysicalData()` mapper
- `lib/survey/ingest/payloadFetcher.ts` — `GET ${PARTNER_BASE_URL}/api/surveys/${surveyId}`
- `app/survey/[token]/page.tsx` — full 6-step survey UI (client component)
- `app/api/survey/submit/route.ts` — JWT-verified submission endpoint
- `app/api/webhooks/survey-complete/route.ts` — HMAC-verified receiver
- `app/api/projects/[id]/survey-handoff/route.ts` — token minter
- `components/project/FieldSurveyPanel.tsx` — reads `project_physical_data` via `GET /api/projects/[id]/physical-data`, displays all survey fields, shows "Start Survey" CTA if no data

### System B — `lib/siteSurvey/` (Built, NOT wired downstream)

This is the new Phase 1–10 pipeline built in this session. It is a self-contained in-memory pipeline.

**Key files:**
- `lib/siteSurvey/types.ts` — `RawSurveyPayload`, `NormalizedSiteSurvey`, `EnrichedSiteSurvey`
- `lib/siteSurvey/normalizeSurvey.ts` — pure normalizer
- `lib/siteSurvey/enrichSurvey.ts` — geometry, feasibility, NEC 120% rule
- `lib/siteSurvey/applyToSystemDefinition.ts` — override layer for SystemDefinition
- `lib/siteSurvey/engineeringIntegration.ts` — StructuralInputPatch + ElectricalFeasibilityContext
- `lib/siteSurvey/permitIntegration.ts` — PermitInputPatch
- `lib/cad/buildCADFromSurvey.ts` — SurveyCADInputs for CAD engine
- `lib/system/electricalFromSurvey.ts` — InterconnectionInput + SLD data
- `app/api/site-survey/upload/route.ts` — writes to `project_site_surveys` table; reads back on GET

**Wiring status:** `normalizeSurvey()` and `enrichSurvey()` are called inside `app/api/site-survey/upload/route.ts`. The enriched result is stored in `project_site_surveys`. However, **none of the downstream engines** (`lib/engineering/`, `lib/cad/`, `lib/permit/`, proposal routes) import from `lib/siteSurvey/`. The `applyToSystemDefinition`, `buildCADFromSurvey`, `engineeringIntegration`, `electricalFromSurvey`, and `permitIntegration` functions exist and are tested but are not called by any production route.

---

## 3. Integration Path Mapping

The intended architecture vs. what exists:

```
[Field Device]
     │
     ▼
POST /api/survey/submit (JWT auth)                    ← LIVE
     │
     ▼
POST /api/webhooks/survey-complete (HMAC verify)      ← LIVE
     │
     ▼
runIngestPipeline()                                   ← LIVE (payload fetch stub in v47.435)
     │
     ▼
extractPhysicalData() → project_physical_data (DB)    ← LIVE (writes)
     │
     ├──► generateEngineeringReport() ← LIVE (reads pd.panel_rating_amps, pd.rafter_spacing_in,
     │         [engineering/report,      pd.roof_material, pd.interconnection_point)
     │          engineering/generate,
     │          engineering/preliminary,
     │          engineering/syncPipeline]
     │
     ├──► FieldSurveyPanel (UI) ← LIVE (reads + displays all project_physical_data fields)
     │
     ├──► CAD engine              ← NOT WIRED (buildCADFromSurvey built, not called)
     │
     ├──► Proposal engine         ← NOT WIRED (no physical_data reads in proposal routes)
     │
     ├──► Permit plan set         ← NOT WIRED (permitIntegration built, not called)
     │
     └──► SystemDefinition override ← NOT WIRED (applyToSystemDefinition built, not called)
```

The topography map is not on this path at all. It is a separate admin visualization.

---

## 4. Side-by-Side Comparison Table

| Capability | Intended Architecture | Repo Reality | Evidence | Gap |
|---|---|---|---|---|
| Field survey UI | Multi-step mobile form | **LIVE** — 6-step `SurveyV2Draft` form at `/survey/[token]` | `app/survey/[token]/page.tsx` — direct integration | None |
| Handoff JWT minting | Project page → token → survey URL | **LIVE** — `POST /api/projects/[id]/survey-handoff` | `app/api/projects/[id]/survey-handoff/route.ts` — direct integration | None |
| Survey submission | POST + JWT verify | **LIVE** — `POST /api/survey/submit` validates `SurveyV2Payload`, relays to webhook | `app/api/survey/submit/route.ts` — direct integration | None |
| Webhook receiver | HMAC-signed POST from partner | **LIVE** — `POST /api/webhooks/survey-complete` with `verifyWebhookSignature` | `app/api/webhooks/survey-complete/route.ts` — direct integration | None |
| Payload fetch from partner API | GET `PARTNER_BASE_URL/api/surveys/{id}` | **STUB** — `payloadFetcher.ts` implemented, but `rawPayload=null` per v47.435 comment | `app/api/webhooks/survey-complete/route.ts` line comment: "payload fetch is a stub blocked on Q2" | `PARTNER_BASE_URL` + `PARTNER_API_BEARER_TOKEN` env vars must be set; partner API endpoint must be live |
| DB write — physical data | survey fields → `project_physical_data` | **LIVE** — `_upsertPhysicalData()` in `ingestPipeline.ts`, ON CONFLICT DO UPDATE | `lib/survey/ingest/ingestPipeline.ts` — direct integration | None (once payload fetch stub resolved) |
| Physical data → engineering report | `pd.panel_rating_amps`, `pd.rafter_spacing_in`, `pd.roof_material`, `pd.interconnection_point` | **LIVE** — `generateEngineeringReport(snapshot, id, physicalData)` uses pd fields with fallbacks | `lib/engineering/reportGenerator.ts` lines 228–303 — partial integration (4 fields used) | Only 4 of ~20 `project_physical_data` fields are consumed; rest ignored |
| Physical data display (UI) | Read-only panel in project view | **LIVE** — `FieldSurveyPanel` fetches and displays all fields from `project_physical_data` | `components/project/FieldSurveyPanel.tsx` — direct integration | None |
| Physical data → CAD engine | Survey geometry → CAD roof planes | **MISSING** — `buildCADFromSurvey` built but never called by CAD routes | `grep -r "buildCADFromSurvey" app/` returns zero hits | Full gap — `buildCADFromSurvey` must be called from CAD engine entry point |
| Physical data → Proposal | Survey data informs proposal accuracy | **MISSING** — no `project_physical_data` reads in any proposal route | `grep -r "physicalData" app/api/proposals/` returns zero hits | Full gap |
| Physical data → Permit plan set | Survey data populates permit package | **MISSING** — `permitIntegration.ts` built but never called by permit routes | `grep -r "permitIntegration" app/` returns zero hits | Full gap |
| SystemDefinition override | Survey as override layer | **MISSING** — `applyToSystemDefinition` built but never called | `grep -r "applyToSystemDefinition" app/` returns zero hits | Full gap — must wire into system definition build path |
| Topography map — project data | Map shows project-specific survey data | **MISSING** — hardcoded static iframe, no data | `app/admin/topography/page.tsx` — `TOPO_URL` constant, no API calls | Full gap — iframe has no communication channel with SolarPro |
| Topography map — live GPS | GPS coordinates from survey shown on map | **MISSING** | Same file — no `postMessage`, no URL params with lat/lng | Full gap |
| NEC 120% rule in engineering | Survey panel data → NEC compliance calc | **PARTIAL** — `mainPanelBusAmps = pd?.panel_rating_amps ?? 200` | `lib/engineering/reportGenerator.ts` line 230 — partial integration | `busbar_amps` field not used; only `panel_rating_amps` fallback |
| Rafter spacing in structural | Survey rafter data → ASCE 7-22 calc | **LIVE** — `rafterSpacingIn = pd?.rafter_spacing_in ?? 24` | `lib/engineering/reportGenerator.ts` line 312 — direct integration | None |
| Interconnection point in electrical | Survey interconnection → SLD/NEC | **LIVE** — `_surveyInterconnection = pd?.interconnection_point` | `lib/engineering/reportGenerator.ts` lines 239–244 — direct integration | None |
| Roof material in structural | Survey roof type → structural report | **LIVE** — `roofType: pd?.roof_material ?? 'Asphalt Shingle'` | `lib/engineering/reportGenerator.ts` line 336 — direct integration | None |
| `lib/siteSurvey/` pipeline → downstream | New Phase 1–10 pipeline feeds engines | **MISSING** — pipeline writes to `project_site_surveys`, not consumed downstream | `grep -r "from.*siteSurvey" app/` returns only upload route | Full gap — the entire Phase 1–10 output sits in DB unused |
| `project_site_surveys` → `project_physical_data` bridge | New pipeline enrichment feeds old system | **MISSING** — two separate tables, no bridge | Schema: two independent tables | Architectural gap — either bridge or consolidate |

---

## 5. Evidence Requirements (Per Claim)

### Claims that ARE integrated

| Claim | File | Function/Route | Evidence Type |
|---|---|---|---|
| Survey UI exists | `app/survey/[token]/page.tsx` | `SurveyPage` (default export) | Direct integration — full 6-step form renders and submits |
| Handoff token minted | `app/api/projects/[id]/survey-handoff/route.ts` | `POST` handler | Direct integration — mints JWT, returns survey URL |
| Survey submits to webhook | `app/api/survey/submit/route.ts` | `POST` handler | Direct integration — validates payload, relays to `POST /api/webhooks/survey-complete` |
| Webhook receiver exists | `app/api/webhooks/survey-complete/route.ts` | `POST` handler | Direct integration — HMAC verify, idempotency, `runIngestPipeline()` |
| Physical data written to DB | `lib/survey/ingest/ingestPipeline.ts` | `_upsertPhysicalData()` | Direct integration — `INSERT INTO project_physical_data … ON CONFLICT DO UPDATE` |
| Physical data read by engineering | `lib/engineering/reportGenerator.ts` | `generateElectricalEngineering()`, `generateStructuralEngineering()` | Partial integration — 4 fields: `panel_rating_amps`, `rafter_spacing_in`, `roof_material`, `interconnection_point` |
| Physical data displayed in UI | `components/project/FieldSurveyPanel.tsx` | `FieldSurveyPanel` (default export) | Direct integration — fetches `GET /api/projects/[id]/physical-data`, renders all fields |
| Engineering sync uses survey data | `lib/engineering/syncPipeline.ts` | `runEngineeringSyncPipeline()` | Direct integration — calls `getProjectPhysicalData()` before every `generateEngineeringReport()` |

### Claims that ARE NOT integrated

| Claim | Expected Location | What Exists | Evidence Type |
|---|---|---|---|
| `buildCADFromSurvey` called in production | Any CAD route or engine entry point | `lib/cad/buildCADFromSurvey.ts` exists but no production caller | Missing — `grep -r "buildCADFromSurvey" app/` = 0 hits |
| `applyToSystemDefinition` called | Any system definition builder | `lib/siteSurvey/applyToSystemDefinition.ts` exists but no caller | Missing — `grep -r "applyToSystemDefinition" app/` = 0 hits |
| `permitIntegration` called | Any permit plan set generator | `lib/siteSurvey/permitIntegration.ts` exists but no caller | Missing — `grep -r "permitIntegration" app/` = 0 hits |
| `electricalFromSurvey` called | Any electrical calc or SLD builder | `lib/system/electricalFromSurvey.ts` exists but no caller | Missing — `grep -r "electricalFromSurvey" app/` = 0 hits |
| Topography map shows project data | `app/admin/topography/page.tsx` | Hardcoded `TOPO_URL` constant, no data channel | Static embed — confirmed by reading full file |
| `project_site_surveys` consumed downstream | Any engine route | Only written by `app/api/site-survey/upload/route.ts`, read back by same route's GET handler | Missing — `grep -rn "project_site_surveys" app/` = only upload route |
| Proposal engine reads survey data | `app/api/proposals/` | No `physicalData` or `physical_data` imports | Missing — `grep -r "physicalData" app/api/proposals/` = 0 hits |

---

## 6. Final Verdict

**Verdict: B — Partially Integrated**

The partner site survey is partially integrated into SolarPro. The integration that exists is real, production-grade, and covers the most critical path: data collection → DB storage → engineering report improvement. Specifically:

**What works end-to-end today:**
- Full survey form at `/survey/[token]` (6 steps, localStorage draft, JWT auth)
- Handoff token flow from project page to field device
- Webhook pipeline with HMAC verification, idempotency, ingest pipeline
- `project_physical_data` DB table populated by `extractPhysicalData()`
- Engineering report generator reads 4 survey fields with proper fallbacks
- Engineering sync pipeline (`syncPipeline.ts`) fetches physical data on every rebuild
- `FieldSurveyPanel` displays all captured survey fields in project UI

**What does not work (gaps):**
- Topography map is a static iframe with zero data integration — it does not show project survey data, GPS coordinates, or any SolarPro data
- The new `lib/siteSurvey/` pipeline (Phases 1–10) is fully built and tested but not wired to any downstream engine (CAD, permit, proposal, SystemDefinition override)
- CAD engine does not consume survey geometry (`buildCADFromSurvey` uncalled)
- Permit plan set does not consume survey data (`permitIntegration` uncalled)
- Proposal engine has zero survey data reads
- `SystemDefinition` is not enriched with survey data (`applyToSystemDefinition` uncalled)
- The payload fetch from the external partner API is stubbed at `rawPayload=null` (blocked on env vars `PARTNER_BASE_URL` + `PARTNER_API_BEARER_TOKEN`)
- Only 4 of ~20 `project_physical_data` fields are consumed by engineering; 16+ fields (roof condition, roof age, attic access, meter socket, service entrance, sub-panel, usable roof %, etc.) are stored but ignored by all engines
- No bridge exists between the new `project_site_surveys` table and the existing `project_physical_data` table

---

## 7. Next-Step Implementation Plan

These steps are surgical — they wire existing, tested code to existing, tested callers. No new modules needed. No breaking changes.

### Priority 1: Unblock the payload fetch stub (1 day)

The most impactful single action. Once `PARTNER_BASE_URL` and `PARTNER_API_BEARER_TOKEN` are configured in the environment and the partner endpoint is live, the ingest pipeline completes its full path.

**Action:** Set env vars in Vercel/`.env.local`:
```
PARTNER_BASE_URL=https://<partner-domain>
PARTNER_API_BEARER_TOKEN=<secret>
```

**Verify:** `lib/survey/ingest/payloadFetcher.ts` — `fetchFullPayload()` already implements the GET call. No code change needed.

**Risk:** Zero — non-breaking, additive.

---

### Priority 2: Wire `applyToSystemDefinition` into the preliminary/generate routes (2–3 hours)

**File to edit:** `app/api/engineering/preliminary/route.ts` and/or `app/api/engineering/generate/route.ts`

**Pattern:** Both routes already call `getProjectPhysicalData(projectId)`. Add a parallel call to fetch the `project_site_surveys` row, then call `applyToSystemDefinition(existingSystemDef, enriched)` to produce an enriched `SystemDefinition` before passing it to the engineering engine.

**Surgical edit (preliminary/route.ts, approximately line 687):**
```typescript
// NEW: fetch site survey enrichment if available
import { applyToSystemDefinition } from '@/lib/siteSurvey/applyToSystemDefinition';

// After existing physicalData fetch:
const siteSurveyRow = await sql`
  SELECT enriched FROM project_site_surveys
   WHERE project_id = ${projectId}
   ORDER BY updated_at DESC LIMIT 1
`.catch(() => []);

if (siteSurveyRow.length > 0 && siteSurveyRow[0].enriched) {
  const { definition: enrichedDef } = applyToSystemDefinition(
    currentSystemDef,
    siteSurveyRow[0].enriched,
  );
  currentSystemDef = enrichedDef; // non-mutating, safe
}
```

**Risk:** Low — `applyToSystemDefinition` never throws, returns new object, has 139 passing tests. Fallback is implicit (existing behavior if no survey row).

---

### Priority 3: Wire `buildCADFromSurvey` into the CAD engine entry point (2–3 hours)

**Find the CAD engine entry point:**
```bash
grep -rn "cadEngine\|buildCAD\|generateCAD" app/ --include="*.ts" | grep -v test | head -20
```

**Pattern:** Find the route that constructs `CADModel`. Before calling the CAD engine, call `buildCADFromSurvey(enriched)` to get `SurveyCADInputs`, then merge `overrides` and `roofPlaneInputs` into the CAD build context.

**Risk:** Low — `buildCADFromSurvey` is pure and tested. Only additive — enriches the CAD input, does not replace it.

---

### Priority 4: Wire `permitIntegration` into the permit plan set generator (2–3 hours)

**File to find:**
```bash
grep -rn "PermitInput\|permitPackage\|permit.*plan" app/api/ --include="*.ts" | grep -v test | head -20
```

**Pattern:** Find where `PermitInput` is constructed. Fetch `project_site_surveys` row, call `permitIntegration(enriched)` to get `PermitInputPatch`, then merge the patch into the `PermitInput` object before calling the permit generator.

**Risk:** Low — merge is additive, existing values are only overridden for fields explicitly captured in the survey (per override allowlist logic in `permitIntegration`).

---

### Priority 5: Expand engineering report to use all physical_data fields (1–2 hours)

Currently only 4 fields from `project_physical_data` are read by `lib/engineering/reportGenerator.ts`. The following fields are stored but unused:

- `roof_condition` → warn if 'poor' in structural compliance notes
- `roof_age_years` → flag if > 20 years
- `available_breaker_slots` → factor into load-side interconnection feasibility
- `service_entrance_type` → SLD accuracy
- `meter_socket_type` → permit sheet PV-2
- `has_sub_panel` + `sub_panel_rating_amps` → NEC 705.12 supply-side determination
- `usable_roof_pct` → refine system size cap
- `inspector_name` + `surveyed_at` → include in engineering report metadata

**File to edit:** `lib/engineering/reportGenerator.ts` — `generateElectricalEngineering()` and `generateStructuralEngineering()`.

**Risk:** Low — all changes are additive overrides with fallbacks.

---

### Priority 6: Bridge `project_site_surveys` → `project_physical_data` (3–4 hours)

The new Phase 1–10 pipeline writes `EnrichedSiteSurvey` to `project_site_surveys`. The existing production pipeline writes `ProjectPhysicalData` to `project_physical_data`. These are parallel tables with overlapping data.

**Option A (recommended):** In `app/api/site-survey/upload/route.ts`, after the upsert to `project_site_surveys`, extract physical fields from the enriched survey and also upsert to `project_physical_data` in the same request. This makes the new pipeline feed the existing engineering system immediately.

**Option B:** Add a DB trigger or post-ingest hook that maps `project_site_surveys.enriched` → `project_physical_data` fields. More complex, harder to debug.

**Risk:** Low for Option A — the mapping function `extractPhysicalData()` already exists in `lib/survey/ingest/transformLayer.ts`. Adapt it for `EnrichedSiteSurvey` as input.

---

### Priority 7: Topography map — connect project GPS data (1–2 hours)

The topography map at `app/admin/topography/page.tsx` is a static external page. To show project-relevant data, the iframe URL would need to accept query parameters (lat/lng, project ID) or the external tool would need to support `postMessage`.

**Assessment:** This depends entirely on what `https://sites.super.myninja.ai/...` supports. If the external tool accepts URL parameters, the fix is:

```typescript
// In app/admin/topography/page.tsx
// Props: projectId, lat, lng (passed from parent)
const TOPO_BASE = 'https://sites.super.myninja.ai/399ee147.../index.html';
const TOPO_URL = `${TOPO_BASE}?lat=${lat}&lng=${lng}&project=${projectId}`;
```

If the external tool does not support URL parameters, replacement with a native map component (e.g., Mapbox, Google Maps) is required — a significantly larger effort.

**Risk:** Unknown until external tool capability is verified. No code change in SolarPro is breaking regardless.

---

### Summary Table

| Priority | Action | Effort | Risk | Impact |
|---|---|---|---|---|
| 1 | Set `PARTNER_BASE_URL` + `PARTNER_API_BEARER_TOKEN` env vars | 30 min | Zero | Unblocks full partner ingest path |
| 2 | Wire `applyToSystemDefinition` into preliminary/generate routes | 2–3 hrs | Low | Survey data improves SystemDefinition accuracy |
| 3 | Wire `buildCADFromSurvey` into CAD entry point | 2–3 hrs | Low | Survey geometry feeds CAD layout engine |
| 4 | Wire `permitIntegration` into permit plan set | 2–3 hrs | Low | Survey data populates permit package sheets |
| 5 | Use remaining 16+ physical_data fields in engineering report | 1–2 hrs | Low | Better electrical + structural accuracy |
| 6 | Bridge `project_site_surveys` → `project_physical_data` | 3–4 hrs | Low | New pipeline feeds existing engineering system |
| 7 | Topography map — connect GPS/project data | 1–2 hrs + external tool assessment | Unknown | Map shows project-relevant data |

**Estimated total effort to reach full integration:** 12–18 hours of focused engineering work, assuming Priority 1 env vars are available and Priority 7 external tool supports URL parameters.