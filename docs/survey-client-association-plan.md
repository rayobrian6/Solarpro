# Survey Client/Project Association — Architecture Plan
**Branch: dev | Status: PLAN (pending approval) | Date: 2025-01-27**

---

## 1. Problem Statement

The current survey system **requires a project to exist first** before a field worker can start a survey. The entire flow is:

```
Website (logged-in PM) → /api/projects/[id]/survey-handoff
  → mint JWT (project_id REQUIRED)
  → deep link: sitesurvey://new-survey?token=<jwt>
  → mobile app opens survey with project pre-loaded
```

**The gap**: A field worker on-site with just their phone and no website access cannot:
1. Start a survey standalone
2. Select which client or project to associate the survey with

The `decodeTokenClaims()` function on the client explicitly **rejects** any JWT missing `project_id`. The `buildInitialDraft()` requires `claims.project_id`. The entire `SurveyV2Draft` and `SurveyV2Payload` require `projectId: string`.

---

## 2. Proposed Solution: Standalone Survey + On-Device Picker

### Core Concept
Add a **second entry point** for surveys that does NOT require a pre-existing project. A field worker can:
1. Open the survey app (already logged in via mobile SSO)
2. Tap "New Survey" → opens `https://solarpro.solutions/survey/standalone`
3. On Step 1 (Site Overview), they see a **dropdown listing their company's clients and projects**
4. They pick a client or project → this is embedded in the draft
5. On submit, the ingest pipeline attaches the survey to the selected project (or creates a new one under the selected client)

### Two Survey Entry Points (after this change)

| Entry Point | JWT source | project_id in JWT | Use case |
|---|---|---|---|
| `/survey/[token]` | PM mints via `/api/projects/[id]/survey-handoff` | **Required** | PM dispatches specific tech to specific project |
| `/survey/standalone` | Field worker self-mints via `/api/survey/standalone-handoff` | **Absent (null)** | Field worker self-initiates, picks client/project on device |

---

## 3. Changes Required

### 3a. New API: `POST /api/survey/standalone-handoff`
**Purpose**: Lets an authenticated SolarPro user (field worker with website session cookie or mobile SSO) mint their own handoff JWT without needing a project_id.

**Auth**: Requires valid session cookie (same `getUserFromRequest` check). The mobile SSO already logs the user in via `sitesurvey://login?token=<jwt>` — so the field worker IS authenticated on their device.

**Request**: `POST /api/survey/standalone-handoff` with optional `{ inspectorName?: string }`

**Response**: `{ token: string, deepLink: string }` where deepLink = `sitesurvey://new-survey?token=<jwt>`

**JWT payload** (no project_id):
```json
{
  "jti": "<uuid>",
  "project_id": "__standalone__",
  "project_name": "",
  "solarpro_user_id": "<user.id>",
  "solarpro_email": "<user.email>",
  "inspector_name": "<user.name or body.inspectorName>",
  "standalone": true,
  "iat": ...,
  "exp": "now + 24h"
}
```

**Note on `project_id: "__standalone__"`**: We use a sentinel value rather than null/empty because the JWT library and existing code always expect `project_id` to be a string. The sentinel `"__standalone__"` is clearly not a UUID and is handled explicitly throughout the pipeline.

---

### 3b. New API: `GET /api/survey/lookup-data?token=<jwt>`
**Purpose**: Called by the survey app on load when `standalone: true`. Returns the list of clients + projects the user can pick from.

**Auth**: Validates the JWT (same `verifyHandoffToken`), extracts `solarpro_user_id`, queries DB for that user's clients and projects.

**Response**:
```json
{
  "success": true,
  "data": {
    "clients": [
      { "id": "uuid", "name": "Smith Residence", "address": "123 Main St..." }
    ],
    "projects": [
      { "id": "uuid", "name": "Smith Solar Install", "clientId": "uuid", "clientName": "Smith Residence", "address": "123 Main St..." }
    ]
  }
}
```

**No session cookie required** — the JWT itself proves identity. This matches the pattern of `/api/survey/submit` which also accepts JWT-only (no cookie) so a pure mobile device can call it.

---

