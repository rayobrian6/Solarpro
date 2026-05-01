# Site Survey → SolarPro Ingestion Integration — Design Proposal

**Status:** Draft for review. No code changes until user approves.
**Scope (v1 per user directive):**
- Pull-only (Survey → SolarPro); Survey is source of truth for field data
- Creates/updates projects, populates engineering config, attaches photos + notes
- NO bidirectional sync, NO BOM writes, NO permit writes
- Target is a **custom in-house survey tool**

---

## 1. Glossary — SolarPro entities relevant to this integration

Grounded in the actual code (`types/index.ts`, `app/api/projects/route.ts`, `app/api/project-files/route.ts`, `lib/db-neon.ts`):

| SolarPro entity | Table / file shape | Role in this integration |
|---|---|---|
| `Project` (`types/index.ts:614`) | `projects` row | The top-level record each survey creates or updates. |
| `Client` (existing) | `clients` row | Survey ties to an existing SolarPro client (by email or `externalId`) or creates one. |
| `EngineeringSeed` (`types/index.ts:550`) | `projects.engineering_seed` JSONB | Structured bill+defaults seed read by engineering page to hydrate the engine. **This is where most survey findings land.** |
| `Layout` (`types/index.ts:422`) | `layouts` row + `RoofPlane[]`, `PlacedObstruction[]` | Geometric + topological survey output (roof planes, obstructions, measurements). |
| `project_files` | `project_files` row | Photos + notes attachments, with `file_type` enum already including `'site_photo'`. |
| `SolarArray[]` (`types/index.ts:17`) | `Layout.arrays` (per-array section) | Survey may identify multiple mount zones (e.g. "south roof" + "ground mount"). |

## 2. Guiding design principles

1. **Survey data is authoritative for fields it owns; SolarPro downstream derives everything else.**
   If the survey says "south roof plane, 22° pitch, 180° azimuth, 3 vents", SolarPro never recomputes those. But panel count, inverter selection, BOM, compliance, etc. are all re-derived by the SolarPro engineering engine from the seed + layout.

2. **Idempotency is mandatory.**
   A survey can be re-uploaded (re-measurement, correction, second visit). Re-submitting the same survey payload must produce the same SolarPro state — not duplicate projects, duplicate photos, or duplicate roof planes. Achieved via survey-assigned stable IDs (`surveyExternalId`) that SolarPro stores and matches against on re-ingest.

3. **Narrow surface, explicit contract.**
   One inbound endpoint (`/api/survey/ingest`). One payload schema (`SurveyIngestPayload`). One service-account auth credential. No web-UI-style cookie flow, no client-scoped auth.

4. **Additive — zero breakage to existing flows.**
   Projects created from survey share the same schema as projects created from bill upload or the manual New Project form. The engineering page, BOM engine, compliance engine, and UI render unchanged regardless of origin. Survey-origin rows carry a provenance tag for traceability.

5. **Validate-then-write, in one transaction.**
   Whole payload is validated via Zod (or equivalent) before any DB write. Partial ingests are a liability and are forbidden in v1.

## 3. Data model mapping (Survey payload → SolarPro entities)

### 3.1 Authoritative shape of the inbound payload

