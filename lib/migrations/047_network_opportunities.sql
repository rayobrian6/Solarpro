-- ============================================================
-- Migration 047: network_opportunities
--
-- The canonical, enriched Opportunity object for the SolarPro
-- Network Intelligence OS.
--
-- This is NOT a lead board. Every row here represents a
-- property that has been ingested, analyzed, scored, and
-- released to the marketplace — or is queued for processing.
--
-- RELATIONSHIP TO opportunities (table 045):
--   - contractor_shared opps from table 045 are promoted into
--     this table after screening. They link via source_opportunity_id.
--   - solarpro_generated opps (Phase 2+) originate here directly.
--   - This table is the single source of truth for the Control Center.
--
-- SOURCE TYPES:
--   contractor_shared    — contractor shared a project via /network
--   homeowner_direct     — homeowner submitted via intake form
--   google_ads           — paid acquisition via Google
--   facebook_ads         — paid acquisition via Facebook/Meta
--   tiktok               — paid acquisition via TikTok
--   seo                  — organic search traffic intake
--   referral             — contractor/homeowner referral
--   partner              — partner program integration
--
-- LIFECYCLE STATUS:
--   intake       — just received, not yet screened
--   screening    — in the screening pipeline
--   enriching    — pending additional data (irradiance, AHJ lookup, etc.)
--   scored       — intelligence complete, ready for routing
--   routed       — sent to contractor matching
--   live         — visible on contractor marketplace
--   claimed      — exclusively claimed by a contractor
--   closed_won   — installed / deal closed
--   closed_lost  — homeowner declined / not viable
--   expired      — listing expired without claim
--   rejected     — failed screening (spam, duplicate, invalid)
--   withdrawn    — source withdrew the opportunity
--
-- Safe to re-run (IF NOT EXISTS guards).
-- ============================================================

