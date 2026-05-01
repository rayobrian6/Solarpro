#!/usr/bin/env python3
"""Insert v47.434 entry into lib/roadmapRE26.ts after the v47.433 block."""
import os, tempfile
from pathlib import Path

path = Path("lib/roadmapRE26.ts")
text = path.read_text(encoding='utf-8')

anchor = "    shippedIn: 'v47.433',\n    notes: 'Stage 8.3 (racking unification) remains deferred. With Stage 8.4 complete, the core sizing + BOM layer is fully aligned with canonical equipment-db values. Next: site survey app integration.',\n    createdAt: '2026-04-23',\n    updatedAt: '2026-04-23',\n  },\n"
assert anchor in text, "v47.433 anchor not found in roadmapRE26.ts"

new_entry = """
  // v47.434 \u2014 Stage 9.1 Survey Integration Schema + HMAC + Admin Log
  {
    id: 'v47.434-stage9_1-survey-integration-schema-hmac',
    title: 'v47.434 \u2014 Stage 9.1: Survey Integration Schema + HMAC Verifier + Admin Webhook Log',
    summary: 'First release of the in-house survey tool integration pipeline. v1 is inbound-only (survey backend \u2192 SolarPro, never reverse), thin-event webhook architecture per partner doc: survey tool POSTs minimal envelope { event, schemaVersion, event_id, survey_id, completed_at, survey_url? } with HMAC-SHA256(`${timestamp}.${rawBody}`, secret) signature; SolarPro verifies + logs + (in v47.435+) fetches full payload. v47.434 SHIPS the contract + auth skeleton, DEFERS the ingest pipeline to v47.435 (blocked on survey-team thin-event body confirmation + sample POST). Seven new files + one migration: (1) migrations/011_survey_ingest.sql adds projects.survey_external_id/origin/survey_category/survey_meta columns, project_files.external_id/status, and webhook_deliveries table with 4 indexes + 2 partial-unique idempotency indexes. (2) lib/survey/types.ts frozen v1.0 contract: SchemaVersion=1.0 literal, SurveyEventType=survey.completed literal, SurveyCompletedEvent, WebhookSignatureVerification with 5 reason codes, WebhookDeliveryStatus 6-member union, ProjectOrigin closed enum manual|bill_upload|survey|api. (3) lib/survey/verifyWebhookSignature.ts pure-function HMAC verifier, 5-min timestamp tolerance, constant-time compare via crypto.timingSafeEqual with length-mismatch short-circuit, injectable nowSeconds for deterministic tests. (4) app/api/webhooks/survey-complete/route.ts POST receiver: reads raw body (bytes-exact), verifies HMAC, narrow envelope validator, idempotency check on event_id, logs every delivery (valid or invalid) to webhook_deliveries, returns 501 INGEST_NOT_IMPLEMENTED on success path. (5) app/api/admin/survey-webhook-log/route.ts admin GET with status/source/limit filters. (6) app/api/admin/survey-webhook-log/[id]/replay/route.ts 501 stub (full impl v47.437). (7) app/api/migrate/route.ts inline migration block 011. Tests (+26 across 2 new files): verifyWebhookSignature.test.ts (18 tests covering valid, all 5 failure reason codes, length-mismatch short-circuit, replay defence via timestamp mismatch, byte-exactness, determinism, custom tolerance); contractDriftGuard.test.ts (8 tests locking CURRENT_SCHEMA_VERSION=1.0, SUPPORTED_SURVEY_EVENT_TYPES, PROJECT_ORIGIN_VALUES order + no duplicates + lowercase snake_case DB-text invariant, WebhookDeliveryStatus 6-member snapshot). Full suite 2101/2101 pass across 49 test files (+26 from v47.433 2075). TC=0, npm run build clean (46/46 pages + 3 new API routes registered). ZERO behavioural changes to existing projects/engineering/BOM/proposal paths \u2014 entirely additive surface.',
    track: 'api-integrations',
    priority: 'p1',
    status: 'done',
    effort: 'm',
    files: [
      'migrations/011_survey_ingest.sql',
      'app/api/migrate/route.ts',
      'lib/survey/types.ts',
      'lib/survey/verifyWebhookSignature.ts',
      'lib/survey/verifyWebhookSignature.test.ts',
      'lib/survey/contractDriftGuard.test.ts',
      'app/api/webhooks/survey-complete/route.ts',
      'app/api/admin/survey-webhook-log/route.ts',
      'app/api/admin/survey-webhook-log/[id]/replay/route.ts',
      'docs/SURVEY_INTEGRATION_PROPOSAL_v1.md',
      'docs/stage9_v47434-todo.md',
      'docs/UPGRADE_ROADMAP_v47.399.md',
      'lib/version.ts',
      'lib/roadmapRE26.ts',
    ],
    shippedIn: 'v47.434',
    notes: 'Blocked on survey team for v47.435: thin-event body shape confirmation, sample webhook POST, and access to GET /api/surveys/{id} on survey backend. Stage 9.2 will ship the ingest/transform layer; 9.3 photos+notes; 9.4 contract doc + replay impl. Partner contract pivoted mid-design from pull (SolarPro initiates) to receive-then-fetch (survey pushes webhook, SolarPro fetches full payload) after partner shared actual survey-tool doc \u2014 architecture and implementation updated before any code shipped. Single-tenant v1 (SURVEY_INGEST_DEFAULT_USER_ID env var owns survey-origin rows).',
    createdAt: '2026-04-23',
    updatedAt: '2026-04-23',
  },
"""

replacement = anchor + new_entry
new_text = text.replace(anchor, replacement, 1)
assert new_text != text, "Replacement did not change the file"

tmp = tempfile.NamedTemporaryFile(
    mode='w', encoding='utf-8', delete=False, dir=str(path.parent), suffix='.ts.tmp'
)
try:
    tmp.write(new_text)
    tmp.flush()
    os.fsync(tmp.fileno())
    tmp.close()
    os.replace(tmp.name, path)
except Exception:
    try: os.unlink(tmp.name)
    except OSError: pass
    raise

print(f"Inserted v47.434 entry into {path}")