-- Migration 058: intake_funnels
-- Funnel configuration table for multi-channel lead intake
-- Each funnel defines a source channel, required fields, and validation rules

CREATE TABLE IF NOT EXISTS intake_funnels (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT,
  funnel_type           TEXT NOT NULL DEFAULT 'lead_gen',
  source_channel        TEXT NOT NULL DEFAULT 'web',
  is_active             BOOLEAN DEFAULT true,
  require_phone         BOOLEAN DEFAULT false,
  require_address       BOOLEAN DEFAULT false,
  require_monthly_bill  BOOLEAN DEFAULT false,
  require_roof_type     BOOLEAN DEFAULT false,
  campaign_id           UUID,
  thank_you_url         TEXT,
  webhook_notify_url    TEXT,
  custom_fields         JSONB DEFAULT '{}',
  validation_rules      JSONB DEFAULT '{}',
  intake_key            TEXT UNIQUE,
  rate_limit_per_hour   INTEGER DEFAULT 100,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default funnels
INSERT INTO intake_funnels (slug, name, description, funnel_type, source_channel, require_monthly_bill)
VALUES
  ('solar-estimate',  'Solar Savings Estimate',  'Homeowner solar estimate request form',       'lead_gen',     'web', false),
  ('bill-upload',     'Bill Upload Flow',         'Upload utility bill to get savings estimate', 'bill_upload',  'web', true),
  ('battery-savings', 'Battery + Solar Savings',  'Battery storage + solar combo inquiry',       'lead_gen',     'web', false),
  ('instant-quote',   'Instant Quote Tool',       'Instant price estimate based on address',     'instant_quote','web', false)
ON CONFLICT (slug) DO NOTHING;
