-- ============================================================
-- Migration 049: opportunity_screening_queue
--
-- The 10-step automated screening pipeline.
-- Each row tracks one opportunity through all screening steps.
--
-- Steps (run in order, can be skipped/failed individually):
--   1. contact_validation     — phone/email format + disposable check
--   2. duplicate_check        — fuzzy match against existing leads
--   3. address_validation     — USPS/geocoding verification
--   4. service_area_check     — is address in a served territory?
--   5. utility_lookup         — identify utility company
--   6. solar_viability        — basic feasibility (lat/lon irradiance)
--   7. homeowner_verification — verify actual homeownership
--   8. credit_proxy           — proxy credit tier from zip median income
--   9. intent_scoring         — NLP on form text / engagement signals
--  10. final_decision         — pass/fail/needs_review determination
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_screening_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,

  -- ── Overall Pipeline State ──────────────────────────────────
  pipeline_status       TEXT NOT NULL DEFAULT 'pending',
  -- pending | running | completed | failed | skipped | manual_review

  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  duration_ms           INTEGER,     -- total pipeline duration

  auto_decision         TEXT,        -- pass | fail | needs_review
  auto_decision_reason  TEXT,        -- human-readable summary
  confidence_score      NUMERIC(5,2), -- 0-100 confidence in decision
  override_decision     TEXT,         -- admin override: pass | fail | hold
  override_by           UUID,         -- admin user who overrode
  override_reason       TEXT,
  override_at           TIMESTAMPTZ,

  -- ── Step 1: Contact Validation ──────────────────────────────
  step1_status          TEXT DEFAULT 'pending',
  step1_phone_valid     BOOLEAN,
  step1_email_valid     BOOLEAN,
  step1_phone_type      TEXT,        -- mobile | landline | voip | unknown
  step1_email_risk      TEXT,        -- low | medium | high | disposable
  step1_data            JSONB DEFAULT '{}',
  step1_completed_at    TIMESTAMPTZ,
  step1_error           TEXT,

  -- ── Step 2: Duplicate Check ─────────────────────────────────
  step2_status          TEXT DEFAULT 'pending',
  step2_is_duplicate    BOOLEAN,
  step2_duplicate_of    UUID,
  step2_match_score     NUMERIC(5,2), -- 0-100 similarity score
  step2_match_fields    TEXT[],       -- which fields matched
  step2_data            JSONB DEFAULT '{}',
  step2_completed_at    TIMESTAMPTZ,
  step2_error           TEXT,

  -- ── Step 3: Address Validation ──────────────────────────────
  step3_status          TEXT DEFAULT 'pending',
  step3_address_valid   BOOLEAN,
  step3_formatted_address TEXT,
  step3_lat             NUMERIC(10,7),
  step3_lng             NUMERIC(10,7),
  step3_county          TEXT,
  step3_fips            TEXT,        -- county FIPS code
  step3_census_tract    TEXT,
  step3_data            JSONB DEFAULT '{}',
  step3_completed_at    TIMESTAMPTZ,
  step3_error           TEXT,

  -- ── Step 4: Service Area Check ──────────────────────────────
  step4_status          TEXT DEFAULT 'pending',
  step4_in_service_area BOOLEAN,
  step4_matched_state   TEXT,
  step4_matched_market  TEXT,        -- MSA / metro area
  step4_nearest_contractor_mi NUMERIC(6,2),
  step4_active_contractors_nearby INTEGER,
  step4_data            JSONB DEFAULT '{}',
  step4_completed_at    TIMESTAMPTZ,
  step4_error           TEXT,

  -- ── Step 5: Utility Lookup ──────────────────────────────────
  step5_status          TEXT DEFAULT 'pending',
  step5_utility_name    TEXT,
  step5_utility_eia_id  TEXT,        -- EIA utility ID
  step5_rate_class      TEXT,        -- residential rate class
  step5_avg_rate_kwh    NUMERIC(6,4), -- average $/kWh
  step5_net_metering    BOOLEAN,
  step5_nem_type        TEXT,        -- NEM 2.0 | NEM 3.0 | VNEM | AVOIDED_COST
  step5_data            JSONB DEFAULT '{}',
  step5_completed_at    TIMESTAMPTZ,
  step5_error           TEXT,

  -- ── Step 6: Solar Viability ─────────────────────────────────
  step6_status          TEXT DEFAULT 'pending',
  step6_viable          BOOLEAN,
  step6_annual_kwh_m2   NUMERIC(8,2), -- kWh/m²/year (irradiance)
  step6_peak_sun_hours  NUMERIC(5,2),
  step6_shade_class     TEXT,         -- excellent | good | fair | poor
  step6_estimated_system_size_kw NUMERIC(6,2),
  step6_data            JSONB DEFAULT '{}',
  step6_completed_at    TIMESTAMPTZ,
  step6_error           TEXT,

  -- ── Step 7: Homeowner Verification ──────────────────────────
  step7_status          TEXT DEFAULT 'pending',
  step7_is_owner        BOOLEAN,
  step7_owner_name      TEXT,
  step7_owner_match     NUMERIC(5,2), -- 0-100 name match confidence
  step7_year_purchased  INTEGER,
  step7_assessed_value  NUMERIC(12,2),
  step7_data            JSONB DEFAULT '{}',
  step7_completed_at    TIMESTAMPTZ,
  step7_error           TEXT,

  -- ── Step 8: Credit Proxy ────────────────────────────────────
  step8_status          TEXT DEFAULT 'pending',
  step8_credit_tier     TEXT,         -- excellent | good | fair | poor
  step8_median_income   NUMERIC(10,2),
  step8_home_value      NUMERIC(12,2),
  step8_debt_proxy      TEXT,         -- low | medium | high
  step8_finance_eligible BOOLEAN,
  step8_data            JSONB DEFAULT '{}',
  step8_completed_at    TIMESTAMPTZ,
  step8_error           TEXT,

  -- ── Step 9: Intent Scoring ──────────────────────────────────
  step9_status          TEXT DEFAULT 'pending',
  step9_intent_score    NUMERIC(5,2), -- 0-100
  step9_intent_tier     TEXT,         -- hot | warm | cold
  step9_signals         TEXT[],       -- positive signals detected
  step9_red_flags       TEXT[],       -- negative signals
  step9_form_quality    TEXT,         -- complete | partial | sparse
  step9_data            JSONB DEFAULT '{}',
  step9_completed_at    TIMESTAMPTZ,
  step9_error           TEXT,

  -- ── Step 10: Final Decision ─────────────────────────────────
  step10_status         TEXT DEFAULT 'pending',
  step10_decision       TEXT,         -- pass | fail | needs_review
  step10_score          NUMERIC(5,2), -- composite 0-100
  step10_grade          TEXT,         -- A+ | A | B | C | F
  step10_fail_reasons   TEXT[],       -- disqualification reasons
  step10_review_flags   TEXT[],       -- flags needing human review
  step10_data           JSONB DEFAULT '{}',
  step10_completed_at   TIMESTAMPTZ,
  step10_error          TEXT,

  -- ── Retry / Error Handling ──────────────────────────────────
  retry_count           INTEGER DEFAULT 0,
  last_retry_at         TIMESTAMPTZ,
  max_retries           INTEGER DEFAULT 3,
  error_log             JSONB DEFAULT '[]',

  -- ── Timestamps ──────────────────────────────────────────────
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_queue_opp_id  ON opportunity_screening_queue(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_screening_pipeline_status       ON opportunity_screening_queue(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_screening_auto_decision         ON opportunity_screening_queue(auto_decision);
CREATE INDEX IF NOT EXISTS idx_screening_created_at            ON opportunity_screening_queue(created_at DESC);
