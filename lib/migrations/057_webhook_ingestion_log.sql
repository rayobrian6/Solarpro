-- Migration 057: webhook_ingestion_log — immutable audit log with UNIQUE(idempotency_key)

CREATE TABLE IF NOT EXISTS webhook_ingestion_log (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key         TEXT UNIQUE NOT NULL,
  platform                TEXT NOT NULL,
  partner_id              TEXT,
  opportunity_id          UUID REFERENCES network_opportunities(id) ON DELETE SET NULL,
  http_method             TEXT NOT NULL DEFAULT 'POST',
  request_headers         JSONB DEFAULT '{}',
  raw_body                TEXT,
  parsed_payload          JSONB DEFAULT '{}',
  signature_header        TEXT,
  signature_verified      BOOLEAN DEFAULT false,
  verification_method     TEXT,
  status                  TEXT NOT NULL DEFAULT 'received',
  action                  TEXT,
  processing_error        TEXT,
  retry_count             INTEGER DEFAULT 0,
  is_replay               BOOLEAN DEFAULT false,
  original_log_id         UUID REFERENCES webhook_ingestion_log(id) ON DELETE SET NULL,
  leads_received          INTEGER DEFAULT 0,
  leads_created           INTEGER DEFAULT 0,
  leads_duplicate         INTEGER DEFAULT 0,
  leads_errored           INTEGER DEFAULT 0,
  processing_duration_ms  INTEGER,
  ip_address              INET,
  user_agent              TEXT,
  received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_platform ON webhook_ingestion_log(platform);
CREATE INDEX IF NOT EXISTS idx_webhook_log_status ON webhook_ingestion_log(status);
CREATE INDEX IF NOT EXISTS idx_webhook_log_received_at ON webhook_ingestion_log(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_log_opportunity_id ON webhook_ingestion_log(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_log_partner_id ON webhook_ingestion_log(partner_id) WHERE partner_id IS NOT NULL
