#!/usr/bin/env python3
"""v47.434 roadmap doc update — append Stage 9.1 section, update status list."""
import os, tempfile
from pathlib import Path

path = Path("docs/UPGRADE_ROADMAP_v47.399.md")
lines = path.read_text(encoding='utf-8').splitlines()

# Update Stage-status line (the long [~] Stage 8 line) to mention Stage 9.1 shipped
# and add a [~] Stage 9 tracker line.
new_stage_9_line = (
    "- [~] Stage 9 \u2014 Survey app integration + cleanup: "
    "**9.1 shipped v47.434** (survey ingest schema + HMAC verifier + admin webhook log: "
    "migration 011 adds projects.origin/survey_external_id/survey_meta + webhook_deliveries table; "
    "POST /api/webhooks/survey-complete verifies HMAC-SHA256 + logs every delivery + returns 501 "
    "INGEST_NOT_IMPLEMENTED; GET /api/admin/survey-webhook-log + POST replay stub; contract frozen "
    "at schemaVersion '1.0' with thin-event default; +26 tests: 18 HMAC + 8 contract drift-guard). "
    "**9.2\u20139.4 pending** (fetch+transform, photos/notes, drift-guard doc + replay impl)."
)

# Replace the existing "- [ ] Stage 9 \u2014 Cleanup + docs" line with our tracker.
replaced = False
for i, line in enumerate(lines):
    if line.strip() == "- [ ] Stage 9 \u2014 Cleanup + docs":
        lines[i] = new_stage_9_line
        replaced = True
        break
assert replaced, "Could not find Stage 9 status line to update"