### 3c. New Page: `/survey/standalone`
A simple redirect/bridge page that:
1. Checks if user has a session cookie
2. Calls `POST /api/survey/standalone-handoff`
3. Redirects to `sitesurvey://new-survey?token=<jwt>`

OR — if the field worker is accessing this via the mobile browser directly (already has mobile SSO active), the mobile app catches the deep link and loads the survey.

**Alternative approach**: The mobile app can call `POST /api/survey/standalone-handoff` directly after SSO login, using the stored session. This may be simpler depending on how the mobile app works.

---

### 3d. Update `HandoffClaims` + `decodeTokenClaims` (lib/survey/v2/defaults.ts)

Change `project_id` from required to optional in the `HandoffClaims` interface:

```typescript
export interface HandoffClaims {
  jti: string;
  project_id: string;           // "__standalone__" for standalone surveys
  standalone?: boolean;          // NEW: true = field worker self-initiated
  project_name?: string;
  // ... rest unchanged
}
```

Update `decodeTokenClaims` to accept `project_id === "__standalone__"` as valid (currently rejects if `!decoded.project_id`).

Update `buildInitialDraft` to set `projectId: ""` when standalone, leaving `projectName: ""` for the field worker to fill.

---

### 3e. Update `StepSiteOverview` — Add Client/Project Picker

When the draft has `standalone: true` (or `projectId === "__standalone__"`), show a **new card at the top of Step 1** with a searchable dropdown:

```
┌─────────────────────────────────────────────────────┐
│  Associate with Client or Project             [req] │
│                                                     │
│  ○ Select a Client (creates survey under client)    │
│  ○ Select an Existing Project                       │
│                                                     │
│  [dropdown: Smith Residence — 123 Main St]          │
└─────────────────────────────────────────────────────┘
```

**Two modes**:
- **Client mode**: Field worker picks a client → on ingest, a new project is created under that client, survey attached to it
- **Project mode**: Field worker picks an existing project → survey attaches directly to that project

The dropdown shows a combined list: clients first (labeled "Client"), then projects (labeled "Project — Client Name"). It's searchable/filterable.

**State stored in draft**: Two new optional fields on `SurveyV2Draft`:
```typescript
selectedClientId?: string;   // UUID of selected client
selectedProjectId?: string;  // UUID of selected project (overrides clientId)
```

**canAdvanceStep validation**: Step 1 now requires EITHER `selectedClientId` OR `selectedProjectId` when `standalone === true`.

---

### 3f. Update `SurveyV2Draft` + `SurveyV2Payload` types

```typescript
// In SurveyV2Draft
selectedClientId?: string;    // set by field worker on standalone survey
selectedProjectId?: string;   // set by field worker on standalone survey
standalone?: boolean;          // true for self-initiated surveys

// In SurveyV2Payload (submitted payload)  
selectedClientId?: string;
selectedProjectId?: string;
```

---

### 3g. Update `POST /api/survey/submit`

Currently validates `payload.projectId === claims.project_id`. 

For standalone surveys (claims.project_id === `"__standalone__"`):
- Accept any `selectedProjectId` or `selectedClientId` from payload
- Forward both to the webhook/ingest pipeline via the `SurveyCompletedEvent`

Add to the webhook body forwarded to ingest:
```typescript
solarpro_selected_project_id: payload.selectedProjectId || null,
solarpro_selected_client_id: payload.selectedClientId || null,
```

---

### 3h. Update `projectLinkResolver.ts`

Add a 7th resolution strategy **before** the existing "create orphan" fallback:

```
Strategy Priority (for standalone surveys):
  1. solarpro_selected_project_id → attach to that project (field worker picked project)
  2. solarpro_selected_client_id  → create new project under that client
  3. solarpro_project_id (from JWT) → existing attach logic (unchanged)
  4. no project → create orphan (existing fallback)
```

The new strategies slot in BEFORE the "create orphan" case so existing behavior is fully preserved.

---

### 3i. Update `SurveyShell` header

When `projectName === ""` (standalone, not yet assigned), show "Tap to assign client" placeholder in amber color instead of "Untitled Project" in gray.

---

## 4. What Does NOT Change