```ts
// docs/survey/SurveyIngestPayload.ts (v1)
export interface SurveyIngestPayload {
  // ── Idempotency + provenance ─────────────────────────────────────────
  surveyExternalId: string;          // stable survey-tool UUID, required
  surveyedAt: string;                // ISO timestamp the survey was completed
  surveyorId?: string;               // free-form; for audit only
  surveyToolVersion: string;         // e.g. "survey-app@1.4.2"
  schemaVersion: '1.0';              // frozen for this contract

  // ── Client linkage (survey must say which SolarPro client this belongs to) ─
  client: {
    // Either a resolved SolarPro client UUID, OR identifying fields for
    // lookup-or-create. At least one of `solarproClientId` or `email` required.
    solarproClientId?: string;
    email?: string;
    name?: string;
    phone?: string;
    externalId?: string;             // survey-side customer id (for audit)
  };

  // ── Project essentials (map 1:1 to projects columns) ─────────────────
  project: {
    name: string;                    // e.g. "123 Main St — Field Survey"
    systemType: 'roof' | 'ground' | 'fence';
    address: string;
    lat?: number;                    // survey-captured GPS
    lng?: number;
    stateCode?: string;
    city?: string;
    county?: string;
    zip?: string;
    utilityName?: string;
    notes?: string;                  // project-level notes from the surveyor
  };

  // ── Engineering inputs (lands in engineering_seed JSONB) ─────────────
  engineering: {
    // Usage / bill info IF the surveyor captured it in the field:
    utility?: {
      name?: string;
      ratePerKwh?: number;
      annualKwh?: number;
      monthlyKwh?: number;
    };
    // Service-panel + electrical (directly populates synthetic_eng_config):
    electrical?: {
      mainPanelAmps?: number;
      panelBusRating?: number;
      interconnectionMethod?: 'load_side' | 'supply_side' | 'subpanel' | 'meter_main';
      wireLengthFt?: number;
      conduitType?: 'emt' | 'pvc' | 'flex' | 'mc';
      hasExistingRapidShutdown?: boolean;
      hasExistingAcDisconnect?: boolean;
      hasExistingDcDisconnect?: boolean;
    };
    // v1 stance: survey does NOT select brand/inverter/panel. That stays in the
    // engineering app. Survey just reports field facts.
  };

  // ── Layout geometry (maps to Layout + RoofPlane + PlacedObstruction) ─
  layout: {
    // Primary mapCenter for the design studio to load on:
    mapCenter?: { lat: number; lng: number };

    // Roof planes — one entry per surveyed roof face:
    roofPlanes?: Array<{
      surveyPlaneId: string;         // stable per-plane id from survey tool
      label?: string;                // e.g. "South Slope"
      pitchDeg: number;
      azimuthDeg: number;
      vertices: Array<{ lat: number; lng: number }>;  // polygon, lat/lng order
      usableAreaSqFt?: number;       // optional override; else computed
      notes?: string;
    }>;

    // Obstructions (vents, skylights, chimneys, HVAC):
    obstructions?: Array<{
      surveyObstructionId: string;
      type: 'vent' | 'skylight' | 'chimney' | 'hvac' | 'other';
      lat: number;
      lng: number;
      heightFt?: number;             // above roof
      radiusFt?: number;             // exclusion radius
      label?: string;
    }>;

    // Ground/fence captures (only relevant when project.systemType = ground|fence):
    groundMount?: {
      tiltDeg?: number;
      azimuthDeg?: number;
      rowSpacingFt?: number;
      heightFt?: number;
      areaSqFt?: number;
    };
    fence?: {
      azimuthDeg?: number;
      lengthFt?: number;
      fenceLine?: Array<{ lat: number; lng: number }>;
    };
  };

  // ── Photos & notes (map to project_files table) ──────────────────────
  photos?: Array<{
    surveyPhotoId: string;           // stable id (idempotency key per photo)
    fileUrl: string;                 // publicly-fetchable URL the ingest can GET
    fileName: string;                // original filename (for display)
    mimeType: string;                // image/jpeg, image/png, image/heic
    takenAt?: string;                // ISO timestamp
    caption?: string;                // surveyor note
    tag?: 'service_panel'
        | 'main_breaker'
        | 'utility_meter'
        | 'roof_overview'
        | 'roof_plane'
        | 'obstruction'
        | 'attic_access'
        | 'general';
    relatedSurveyPlaneId?: string;   // ties photo to a specific roof plane
    relatedSurveyObstructionId?: string;
  }>;

  // Free-form notes (top-level, not tied to specific photos):
  notes?: Array<{
    surveyNoteId: string;
    text: string;
    tag?: string;
    createdAt?: string;
  }>;
}
```

### 3.2 Mapping table — payload → SolarPro write

