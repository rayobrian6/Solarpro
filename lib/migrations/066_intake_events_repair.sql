-- Migration 066: repair missing canonical intake_events table
-- Idempotent copy of migration 055 for shared DBs that missed the original intake event migration.

-- Migration 055: intake_events — immutable lifecycle event log

CREATE TABLE IF NOT EXISTS intake_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                TEXT UNIQUE NOT NULL,
  opportunity_id          UUID REFERENCES network_opportunities(id) ON DELETE CASCADE,
  event_type              TEXT NOT NULL,
  event_source            TEXT NOT NULL DEFAULT 'system',
  source_system           TEXT,
  source_channel          TEXT,
  funnel_id               UUID,
  campaign_id             UUID,
  idempotency_key         TEXT,
  payload                 JSONB NOT NULL DEFAULT '{}',
  validation_result       JSONB DEFAULT '{}',
  duplicate_result        JSONB DEFAULT '{}',
  pipeline_result         JSONB DEFAULT '{}',
  action                  TEXT NOT NULL DEFAULT 'unknown',
  error_code              TEXT,
  error_message           TEXT,
  processing_duration_ms  INTEGER,
  ip_address              INET,
  user_agent              TEXT,
  referer                 TEXT,
  utm_source              TEXT,
  utm_medium              TEXT,
  utm_campaign            TEXT,
  utm_content             TEXT,
  utm_term                TEXT,
  gclid                   TEXT,
  fbclid                  TEXT,
  is_replay               BOOLEAN DEFAULT false,
  original_event_id       TEXT,
  occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_events_opportunity_id ON intake_events(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intake_events_event_type ON intake_events(event_type);
CREATE INDEX IF NOT EXISTS idx_intake_events_idempotency_key ON intake_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intake_events_source_system ON intake_events(source_system) WHERE source_system IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intake_events_action ON intake_events(action);
CREATE INDEX IF NOT EXISTS idx_intake_events_occurred_at ON intake_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_events_funnel_id ON intake_events(funnel_id) WHERE funnel_id IS NOT NULL;
