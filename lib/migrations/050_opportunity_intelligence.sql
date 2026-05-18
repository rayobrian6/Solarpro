-- ============================================================
-- Migration 050: opportunity_intelligence
--
-- Scoring engine output for each opportunity.
-- Computed by lib/network/opportunityScorer.ts after screening.
--
-- Contains the full breakdown of the opportunity score so
-- admins can understand WHY an opportunity was scored a given way,
-- and contractors can understand what they're buying.
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_intelligence (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id          UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,

  -- ── Overall Score ───────────────────────────────────────────
  overall_score           NUMERIC(5,2) NOT NULL DEFAULT 0,   -- 0-100
  overall_grade           TEXT NOT NULL DEFAULT 'C',         -- A+ | A | B | C | D | F
  score_version           TEXT DEFAULT 'v1.0',               -- scorer version
  scored_at               TIMESTAMPTZ DEFAULT NOW(),
  scored_by               TEXT DEFAULT 'auto',               -- auto | admin_user_id

  -- ── Score Breakdown (5 dimensions) ─────────────────────────
  -- Each dimension: 0-100, weighted into overall score

  -- Dimension 1: Property Quality (weight: 25%)
  property_score          NUMERIC(5,2),
  property_weight         NUMERIC(4,3) DEFAULT 0.25,
  property_factors        JSONB DEFAULT '{}',
  -- {
  --   home_value: 85,        home_value_raw: 485000
  --   roof_age: 70,          roof_age_years: 8
  --   structure_type: 90,    structure_type_raw: "single_family"
  --   usable_roof: 80,       usable_roof_pct: 0.72
  --   stories: 85,           stories_raw: 1
  -- }

  -- Dimension 2: Solar Opportunity (weight: 25%)
  solar_score             NUMERIC(5,2),
  solar_weight            NUMERIC(4,3) DEFAULT 0.25,
  solar_factors           JSONB DEFAULT '{}',
  -- {
  --   irradiance: 88,        peak_sun_hours: 5.4
  --   system_size: 75,       est_size_kw: 8.2
  --   offset_potential: 90,  est_offset_pct: 0.95
  --   bill_size: 85,         monthly_bill: 280
  --   payback: 80,           est_payback_years: 7.2
  -- }

  -- Dimension 3: Financial Fit (weight: 20%)
  financial_score         NUMERIC(5,2),
  financial_weight        NUMERIC(4,3) DEFAULT 0.20,
  financial_factors       JSONB DEFAULT '{}',
  -- {
  --   credit_tier: 90,       credit_tier_raw: "excellent"
  --   home_equity: 80,       equity_pct: 0.62
  --   income_proxy: 75,      median_income: 92000
  --   finance_eligible: 95,  eligible: true
  --   incentive_eligible: 90
  -- }

  -- Dimension 4: Market Opportunity (weight: 15%)
  market_score            NUMERIC(5,2),
  market_weight           NUMERIC(4,3) DEFAULT 0.15,
  market_factors          JSONB DEFAULT '{}',
  -- {
  --   utility_rates: 85,     avg_rate_kwh: 0.18
  --   net_metering: 95,      nem_type: "NEM 2.0"
  --   state_incentives: 90,
  --   competition: 70,       contractors_in_area: 4
  --   market_maturity: 75
  -- }

  -- Dimension 5: Lead Intent (weight: 15%)
  intent_score            NUMERIC(5,2),
  intent_weight           NUMERIC(4,3) DEFAULT 0.15,
  intent_factors          JSONB DEFAULT '{}',
  -- {
  --   form_completeness: 90,
  --   response_speed: 85,    minutes_to_submit: 8
  --   keyword_signals: 80,   signals: ["reduce bill", "quote"]
  --   source_quality: 75,    source: "google_ads"
  --   time_of_day: 70
  -- }

  -- ── Grade Thresholds (stored for reference) ─────────────────
  grade_a_plus_threshold  NUMERIC(5,2) DEFAULT 90,
  grade_a_threshold       NUMERIC(5,2) DEFAULT 80,
  grade_b_threshold       NUMERIC(5,2) DEFAULT 65,
  grade_c_threshold       NUMERIC(5,2) DEFAULT 50,

  -- ── Competitive Intelligence ────────────────────────────────
  market_price            NUMERIC(10,2),   -- recommended listing price
  price_min               NUMERIC(10,2),   -- floor price
  price_max               NUMERIC(10,2),   -- ceiling price
  pricing_rationale       TEXT,
  comparable_leads        JSONB DEFAULT '[]',  -- recent similar leads + prices

  -- ── Contractor Match Summary ────────────────────────────────
  total_eligible_contractors   INTEGER DEFAULT 0,
  top_match_contractor_id      UUID,
  top_match_score              NUMERIC(5,2),
  match_summary                JSONB DEFAULT '[]',  -- [{contractor_id, score, factors}]

  -- ── Risk Flags ──────────────────────────────────────────────
  risk_flags              TEXT[],   -- list of risk factors
  -- potential values:
  -- shading_concern | old_roof | hoa_restriction | small_system
  -- low_credit_proxy | high_competition | low_nem | temp_renter_risk

  opportunity_highlights  TEXT[],   -- positive selling points
  -- potential values:
  -- high_bill | excellent_irradiance | new_roof | large_system
  -- excellent_credit | strong_nem | low_competition | high_equity

  -- ── Insight Text (for display) ──────────────────────────────
  executive_summary       TEXT,     -- 2-3 sentence summary for contractors
  contractor_pitch        TEXT,     -- why this is a good opportunity
  admin_notes             TEXT,     -- internal notes

  -- ── Score History ───────────────────────────────────────────
  score_history           JSONB DEFAULT '[]',
  -- [{score, grade, scored_at, scored_by, reason}]

  -- ── Timestamps ──────────────────────────────────────────────
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_intelligence_opp_id  ON opportunity_intelligence(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_intelligence_score          ON opportunity_intelligence(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_opp_intelligence_grade          ON opportunity_intelligence(overall_grade);
CREATE INDEX IF NOT EXISTS idx_opp_intelligence_scored_at      ON opportunity_intelligence(scored_at DESC);
