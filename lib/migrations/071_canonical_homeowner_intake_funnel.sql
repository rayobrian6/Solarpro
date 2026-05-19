-- Migration 071: canonical homeowner intake funnel metadata
-- Reuses intake_funnels; does not create a duplicate intake system.

INSERT INTO intake_funnels (
  slug,
  name,
  description,
  funnel_type,
  source_channel,
  is_active,
  require_phone,
  require_address,
  require_monthly_bill,
  require_roof_type,
  custom_fields,
  rate_limit_per_hour
) VALUES (
  'free-solar-estimate',
  'Canonical Homeowner Intake',
  'Primary public homeowner solar estimate funnel at /free-solar-estimate. Submits to /api/intake/homeowner.',
  'homeowner',
  'web',
  true,
  true,
  true,
  true,
  false,
  '{"canonical_path":"/free-solar-estimate","canonical_endpoint":"/api/intake/homeowner","supports_embed_url":true}'::jsonb,
  100
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  funnel_type = EXCLUDED.funnel_type,
  source_channel = EXCLUDED.source_channel,
  is_active = EXCLUDED.is_active,
  require_phone = EXCLUDED.require_phone,
  require_address = EXCLUDED.require_address,
  require_monthly_bill = EXCLUDED.require_monthly_bill,
  custom_fields = intake_funnels.custom_fields || EXCLUDED.custom_fields,
  updated_at = NOW();