| Survey field | SolarPro target | Write op |
|---|---|---|
| `surveyExternalId` | `projects.survey_external_id` (NEW column) | Idempotency key — upsert key. |
| `client.solarproClientId` OR lookup by `client.email` | `clients` row | Lookup; if miss AND `email+name` provided, create. |
| `project.*` | `projects.*` columns (existing) | Insert or update. |
| `engineering.utility.*` | `engineering_seed.annual_kwh / monthly_kwh / electricity_rate / utility` | Merge into existing seed (survey overwrites if provided). |
| `engineering.electrical.*` | `engineering_seed.synthetic_eng_config.*` | Merge. |
| `layout.mapCenter` | `layouts.map_center` | Upsert. |
| `layout.roofPlanes[]` | `RoofPlane[]` in `Layout.roofPlanes` | Replace (survey-id-keyed; no partial merge). |
| `layout.obstructions[]` | `Layout.placedObstructions` (new JSON field) | Replace. |
| `layout.groundMount` | `Layout.groundTilt / groundAzimuth / rowSpacing / groundHeight` | Update. |
| `layout.fence` | `Layout.fenceAzimuth / fenceLength / fenceLine` | Update. |
| `photos[]` | `project_files` rows, `file_type='site_photo'`, `notes=caption`, `external_id=surveyPhotoId` (NEW column) | Per-photo: skip if `external_id` exists; else fetch + store. |
| `notes[]` | `project_files` rows, `file_type='note'` with tiny JSON body, OR a new `project_notes` table | **Open decision** — see §6. |

### 3.3 Provenance tag (survey-origin detection)

New column `projects.origin` with values `'manual' | 'bill_upload' | 'survey' | 'api'`. Default `'manual'` for back-compat. Survey-ingested rows set `'survey'`. UI surfaces a small "Survey" chip on project cards. Drift-guard test asserts origin enum is closed.

## 4. API structure proposal

### 4.1 Endpoint

- **Path:** `POST /api/survey/ingest`
- **Runtime:** `nodejs`, `dynamic = 'force-dynamic'`
- **Max duration:** 60s (photo fetch can be slow)
- **Request:** `SurveyIngestPayload` (JSON body)
- **Response:**
  ```ts
  {
    success: true,
    data: {
      projectId: string;
      clientId: string;
      layoutId: string;
      photoCount: number;
      created: boolean;               // true if this was a new project, false on update
      warnings: Array<{ code: string; message: string; surveyField?: string }>;
    }
  }
  // OR
  { success: false, error: string, details?: ZodIssue[] }
  ```

### 4.2 Auth

**Service-account model** (NEW pattern in the codebase — no existing service auth today):

- New env var `SURVEY_INGEST_API_KEY` (rotatable, managed in deployment secrets).
- Request must carry `Authorization: Bearer <key>` header.
- Second env var `SURVEY_INGEST_DEFAULT_USER_ID` = SolarPro user ID that owns survey-created rows (single tenant for v1; can extend to per-survey-tool user mapping later).
- New helper `lib/auth-service.ts` exporting `verifySurveyAuth(req)` — cookie-auth path untouched.
- Reject all other methods / paths with 401 `Service auth failed`.

Rationale: the survey tool is a trusted internal service, not a browser session. Cookie JWT does not apply. Bearer token + explicit owning-user keeps the permission model simple while we gauge v1 traffic.

### 4.3 Validation + transactional write

1. Parse body → Zod schema validation. Any failure → 400 with `details: ZodIssue[]` array.
2. Resolve `clientId` (lookup by solarproClientId or email; create if allowed).
3. **BEGIN transaction** on Neon:
   - Upsert `projects` row by `(survey_external_id, user_id)`.
   - Merge `engineering_seed` JSONB.
   - Upsert `layouts` row (one per project).
   - Replace roof planes / obstructions / ground / fence fields.
   - For each photo: if `external_id` not present → skip to photo-fetch queue.
4. **COMMIT**. Photo fetches happen post-commit (async, per-photo; failures surface as warnings, not fatal).
5. Return response with `projectId` and warning list.

If any step in the transaction throws → ROLLBACK and return 500. Photo-fetch failures do not rollback — partial-photo outcomes are recoverable by re-submitting the same payload.

### 4.4 Error handling

