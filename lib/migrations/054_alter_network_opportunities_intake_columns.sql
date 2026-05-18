-- Migration 054: network_opportunities — full schema + intake/enrichment columns
--
-- Self-contained: creates the table if it does not exist (covers fresh DBs),
-- then adds all intake/enrichment columns with IF NOT EXISTS (idempotent).
-- Safe to re-run at any time.

CREATE TABLE IF NOT EXISTS network_opportunities (
  id                           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  source_type                  TEXT        NOT NULL DEFAULT 'contractor_shared'
                                 CHECK (source_type IN (
                                   'contractor_shared', 'homeowner_direct',
                                   'google_ads', 'facebook_ads', 'tiktok',
                                   'seo', 'referral', 'partner'
                                 )),
  source_opportunity_id        UUID        REFERENCES opportunities(id) ON DELETE SET NULL,
  project_id                   UUID        REFERENCES projects(id) ON DELETE SET NULL,
  introduced_by_user_id        UUID        REFERENCES users(id) ON DELETE SET NULL,

  status                       TEXT        NOT NULL DEFAULT 'intake'
                                 CHECK (status IN (
                                   'intake', 'screening', 'enriching', 'scored',
                                   'routed', 'live', 'claimed',
                                   'closed_won', 'closed_lost', 'expired',
                                   'rejected', 'withdrawn'
                                 )),
  intake_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  screened_at                  TIMESTAMPTZ,
  scored_at                    TIMESTAMPTZ,
  live_at                      TIMESTAMPTZ,
  claimed_at                   TIMESTAMPTZ,
  closed_at                    TIMESTAMPTZ,
  expires_at                   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  homeowner_name               TEXT,
  homeowner_email              TEXT,
  homeowner_phone              TEXT,
  homeowner_ownership          TEXT        CHECK (homeowner_ownership IN ('own', 'rent', 'unknown')),
  homeowner_timeline           TEXT        CHECK (homeowner_timeline IN ('asap', '3_months', '6_months', '1_year', 'just_researching', 'unknown')),
  homeowner_financing_interest BOOLEAN     NOT NULL DEFAULT FALSE,

  address                      TEXT,
  location_city                TEXT,
  location_state               TEXT,
  location_zip                 TEXT,
  lat                          NUMERIC(10,7),
  lng                          NUMERIC(10,7),

  utility_provider             TEXT,
  utility_rate_per_kwh         NUMERIC(8,5),
  annual_usage_kwh             NUMERIC(10,2),
  monthly_usage_avg_kwh        NUMERIC(8,2),
  utility_complexity_score     INTEGER     CHECK (utility_complexity_score BETWEEN 0 AND 100),
  net_metering_type            TEXT,

  estimated_system_size_kw     NUMERIC(8,2),
  irradiance_score             INTEGER     CHECK (irradiance_score BETWEEN 0 AND 100),
  peak_sun_hours_annual        NUMERIC(8,2),
  shading_score                INTEGER     CHECK (shading_score BETWEEN 0 AND 100),
  shading_flag                 BOOLEAN     NOT NULL DEFAULT FALSE,

  roof_material                TEXT,
  roof_pitch                   TEXT,
  roof_condition               TEXT,
  roof_age_years               INTEGER,
  roof_usable_pct              NUMERIC(5,2),
  stories                      TEXT,
  structure_type               TEXT,
  steep_roof_flag              BOOLEAN     NOT NULL DEFAULT FALSE,

  battery_candidate            BOOLEAN     NOT NULL DEFAULT FALSE,
  battery_reason               TEXT,
  battery_use_case             TEXT        CHECK (battery_use_case IN (
                                 'outage_protection','rate_arbitrage','backup_only',
                                 'ev_charging','off_grid', NULL
                               )),

  ahj_name                     TEXT,
  ahj_complexity_score         INTEGER     CHECK (ahj_complexity_score BETWEEN 0 AND 100),
  ahj_notes                    TEXT,

  estimated_project_value      NUMERIC(12,2),
  estimated_annual_savings     NUMERIC(10,2),
  estimated_payback_yrs        NUMERIC(6,2),
  estimated_roi_pct            NUMERIC(6,2),
  applicable_incentives        TEXT[],

  opportunity_score            INTEGER     CHECK (opportunity_score BETWEEN 0 AND 100),
  opportunity_grade            TEXT        CHECK (opportunity_grade IN ('A+', 'A', 'B', 'C', NULL)),
  score_financial              INTEGER     CHECK (score_financial BETWEEN 0 AND 100),
  score_roof                   INTEGER     CHECK (score_roof BETWEEN 0 AND 100),
  score_solar                  INTEGER     CHECK (score_solar BETWEEN 0 AND 100),
  score_homeowner              INTEGER     CHECK (score_homeowner BETWEEN 0 AND 100),
  score_complexity             INTEGER     CHECK (score_complexity BETWEEN 0 AND 100),

  spam_flag                    BOOLEAN     NOT NULL DEFAULT FALSE,
  duplicate_flag               BOOLEAN     NOT NULL DEFAULT FALSE,
  invalid_utility_flag         BOOLEAN     NOT NULL DEFAULT FALSE,
  auto_flags                   TEXT[]      NOT NULL DEFAULT '{}',

  screening_status             TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (screening_status IN (
                                   'pending', 'in_review', 'approved', 'rejected', 'escalated'
                                 )),
  screening_notes              TEXT,
  screened_by_admin_id         UUID        REFERENCES users(id) ON DELETE SET NULL,

  asking_price                 NUMERIC(10,2),
  listing_notes                TEXT,

  routed_to_user_id            UUID        REFERENCES users(id) ON DELETE SET NULL,
  routing_score                INTEGER,
  routing_notes                TEXT,

  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_net_opps_status_state
  ON network_opportunities (status, location_state)
  WHERE status IN ('live', 'scored', 'routed');

CREATE INDEX IF NOT EXISTS idx_net_opps_screening
  ON network_opportunities (screening_status, intake_at DESC)
  WHERE screening_status IN ('pending', 'in_review', 'escalated');

CREATE INDEX IF NOT EXISTS idx_net_opps_score
  ON network_opportunities (opportunity_score DESC, status)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS idx_net_opps_source
  ON network_opportunities (source_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_net_opps_project
  ON network_opportunities (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_net_opps_source_opp
  ON network_opportunities (source_opportunity_id)
  WHERE source_opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_net_opps_expiry
  ON network_opportunities (expires_at)
  WHERE status = 'live';

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS monthly_bill_amount NUMERIC(10,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS current_electricity_rate NUMERIC(8,4);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS home_ownership TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS roof_type TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS roof_shade TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS square_feet INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS source_system TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS source_channel TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS funnel_id UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS campaign_id UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS gclid TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS fbclid TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS msclkid TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS referrer_url TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS landing_page_url TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'pending';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS enrichment_started_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS enrichment_completed_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS enrichment_provider TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS attom_property_id TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS attom_data JSONB DEFAULT '{}';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS openei_utility_id TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS openei_data JSONB DEFAULT '{}';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_value_estimate NUMERIC(12,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_year_built INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_living_sqft INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_lot_sqft INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_bedrooms INTEGER;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_bathrooms NUMERIC(4,1);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_pool BOOLEAN;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_garage BOOLEAN;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS solar_irradiance_kwh_m2_day NUMERIC(6,3);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS solar_panel_area_sqft NUMERIC(8,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS solar_estimated_kwh_annual NUMERIC(10,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS solar_payback_years NUMERIC(6,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS solar_25yr_savings NUMERIC(12,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS duplicate_of_id UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS duplicate_detected_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS duplicate_score NUMERIC(5,2);
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS validation_errors JSONB DEFAULT '[]';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT '{}';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS intake_metadata JSONB DEFAULT '{}';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS enrichment_metadata JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_net_opps_enrichment_status
  ON network_opportunities (enrichment_status)
  WHERE enrichment_status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_net_opps_campaign
  ON network_opportunities (campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_net_opps_funnel
  ON network_opportunities (funnel_id)
  WHERE funnel_id IS NOT NULL;