- **The existing `/survey/[token]` flow is 100% unchanged**. JWT with project_id works exactly as today.
- **The webhook contract (`lib/survey/types.ts`) wire format is preserved** — only new optional fields added.
- **The ingest pipeline** core logic unchanged — only the `projectLinkResolver` gets new strategies prepended.
- **The `verifyWebhookSignature` logic** — unchanged.
- **No DB migrations needed** — `projects.client_id` already exists; we're just using `selectedClientId` to populate it when creating the orphan project.

---

## 5. Security Considerations

1. **`GET /api/survey/lookup-data`**: Validates the handoff JWT (HMAC-SHA256 with `SOLARPRO_HANDOFF_SECRET`). The `solarpro_user_id` claim in the JWT is used for the DB query — a tampered JWT will fail HMAC verification. No session cookie needed (matches existing `/api/survey/submit` pattern).

2. **`POST /api/survey/standalone-handoff`**: Requires session cookie (same as `/api/projects/[id]/survey-handoff`). Rate limited.

3. **Client/project picker data**: Only returns clients/projects owned by the JWT's `solarpro_user_id`. No cross-user data leakage possible.

4. **Sentinel `"__standalone__"`**: Explicitly rejected by `projectLinkResolver` as a real project_id — it triggers the new resolution path.

---

## 6. File Change Summary

| File | Change Type | Description |
|---|---|---|
| `app/api/survey/standalone-handoff/route.ts` | **NEW** | Self-mint handoff JWT without project |
| `app/api/survey/lookup-data/route.ts` | **NEW** | Return clients+projects for standalone picker |
| `lib/survey/v2/types.ts` | **MODIFY** | Add `standalone?`, `selectedClientId?`, `selectedProjectId?` to Draft+Payload |
| `lib/survey/v2/defaults.ts` | **MODIFY** | Handle standalone JWT claims, update `decodeTokenClaims` |
| `app/survey/[token]/page.tsx` | **MODIFY** | Fetch lookup data when standalone, pass to StepSiteOverview |
| `components/survey/StepSiteOverview.tsx` | **MODIFY** | Add client/project picker card |
| `app/api/survey/submit/route.ts` | **MODIFY** | Handle standalone projectId + forward selectedClientId/ProjectId |
| `lib/survey/ingest/projectLinkResolver.ts` | **MODIFY** | New strategies for selectedProjectId/ClientId |
| `lib/survey/types.ts` | **MODIFY** | Add `solarpro_selected_project_id?`, `solarpro_selected_client_id?` to webhook contract |
| `components/survey/SurveyShell.tsx` | **MODIFY** | Unassigned state header |

**Total**: 2 new files, 8 modified files. No DB migrations. No changes to master.

---

## 7. Field Worker UX Flow (after this change)

```
[Field worker, on-site, phone in hand]

Option A — PM sent them a link (existing flow, unchanged):
  SMS/email link → sitesurvey://new-survey?token=<jwt_with_project>
  → Opens survey, project pre-filled, just start filling in data ✓

Option B — Self-initiated (NEW):
  Mobile app → "New Survey" button
  → App calls POST /api/survey/standalone-handoff (using stored SSO session)
  → Gets token → opens /survey/<token>
  → Step 1: sees "Associate with Client or Project" dropdown
  → Picks "Smith Residence" from dropdown
  → Fills in site address, structure type, etc.
  → Completes all 6 steps, submits
  → Ingest pipeline: attaches to Smith Residence (creates project or attaches to existing)
  → PM sees survey data appear on project dashboard ✓
```

---

## 8. Open Questions for User

1. **Should the picker be required or optional?** If optional (field worker can skip picking a client/project), the survey becomes an orphan and requires manual triage. Recommended: **required** — the dropdown must be filled before Step 1 can advance.

2. **When field worker picks a Client (not a project)**: Should the system (a) create a new project automatically named after the client + today's date, or (b) show the client's existing projects as a secondary picker to attach to one of them?

3. **Picker search**: The dropdown could have 10s or 100s of entries. Should it be a simple `<select>` or a searchable combobox (type to filter)?

4. **Access control**: Should ALL users (any role) be able to use standalone-handoff, or only users with a specific role (e.g., field_tech or above)?

---

*Ready to implement on `dev` branch upon approval. No changes to `master`.*