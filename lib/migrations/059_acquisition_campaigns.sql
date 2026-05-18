-- Migration 059: acquisition_campaigns
-- Tracks paid/organic campaigns linked to intake funnels
-- Stores budget, targeting, UTM params, and performance counters

CREATE TABLE IF NOT EXISTS acquisition_campaigns (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       TEXT NOT NULL,
  description                TEXT,
  campaign_type              TEXT NOT NULL DEFAULT 'paid_search',
  status                     TEXT NOT NULL DEFAULT 'draft',
  platform                   TEXT,
  funnel_id                  UUID REFERENCES intake_funnels(id) ON DELETE SET NULL,
  daily_budget_cents         INTEGER,
  monthly_budget_cents       INTEGER,
  total_budget_cents         INTEGER,
  cost_per_lead_target_cents INTEGER,
  leads_target               INTEGER,
  leads_received             INTEGER DEFAULT 0,
  leads_qualified            INTEGER DEFAULT 0,
  leads_converted            INTEGER DEFAULT 0,
  total_spend_cents          INTEGER DEFAULT 0,
  utm_source                 TEXT,
  utm_medium                 TEXT,
  utm_campaign               TEXT,
  utm_content                TEXT,
  utm_term                   TEXT,
  geo_targeting              JSONB DEFAULT '{}',
  audience_targeting         JSONB DEFAULT '{}',
  ad_creative_ids            TEXT[] DEFAULT ARRAY[]::TEXT[],
  start_date                 DATE,
  end_date                   DATE,
  created_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                      TEXT,
  metadata                   JSONB DEFAULT '{}',
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acquisition_campaigns_status
  ON acquisition_campaigns(status);

CREATE INDEX IF NOT EXISTS idx_acquisition_campaigns_funnel_id
  ON acquisition_campaigns(funnel_id)
  WHERE funnel_id IS NOT NULL;
