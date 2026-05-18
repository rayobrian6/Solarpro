-- ============================================================
-- Migration 052: campaign_analytics
--
-- Aggregated campaign performance metrics for the Control Center.
-- Tracks CPL, CAC, conversion rates, and ROI by campaign/source.
--
-- This table is updated by a background job as opportunities
-- progress through the pipeline. Used for the Campaign Intelligence
-- section of the admin Control Center.
-- ============================================================

CREATE TABLE IF NOT EXISTS campaign_analytics (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Dimensions ──────────────────────────────────────────────
  period_date             DATE NOT NULL,         -- date of aggregation
  period_type             TEXT NOT NULL DEFAULT 'daily',
  -- daily | weekly | monthly

  source_type             TEXT NOT NULL,
  -- contractor_shared | google_ads | facebook_ads | tiktok | seo | referral | partner | all

  platform                TEXT,
  -- google | meta | tiktok | organic | solarpro | partner | all

  campaign_id             TEXT,                  -- NULL = all campaigns
  campaign_name           TEXT,
  state                   TEXT,                  -- NULL = all states
  market                  TEXT,                  -- MSA / metro area

  -- ── Volume Metrics ──────────────────────────────────────────
  leads_received          INTEGER DEFAULT 0,     -- total leads ingested
  leads_screened          INTEGER DEFAULT 0,     -- entered screening
  leads_passed            INTEGER DEFAULT 0,     -- passed screening
  leads_failed            INTEGER DEFAULT 0,     -- failed screening
  leads_manual_review     INTEGER DEFAULT 0,     -- flagged for review
  leads_duplicate         INTEGER DEFAULT 0,     -- duplicates rejected
  leads_published         INTEGER DEFAULT 0,     -- made live in marketplace

  -- ── Funnel Metrics ──────────────────────────────────────────
  leads_viewed            INTEGER DEFAULT 0,     -- viewed by at least 1 contractor
  leads_claimed           INTEGER DEFAULT 0,     -- claimed by a contractor
  leads_contacted         INTEGER DEFAULT 0,     -- contractor made contact
  leads_appointment       INTEGER DEFAULT 0,     -- appointment set
  leads_proposal          INTEGER DEFAULT 0,     -- proposal delivered
  leads_won               INTEGER DEFAULT 0,     -- closed won
  leads_lost              INTEGER DEFAULT 0,     -- closed lost

  -- ── Conversion Rates (computed) ─────────────────────────────
  screen_pass_rate        NUMERIC(5,4),           -- leads_passed / leads_screened
  publish_rate            NUMERIC(5,4),           -- leads_published / leads_passed
  claim_rate              NUMERIC(5,4),           -- leads_claimed / leads_published
  contact_rate            NUMERIC(5,4),           -- leads_contacted / leads_claimed
  appointment_rate        NUMERIC(5,4),           -- leads_appointment / leads_contacted
  proposal_rate           NUMERIC(5,4),           -- leads_proposal / leads_appointment
  close_rate              NUMERIC(5,4),           -- leads_won / leads_proposal
  overall_conversion      NUMERIC(5,4),           -- leads_won / leads_received

  -- ── Financial Metrics ───────────────────────────────────────
  total_spend             NUMERIC(12,2) DEFAULT 0,  -- ad spend
  total_revenue           NUMERIC(12,2) DEFAULT 0,  -- claim revenue
  total_contract_value    NUMERIC(14,2) DEFAULT 0,  -- sum of won deals

  cost_per_lead           NUMERIC(10,2),           -- total_spend / leads_received
  cost_per_qualified_lead NUMERIC(10,2),           -- total_spend / leads_passed
  cost_per_claim          NUMERIC(10,2),           -- total_spend / leads_claimed
  cost_per_appointment    NUMERIC(10,2),           -- total_spend / leads_appointment
  cost_per_acquisition    NUMERIC(10,2),           -- total_spend / leads_won

  revenue_per_lead        NUMERIC(10,2),           -- total_revenue / leads_received
  revenue_per_claim       NUMERIC(10,2),           -- total_revenue / leads_claimed

  gross_margin            NUMERIC(12,2),           -- total_revenue - total_spend
  roas                    NUMERIC(8,4),            -- return on ad spend
  roi_pct                 NUMERIC(8,4),            -- (margin / spend) * 100

  -- ── Quality Metrics ─────────────────────────────────────────
  avg_opportunity_score   NUMERIC(5,2),           -- avg overall_score of published leads
  avg_grade_distribution  JSONB DEFAULT '{}',      -- {A_plus: 5, A: 12, B: 23, C: 8}
  disputes_filed          INTEGER DEFAULT 0,
  refunds_issued          INTEGER DEFAULT 0,
  refund_rate             NUMERIC(5,4),
  avg_time_to_claim_hours NUMERIC(8,2),
  avg_time_to_close_days  NUMERIC(8,2),

  -- ── Geographic Distribution ─────────────────────────────────
  top_states              JSONB DEFAULT '[]',      -- [{state, count, cpl}]
  top_markets             JSONB DEFAULT '[]',      -- [{market, count, cpl}]

  -- ── Metadata ────────────────────────────────────────────────
  computed_at             TIMESTAMPTZ DEFAULT NOW(),
  is_partial              BOOLEAN DEFAULT false,   -- true if period not yet complete
  notes                   TEXT,

  -- ── Timestamps ──────────────────────────────────────────────
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_period       ON campaign_analytics(period_date DESC, period_type);
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_source       ON campaign_analytics(source_type, platform);
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_campaign     ON campaign_analytics(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_analytics_unique
  ON campaign_analytics(period_date, period_type, source_type, COALESCE(platform,''), COALESCE(campaign_id,''), COALESCE(state,''));
