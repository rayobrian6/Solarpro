-- Migration 062: network_opportunities canonical column harmonization
--
-- Purpose:
--   Existing production/dev shared DBs may have network_opportunities from the older
--   inline migration shape. Migration 054 creates the canonical shape only on fresh
--   DBs and adds intake columns, but it does not backfill every canonical marketplace
--   column onto pre-existing tables.
--
-- This migration is intentionally idempotent and additive. It does not create a
-- duplicate opportunity system and does not mutate lifecycle state.

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS intake_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS screened_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS live_at TIMESTAMPTZ;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS homeowner_name TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS homeowner_ownership TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS homeowner_timeline TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS homeowner_financing_interest BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS location_city TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS location_state TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS location_zip TEXT;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utility_provider TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utility_rate_per_kwh NUMERIC(8,5);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS monthly_usage_avg_kwh NUMERIC(8,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utility_complexity_score INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS net_metering_type TEXT;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS estimated_system_size_kw NUMERIC(8,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS irradiance_score INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS peak_sun_hours_annual NUMERIC(8,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS shading_score INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS shading_flag BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS roof_material TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS roof_pitch TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS roof_condition TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS roof_usable_pct NUMERIC(5,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS steep_roof_flag BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS battery_candidate BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS battery_reason TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS battery_use_case TEXT;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS ahj_name TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS ahj_complexity_score INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS ahj_notes TEXT;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS estimated_project_value NUMERIC(12,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS estimated_annual_savings NUMERIC(10,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS estimated_payback_yrs NUMERIC(6,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS estimated_roi_pct NUMERIC(6,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS applicable_incentives TEXT[];

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS score_financial INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS score_roof INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS score_solar INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS score_homeowner INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS score_complexity INTEGER;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS spam_flag BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS duplicate_flag BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS invalid_utility_flag BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS auto_flags TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS screening_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS screening_notes TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS screened_by_admin_id UUID;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS asking_price NUMERIC(10,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS listing_notes TEXT;

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS routed_to_user_id UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS routing_score INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS routing_notes TEXT;

-- Intake/simulator marker fields; repeated here to make this migration sufficient
-- even when 054 was skipped or partially applied.
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS source_channel TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT '{}';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS intake_metadata JSONB DEFAULT '{}';

-- Preserve existing legacy values into canonical display columns where possible.
-- Use guarded dynamic SQL so this migration also succeeds on fresh canonical DBs
-- where legacy inline-migration columns do not exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'network_opportunities' AND column_name = 'homeowner_first_name'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'network_opportunities' AND column_name = 'homeowner_last_name'
  ) THEN
    EXECUTE $sql$
      UPDATE network_opportunities
      SET homeowner_name = COALESCE(homeowner_name, NULLIF(TRIM(CONCAT(COALESCE(homeowner_first_name, ''), ' ', COALESCE(homeowner_last_name, ''))), ''))
      WHERE homeowner_name IS NULL
        AND (homeowner_first_name IS NOT NULL OR homeowner_last_name IS NOT NULL)
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'network_opportunities' AND column_name = 'city'
  ) THEN
    EXECUTE $sql$
      UPDATE network_opportunities
      SET location_city = COALESCE(location_city, city)
      WHERE location_city IS NULL AND city IS NOT NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'network_opportunities' AND column_name = 'state'
  ) THEN
    EXECUTE $sql$
      UPDATE network_opportunities
      SET location_state = COALESCE(location_state, state)
      WHERE location_state IS NULL AND state IS NOT NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'network_opportunities' AND column_name = 'zip'
  ) THEN
    EXECUTE $sql$
      UPDATE network_opportunities
      SET location_zip = COALESCE(location_zip, zip)
      WHERE location_zip IS NULL AND zip IS NOT NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'network_opportunities' AND column_name = 'monthly_bill'
  ) THEN
    EXECUTE $sql$
      UPDATE network_opportunities
      SET monthly_usage_avg_kwh = COALESCE(monthly_usage_avg_kwh, monthly_bill)
      WHERE monthly_usage_avg_kwh IS NULL AND monthly_bill IS NOT NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'network_opportunities' AND column_name = 'utility_name'
  ) THEN
    EXECUTE $sql$
      UPDATE network_opportunities
      SET utility_provider = COALESCE(utility_provider, utility_name)
      WHERE utility_provider IS NULL AND utility_name IS NOT NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'network_opportunities' AND column_name = 'battery_interest'
  ) THEN
    EXECUTE $sql$
      UPDATE network_opportunities
      SET battery_candidate = COALESCE(battery_candidate, battery_interest, false)
      WHERE battery_candidate IS NULL
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_net_opps_simulator_marker
  ON network_opportunities (source_channel, created_at DESC)
  WHERE source_channel = 'simulator';

CREATE INDEX IF NOT EXISTS idx_net_opps_canonical_live_state
  ON network_opportunities (status, location_state)
  WHERE status IN ('live', 'scored', 'routed');
