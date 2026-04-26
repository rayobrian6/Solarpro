-- ============================================================
-- Migration 011: Survey Ingest (v47.434)
--
-- Adds schema surface for in-house survey tool integration.
-- v1 is inbound-only: survey backend webhooks SolarPro on completion,
-- SolarPro verifies HMAC, records delivery, and (in v47.435+) fetches
-- the full payload and transforms it into project/seed/layout/photos.
--
-- All additive. No existing tables modified destructively.
-- IF NOT EXISTS guards make this safe to re-run.
-- ============================================================

-- projects.survey_external_id — idempotency upsert key
-- projects.origin             — provenance tag ('manual' | 'bill_upload' | 'survey' | 'api')
-- projects.survey_category    — informational, carries category_id/category_name
-- projects.survey_meta        — JSONB audit trail (inspector_name, survey_date, device_id, surveyToolVersion, surveyedAt)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS survey_external_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS survey_category TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS survey_meta JSONB;

-- Per-user idempotency. A given user cannot have two projects with the same
-- survey_external_id; two different users COULD (unlikely but permitted).
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_survey_external_id_user
  ON projects(user_id, survey_external_id)
  WHERE survey_external_id IS NOT NULL;

-- project_files.external_id — idempotency key for per-photo/note ingest
-- project_files.status      — async photo fetch lifecycle ('ready' default, 'pending' during fetch, 'failed' on error)
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';

-- Per-project idempotency. A project cannot have two files with the same external_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_files_external_id_project
  ON project_files(project_id, external_id)
  WHERE external_id IS NOT NULL;

-- ============================================================
-- webhook_deliveries — persistent log of every inbound survey webhook.
--
-- Serves three purposes:
--   1. IDEMPOTENCY: if event_id already exists, the webhook handler returns
--      200 no-op instead of re-processing.
--   2. AUDIT: GET /api/admin/survey-webhook-log surfaces this for ops.
--   3. REPLAY: POST /api/admin/survey-webhook-log/:id/replay (v47.437)
--      re-runs ingest against a stored payload.
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                  VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source              TEXT          NOT NULL,              -- 'survey' (room for other sources later)
  event_type          TEXT          NOT NULL,              -- 'survey.completed'
  event_id            TEXT          NOT NULL,              -- X-Survey-Event-Id (idempotency key)
  signature_header    TEXT,                                -- raw X-Survey-Signature for audit
  timestamp_header    TEXT,                                -- raw X-Survey-Timestamp
  signature_valid     BOOLEAN       NOT NULL,              -- HMAC verify result
  raw_body            TEXT,                                -- verbatim POST body (thin event OR full payload per confirmed shape)
  status              TEXT          NOT NULL DEFAULT 'received',
                                                           -- 'received' | 'verified' | 'ingested' | 'failed' | 'replayed' | 'duplicate'
  error_message       TEXT,
  project_id          VARCHAR(36),                         -- populated after successful ingest (v47.435+)
  received_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_source_event
  ON webhook_deliveries(source, event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_received
  ON webhook_deliveries(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
  ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_project
  ON webhook_deliveries(project_id)
  WHERE project_id IS NOT NULL;