CREATE TABLE IF NOT EXISTS network_opportunities (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Origin ────────────────────────────────────────────────────────────────
  -- Source type — every opportunity knows exactly how it entered the system
  source_type               TEXT        NOT NULL DEFAULT 'contractor_shared'
                              CHECK (source_type IN (
                                'contractor_shared', 'homeowner_direct',
                                'google_ads', 'facebook_ads', 'tiktok',
                                'seo', 'referral', 'partner'
                              )),

  -- Link back to the original opportunities table row (contractor_shared only)
  source_opportunity_id     UUID        REFERENCES opportunities(id) ON DELETE SET NULL,

  -- Link to a SolarPro project (if one exists)
  project_id                UUID        REFERENCES projects(id) ON DELETE SET NULL,

  -- The user who introduced this opportunity (contractor for shared; NULL for ads)
  introduced_by_user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,

  -- ── Lifecycle ────────────────────────────────────────────────────────────
  status                    TEXT        NOT NULL DEFAULT 'intake'
                              CHECK (status IN (
                                'intake', 'screening', 'enriching', 'scored',
                                'routed', 'live', 'claimed',
                                'closed_won', 'closed_lost', 'expired',
                                'rejected', 'withdrawn'
                              )),

  -- Timestamps for each major state transition
  intake_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  screened_at               TIMESTAMPTZ,
  scored_at                 TIMESTAMPTZ,
  live_at                   TIMESTAMPTZ,
  claimed_at                TIMESTAMPTZ,
  closed_at                 TIMESTAMPTZ,
  expires_at                TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  -- ── Homeowner ────────────────────────────────────────────────────────────
  -- For Phase 2+ homeowner intake. NULL for contractor_shared in Phase 1.
  homeowner_name            TEXT,
  homeowner_email           TEXT,
  homeowner_phone           TEXT,
  homeowner_ownership       TEXT        CHECK (homeowner_ownership IN ('own', 'rent', 'unknown')),
  homeowner_timeline        TEXT        CHECK (homeowner_timeline IN ('asap', '3_months', '6_months', '1_year', 'just_researching', 'unknown')),
  homeowner_financing_interest BOOLEAN  NOT NULL DEFAULT FALSE,

  -- ── Location ─────────────────────────────────────────────────────────────
  -- Full address only accessible to assigned contractor post-claim
  address                   TEXT,
  location_city             TEXT,
  location_state            TEXT,
  location_zip              TEXT,
  lat                       NUMERIC(10,7),
  lng                       NUMERIC(10,7),

  -- ── Utility Intelligence ──────────────────────────────────────────────────
  utility_provider          TEXT,
  utility_rate_per_kwh      NUMERIC(8,5),
  annual_usage_kwh          NUMERIC(10,2),
  monthly_usage_avg_kwh     NUMERIC(8,2),
  utility_complexity_score  INTEGER     CHECK (utility_complexity_score BETWEEN 0 AND 100),
  -- NEM status / export rate policy
  net_metering_type         TEXT,

  -- ── Solar Intelligence ────────────────────────────────────────────────────
  estimated_system_size_kw  NUMERIC(8,2),
  irradiance_score          INTEGER     CHECK (irradiance_score BETWEEN 0 AND 100),
  -- kWh/kWp/year from sun resource analysis
  peak_sun_hours_annual     NUMERIC(8,2),
  shading_score             INTEGER     CHECK (shading_score BETWEEN 0 AND 100),
  -- 0 = no shading concern, 100 = severe shading
  shading_flag              BOOLEAN     NOT NULL DEFAULT FALSE,

  -- ── Roof Intelligence ─────────────────────────────────────────────────────
  roof_material             TEXT,
  roof_pitch                TEXT,
  roof_condition            TEXT,
  roof_age_years            INTEGER,
  roof_usable_pct           NUMERIC(5,2),
  stories                   TEXT,
  structure_type            TEXT,
  steep_roof_flag           BOOLEAN     NOT NULL DEFAULT FALSE,

  -- ── Battery Intelligence ──────────────────────────────────────────────────
  battery_candidate         BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Why battery is recommended
  battery_reason            TEXT,
  -- outage_protection | rate_arbitrage | backup_only | ev_charging | off_grid
  battery_use_case          TEXT        CHECK (battery_use_case IN (
                              'outage_protection','rate_arbitrage','backup_only',
                              'ev_charging','off_grid', NULL
                            )),

  -- ── AHJ Intelligence ──────────────────────────────────────────────────────
  ahj_name                  TEXT,
  ahj_complexity_score      INTEGER     CHECK (ahj_complexity_score BETWEEN 0 AND 100),
  -- 0 = easy (online portal, fast turnaround), 100 = nightmare
  ahj_notes                 TEXT,

  -- ── Financial Analysis ────────────────────────────────────────────────────
  estimated_project_value   NUMERIC(12,2),
  estimated_annual_savings  NUMERIC(10,2),
  estimated_payback_yrs     NUMERIC(6,2),
  estimated_roi_pct         NUMERIC(6,2),
  -- ITC and state incentives applicable
  applicable_incentives     TEXT[],

  -- ── Opportunity Intelligence Score ────────────────────────────────────────
  -- Composite score 0–100 powering A+/A/B/C grade
  opportunity_score         INTEGER     CHECK (opportunity_score BETWEEN 0 AND 100),
  opportunity_grade         TEXT        CHECK (opportunity_grade IN ('A+', 'A', 'B', 'C', NULL)),

  -- Subscores (0–100 each)
  score_financial           INTEGER     CHECK (score_financial BETWEEN 0 AND 100),
  score_roof                INTEGER     CHECK (score_roof BETWEEN 0 AND 100),
  score_solar               INTEGER     CHECK (score_solar BETWEEN 0 AND 100),
  score_homeowner           INTEGER     CHECK (score_homeowner BETWEEN 0 AND 100),
  score_complexity          INTEGER     CHECK (score_complexity BETWEEN 0 AND 100),

  -- ── Screening ──────────────────────────────────────────────────────────────
  -- Automated screening flags
  spam_flag                 BOOLEAN     NOT NULL DEFAULT FALSE,
  duplicate_flag            BOOLEAN     NOT NULL DEFAULT FALSE,
  invalid_utility_flag      BOOLEAN     NOT NULL DEFAULT FALSE,
  auto_flags                TEXT[]      NOT NULL DEFAULT '{}',

  -- Human screening
  screening_status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (screening_status IN (
                                'pending', 'in_review', 'approved', 'rejected', 'escalated'
                              )),
  screening_notes           TEXT,
  screened_by_admin_id      UUID        REFERENCES users(id) ON DELETE SET NULL,

  -- ── Asking Price / Marketplace ────────────────────────────────────────────
  asking_price              NUMERIC(10,2),
  listing_notes             TEXT,

  -- ── Routing ───────────────────────────────────────────────────────────────
  -- When routed, which contractor was matched (best fit)
  routed_to_user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  routing_score             INTEGER,    -- fit score at time of routing
  routing_notes             TEXT,

  -- ── Timestamps ────────────────────────────────────────────────────────────
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Live feed: show scoreable/live opportunities by state
CREATE INDEX IF NOT EXISTS idx_net_opps_status_state
  ON network_opportunities (status, location_state)
  WHERE status IN ('live', 'scored', 'routed');

-- Screening queue feed
CREATE INDEX IF NOT EXISTS idx_net_opps_screening
  ON network_opportunities (screening_status, intake_at DESC)
  WHERE screening_status IN ('pending', 'in_review', 'escalated');

-- Score-based sorting for contractor matching
CREATE INDEX IF NOT EXISTS idx_net_opps_score
  ON network_opportunities (opportunity_score DESC, status)
  WHERE status = 'live';

-- Source attribution analytics
CREATE INDEX IF NOT EXISTS idx_net_opps_source
  ON network_opportunities (source_type, created_at DESC);

-- Project link
CREATE INDEX IF NOT EXISTS idx_net_opps_project
  ON network_opportunities (project_id)
  WHERE project_id IS NOT NULL;

-- Source opp link (contractor_shared promotion)
CREATE INDEX IF NOT EXISTS idx_net_opps_source_opp
  ON network_opportunities (source_opportunity_id)
  WHERE source_opportunity_id IS NOT NULL;

-- Expiry sweep
CREATE INDEX IF NOT EXISTS idx_net_opps_expiry
  ON network_opportunities (expires_at)
  WHERE status = 'live';

COMMENT ON TABLE network_opportunities IS
  'Canonical enriched Opportunity object for the SolarPro Network Intelligence OS. '
  'Every opportunity is ingested, screened, scored, and routed before reaching contractors. '
  'Source-agnostic: contractor_shared, homeowner_direct, google_ads, facebook_ads, seo, referral, partner.';