| Code | Meaning | HTTP |
|---|---|---|
| `SURVEY_AUTH_FAILED` | Missing / invalid bearer token | 401 |
| `SURVEY_PAYLOAD_INVALID` | Zod validation failed | 400 |
| `SURVEY_CLIENT_NOT_FOUND` | `solarproClientId` set but unresolved, and no fallback identity | 404 |
| `SURVEY_PHOTO_FETCH_FAILED` | One or more photos failed to download | 200 (warning) |
| `SURVEY_DB_TX_FAILED` | Transaction rolled back | 500 |

## 5. Ingestion pipeline design

```
                             ┌─────────────────────────────────────┐
                             │  Survey App (in-house)              │
                             │  surveyExternalId: <uuid>           │
                             │  payload (full snapshot of survey)  │
                             └──────────────┬──────────────────────┘
                                            │ HTTPS POST
                                            │ Authorization: Bearer $SURVEY_INGEST_API_KEY
                                            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                   POST /api/survey/ingest  (app/api/survey/ingest/route.ts)  │
│                                                                              │
│   1. verifySurveyAuth(req)     → 401 on miss                                 │
│   2. Zod parse payload         → 400 on invalid                              │
│   3. Resolve ownerUserId       (= SURVEY_INGEST_DEFAULT_USER_ID for v1)      │
│   4. Resolve client            (lookup-or-create)                            │
│   5. BEGIN TX                                                                │
│        ├─ upsert projects by (survey_external_id, user_id)                   │
│        ├─ merge engineering_seed (deep merge; survey wins for declared keys) │
│        ├─ upsert layouts (one per project)                                   │
│        ├─ replace layout.roofPlanes (survey-plane-id-keyed)                  │
│        ├─ replace layout.placedObstructions                                  │
│        ├─ update ground / fence fields                                       │
│        └─ upsert project_files index (photos.external_id keyed)              │
│      COMMIT                                                                  │
│   6. For each not-yet-fetched photo (async, parallel, 5-wide):               │
│        ├─ GET photo.fileUrl (10s timeout)                                    │
│        ├─ size check ≤ 10 MB                                                 │
│        ├─ store bytes in BLOB target (same backend as existing project_files)│
│        └─ mark project_files.status='ready' or append warning                │
│   7. Return { projectId, layoutId, photoCount, created, warnings[] }         │
└──────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
                                  ┌─────────────────────┐
                                  │  Engineering page   │ (unchanged)
                                  │  hydrates from:     │
                                  │  - projects         │
                                  │  - engineering_seed │
                                  │  - layouts          │
                                  │  - project_files    │
                                  └─────────────────────┘
```

## 6. Open design decisions — awaiting your call

These are decisions I will not make without your review. Each has a recommended default in **bold**.

1. **Notes target.** `notes[]` in the payload: store as `project_files` rows with `file_type='note'` and content in `notes` column, **OR** introduce a new `project_notes` table. The table is cleaner but one new migration; the `project_files` reuse is zero-schema-change.
   **Recommended: reuse `project_files`** for v1 (ship fast); migrate to `project_notes` in v2 if volume justifies it.

2. **Client auto-creation policy.** If `client.solarproClientId` is missing and no email match exists, do we (a) 404, (b) create a new client automatically, or (c) create only when `client.name` AND `client.email` are both present?
   **Recommended: (c)** — requires explicit identity, prevents orphan clients from bad survey payloads.

3. **Layout versioning.** If a survey is re-uploaded with different roof planes, do we (a) overwrite the layout in-place, (b) version it (keep old as `project_versions` snapshot), or (c) reject re-upload if a user has manually edited the layout since last survey?
   **Recommended: (a) + automatic `project_versions` snapshot before overwrite** — preserves history, keeps the "survey is authoritative for field data" rule.

4. **Photo storage backend.** `project_files` today — what's the actual storage? (I see the table + route, but need to confirm whether it stores `file_url` to S3 / local / Neon large objects.) Survey ingest must use the same backend.
   **Recommended: whatever the bill-upload path already does** — I'll mirror its pattern rather than introducing a new one.

5. **Tenant model.** V1 is single-tenant (one `SURVEY_INGEST_DEFAULT_USER_ID`). If multiple SolarPro users own separate survey projects, we need a mapping (e.g. `survey_app_token → user_id` table). Defer or include in v1?
   **Recommended: defer to v2.** V1 ships single-tenant; the single env var is the simplest auth surface. Upgrading to per-user tokens is a drop-in later.