# Append a new Stage 9.1 detail section at the end
new_section = [
    "",
    "### \U0001F527 Stage 9.1 \u2014 Survey Integration Schema + HMAC Verifier + Admin Log (shipped v47.434)",
    "",
    "**Scope:** first release of the in-house survey tool integration pipeline. v1 is inbound-only "
    "(survey backend \u2192 SolarPro), thin-event webhook architecture per partner doc. This release ships "
    "the contract + auth skeleton and defers the ingest pipeline to v47.435 (blocked on survey-team "
    "thin-event body confirmation + sample POST).",
    "",
    "**Architecture locked:**",
    "",
    "- **Thin-event default.** Survey tool POSTs minimal envelope `{ event, schemaVersion, event_id, survey_id, completed_at, survey_url? }`. SolarPro verifies + logs + (in v47.435+) fetches full payload via `survey_url` or `${SURVEY_BACKEND_URL}/api/surveys/{survey_id}`.",
    "- **HMAC-SHA256** over `${timestamp}.${rawBody}` with secret = `SURVEY_WEBHOOK_SECRET` env var. Constant-time compare via `crypto.timingSafeEqual`. 5-minute timestamp tolerance.",
    "- **`X-Survey-Event-Id` is the idempotency key.** Duplicate deliveries \u2192 200 no-op. Enforced via partial-unique index `idx_projects_survey_external_id_user`.",
    "- **`projects.origin` is a closed enum** `{ manual, bill_upload, survey, api }` locked by drift-guard.",
    "- **Single-tenant v1.** `SURVEY_INGEST_DEFAULT_USER_ID` env var will own survey-origin rows in v47.435.",
    "",
    "**Deliverables (7 new files + 1 modified):**",
    "",
    "1. **`migrations/011_survey_ingest.sql`** \u2014 canonical SQL doc. Adds: `projects.survey_external_id TEXT`, `projects.origin TEXT NOT NULL DEFAULT 'manual'`, `projects.survey_category TEXT`, `projects.survey_meta JSONB`; `project_files.external_id TEXT`, `project_files.status TEXT NOT NULL DEFAULT 'ready'`; `webhook_deliveries` table (13 columns + 4 indexes + 2 partial-unique indexes for idempotency). All `ALTER TABLE` use `IF NOT EXISTS` guards.",
    "2. **`app/api/migrate/route.ts`** (modified) \u2014 inline migration block 011 added; idempotent on re-run.",
    "3. **`lib/survey/types.ts`** \u2014 frozen v1.0 type contract: `SchemaVersion = '1.0'`, `CURRENT_SCHEMA_VERSION`, `SurveyEventType = 'survey.completed'`, `SUPPORTED_SURVEY_EVENT_TYPES`, `SurveyCompletedEvent`, `WebhookSignatureVerification` (5 reason codes: `MISSING_SIGNATURE_HEADER`, `MISSING_TIMESTAMP_HEADER`, `TIMESTAMP_OUT_OF_TOLERANCE`, `SIGNATURE_MISMATCH`, `MALFORMED_TIMESTAMP`), `WebhookDeliveryStatus` 6-member union (`received|verified|duplicate|ingested|failed|replayed`), `WebhookDelivery` row mirror, `ProjectOrigin`, `PROJECT_ORIGIN_VALUES`.",
    "4. **`lib/survey/verifyWebhookSignature.ts`** \u2014 pure-function HMAC verifier. `TIMESTAMP_TOLERANCE_SECONDS = 300`. Injectable `nowSeconds` for deterministic testing. Length-mismatch short-circuit before `timingSafeEqual`. No DB/network side-effects \u2014 caller decides what to persist.",
    "5. **`app/api/webhooks/survey-complete/route.ts`** \u2014 POST receiver. Reads raw body (bytes-exact), verifies HMAC, narrow envelope validator, idempotency check against `webhook_deliveries`, inserts delivery row (valid OR invalid \u2014 logs everything), returns 501 `INGEST_NOT_IMPLEMENTED` on success path. Missing secret \u2192 500 with no DB side-effect.",
    "6. **`app/api/admin/survey-webhook-log/route.ts`** \u2014 GET endpoint. Admin-only via `requireAdminApi`. Filters: `?status`, `?source`, `?limit` (default 100, max 500). Rows ordered DESC by `received_at`.",
    "7. **`app/api/admin/survey-webhook-log/[id]/replay/route.ts`** \u2014 POST stub. Admin-only. Returns 501 `REPLAY_NOT_IMPLEMENTED`. Endpoint shape locked for admin UI to wire; full semantics ship in v47.437.",
    "",
    "**Tests (+26 across 2 new files):**",
    "",
    "- **`lib/survey/verifyWebhookSignature.test.ts`** (18 tests) \u2014 valid signatures (exactly-now, within-window back/forward); all 5 failure reason codes; length-mismatch short-circuit; replay defence (sig computed over different timestamp); byte-exactness (whitespace in body changes signature); determinism; custom tolerance window.",
    "- **`lib/survey/contractDriftGuard.test.ts`** (8 tests) \u2014 value-level snapshot of v1.0 contract constants. Locks `CURRENT_SCHEMA_VERSION='1.0'`, `SUPPORTED_SURVEY_EVENT_TYPES=['survey.completed']`, `PROJECT_ORIGIN_VALUES=['manual','bill_upload','survey','api']` (exact order + no duplicates + lowercase snake_case DB-text invariant), `WebhookDeliveryStatus` 6-member union snapshot. Bumping any of these forces touching this test = conscious contract-change review.",
    "",
    "**Verification:** 2101/2101 tests pass across 49 test files (+26 new over v47.433's 2075). TC=0, `npm run build` clean (46/46 pages + 3 new API routes registered).",
    "",
    "**Blocked on survey team (v47.435 gate):**",
    "",
    "- Confirmation of the thin-event body shape (schemaVersion + event_id + survey_id + completed_at envelope \u2014 or a fat-event variant).",
    "- Sample webhook POST (captured bytes + signature) to validate end-to-end against a real survey deployment.",
    "- Access credentials / endpoint URL for `GET /api/surveys/{id}` on the survey backend.",
    "",
    "**Remaining 9.x backlog:**",
    "",
    "- **Stage 9.2** (v47.435) \u2014 Ingest pipeline: fetch full survey payload from survey backend, transform into `projects.engineeringSeed` + `Layout` + photo attachments, upsert with idempotency on `(user_id, survey_external_id)`. Mark delivery `status='ingested'`.",
    "- **Stage 9.3** (v47.436) \u2014 Photos + notes + checklist ingest. Mirror bill-upload asset-storage pattern; async `project_files.status` lifecycle (pending \u2192 ready / failed).",
    "- **Stage 9.4** (v47.437) \u2014 Contract doc `docs/SURVEY_INTEGRATION_CONTRACT_v1.md`, replay admin action (re-run transform against stored `raw_body`), end-to-end drift-guard test (mock webhook \u2192 logged delivery \u2192 project rows).",
    "",
]
lines.extend(new_section)

output = "\n".join(lines) + "\n"

tmp = tempfile.NamedTemporaryFile(
    mode='w', encoding='utf-8', delete=False, dir=str(path.parent), suffix='.md.tmp'
)
try:
    tmp.write(output)
    tmp.flush()
    os.fsync(tmp.fileno())
    tmp.close()
    os.replace(tmp.name, path)
except Exception:
    try: os.unlink(tmp.name)
    except OSError: pass
    raise

print(f"Updated {path} (lines now {len(output.splitlines())})")