6. **Engineering-seed merge semantics.** When survey updates an existing seed, does survey-provided value ALWAYS win, or only for declared keys (undefined survey fields preserve prior values)?
   **Recommended: only declared keys win.** Survey never nulls-out data it didn't measure. `undefined` in payload means "no opinion, leave alone".

7. **Schema migration for new columns.**
   - `projects.survey_external_id TEXT UNIQUE` (per user; for idempotency).
   - `projects.origin TEXT DEFAULT 'manual'` (for provenance).
   - `project_files.external_id TEXT` (for photo idempotency).
   - `project_files.status TEXT DEFAULT 'ready'` (for async photo state).
   Ship as a single migration file or fold into existing migration runner?
   **Recommended: single new migration `migrations/0XX_survey_ingest.sql`** via the existing `/api/migrate` pattern.

## 7. Testing & drift protection strategy (CI-enforced)

Following the same pattern as Stage 8.2 drift-guards:

### 7.1 New test files

- `lib/survey/ingestSchema.test.ts` — Zod schema tests: valid minimum payload, valid full payload, every required-field miss produces the right error code, idempotency key presence enforced, schemaVersion locked to `'1.0'`.
- `app/api/survey/ingest/route.test.ts` — end-to-end route tests:
  - 401 on missing auth
  - 400 on bad payload
  - Happy path: new survey → creates project + layout + files, returns `created: true`
  - Re-ingest same `surveyExternalId` → updates in place, `created: false`, no duplicate rows
  - Partial photo failure → 200 with warnings
  - DB transaction failure → 500, no partial state committed
- `lib/survey/surveyToEngineeringSeed.test.ts` — unit: given a `SurveyIngestPayload`, produce the expected `EngineeringSeed` delta. Locks the mapping in §3.2.
- `lib/survey/surveyIngestDriftGuard.test.ts` — enforces:
  - `projects.origin` enum stays exactly `{manual, bill_upload, survey, api}`
  - Every field mapped in §3.2 has a test assertion (registry of mappings matches actual route behavior)
  - `SurveyIngestPayload` type has no orphan fields vs the mapping table

### 7.2 CI contract

- All new tests gate PRs (fail → no merge).
- Drift-guard protects the schema contract the same way Stage 8.2 protects the brand-profile contract — if a future edit adds a payload field without updating the mapping, CI fails at PR time.
- Docs contract: `docs/SURVEY_INGEST_CONTRACT_v1.md` (one-page summary) is the single source of truth the survey-app team reads.

## 8. Non-goals for v1 (explicitly deferred)

- No bidirectional sync (SolarPro → Survey writes are out of scope).
- No BOM writes from survey (BOM is derived, not measured).
- No permit writes from survey (permits are derived).
- No real-time updates / websockets / webhooks from survey. Pull-once per submission.
- No panel / inverter / brand selection from survey (engineering chooses).
- No pricing from survey.
- No proposal generation from survey.
- No multi-tenant auth (§6.5).
- No survey-editable-while-open workflow. Survey is a snapshot; SolarPro user owns the project after ingest. Re-ingest = replace snapshot, with `project_versions` history.

## 9. Implementation-phase plan (AFTER you approve this design)

Split into small shippable releases, each with its own drift-guard:

- **v47.434 — Schema migration + service auth skeleton.** New columns, new `lib/auth-service.ts`, route stub returning 501. No ingest logic. Just the surface.
- **v47.435 — Core ingest: project + engineering seed + layout geometry.** No photos yet.
- **v47.436 — Photo fetch + storage pipeline.** Adds the async fetch stage.
- **v47.437 — Drift-guard + contract doc + final integration tests.** Lock the surface.

Total estimated effort: ~3–4 focused release cycles. Each is shippable on its own; survey team can start integrating at v47.435 with photos disabled.

---

**End of proposal.** Please review and flag:
- Any mapping in §3.2 you'd change
- Your calls on the 7 open decisions in §6
- Any field the survey tool captures that I've missed
- Whether the 4-release phasing in §9 is the right granularity

Nothing in this document has been implemented yet.