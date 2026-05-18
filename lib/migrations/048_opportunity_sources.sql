-- ============================================================
-- Migration 048: opportunity_sources
--
-- Attribution and acquisition tracking for every opportunity.
-- Answers: Where did this lead come from? What did it cost?
-- How did it progress through the funnel?
--
-- One row per opportunity. Links to network_opportunities (047).
-- Created at intake time, updated as the opportunity progresses.
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,

  -- ── Source Classification ───────────────────────────────────
  source_type           TEXT NOT NULL,
  -- contractor_shared | homeowner_direct | google_ads | facebook_ads
  -- tiktok | seo | referral | partner | cold_outreach | event

  source_channel        TEXT,
  -- paid_search | paid_social | organic_search | direct | referral | partner

  source_campaign_id    TEXT,       -- our internal campaign ID
  source_campaign_name  TEXT,       -- human-readable campaign name
  source_ad_set_id      TEXT,       -- ad set / ad group ID
  source_ad_id          TEXT,       -- specific ad ID

  -- ── UTM Parameters (raw from intake) ───────────────────────
  utm_source            TEXT,
  utm_medium            TEXT,
  utm_campaign          TEXT,
  utm_content           TEXT,
  utm_term              TEXT,

  -- ── Platform Attribution ────────────────────────────────────
  platform              TEXT,
  -- google | meta | tiktok | solarpro | partner | referral | organic

  platform_lead_id      TEXT,       -- platform's own lead identifier
  platform_campaign_id  TEXT,
  platform_ad_set_id    TEXT,
  platform_ad_id        TEXT,
  platform_form_id      TEXT,       -- for lead-gen forms (Meta, TikTok)

  -- ── Click Attribution ───────────────────────────────────────
  gclid                 TEXT,       -- Google Click ID
  fbclid                TEXT,       -- Facebook Click ID
  ttclid                TEXT,       -- TikTok Click ID
  msclkid               TEXT,       -- Microsoft Click ID

  -- ── Cost Attribution ────────────────────────────────────────
  cost_per_lead         NUMERIC(10,2),   -- CPL in USD
  cost_per_click        NUMERIC(10,2),   -- CPC from platform
  attributed_spend      NUMERIC(12,2),   -- total spend attributed to this lead
  currency              TEXT DEFAULT 'USD',

  -- ── Referral Attribution ────────────────────────────────────
  referring_contractor_id UUID,     -- if contractor referral
  referring_user_id     UUID,       -- if user referral
  referral_code         TEXT,       -- promo/referral code used
  referral_payout       NUMERIC(10,2),   -- if we owe a payout

  -- ── Partner Attribution ─────────────────────────────────────
  partner_id            UUID,
  partner_name          TEXT,
  partner_lead_id       TEXT,       -- partner's ID for this lead

  -- ── Landing Page ────────────────────────────────────────────
  landing_page_url      TEXT,
  landing_page_path     TEXT,
  landing_page_variant  TEXT,       -- A/B test variant

  -- ── Session / Device ────────────────────────────────────────
  session_id            TEXT,
  ip_address            INET,
  user_agent            TEXT,
  device_type           TEXT,       -- mobile | tablet | desktop
  browser               TEXT,
  os                    TEXT,
  country               TEXT,
  region                TEXT,
  city                  TEXT,

  -- ── Funnel Tracking ─────────────────────────────────────────
  first_touch_at        TIMESTAMPTZ,
  form_submit_at        TIMESTAMPTZ,
  qualified_at          TIMESTAMPTZ,  -- passed screening
  claimed_at            TIMESTAMPTZ,  -- contractor claimed
  appointment_at        TIMESTAMPTZ,  -- appointment set
  closed_at             TIMESTAMPTZ,  -- deal closed (won or lost)

  -- ── Funnel Outcome ──────────────────────────────────────────
  funnel_stage          TEXT DEFAULT 'lead',
  -- lead | qualified | claimed | appointment | proposal | closed_won | closed_lost

  conversion_value      NUMERIC(12,2),   -- if closed_won: contract value
  gross_margin          NUMERIC(12,2),   -- estimated margin
  revenue_share         NUMERIC(10,2),   -- SolarPro revenue share if any

  -- ── Data Quality ────────────────────────────────────────────
  is_duplicate          BOOLEAN DEFAULT false,
  duplicate_of          UUID,       -- if duplicate, link to original
  duplicate_detected_at TIMESTAMPTZ,
  duplicate_detection   JSONB DEFAULT '{}',  -- {match_fields, confidence_score}

  -- ── Raw Payload ─────────────────────────────────────────────
  raw_payload           JSONB DEFAULT '{}',  -- full webhook/form payload
  processed_at          TIMESTAMPTZ,
  processing_notes      TEXT,

  -- ── Timestamps ──────────────────────────────────────────────
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_opp_sources_opportunity_id  ON opportunity_sources(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_sources_source_type     ON opportunity_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_opp_sources_platform        ON opportunity_sources(platform);
CREATE INDEX IF NOT EXISTS idx_opp_sources_campaign_id     ON opportunity_sources(source_campaign_id);
CREATE INDEX IF NOT EXISTS idx_opp_sources_created_at      ON opportunity_sources(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_sources_platform_lead   ON opportunity_sources(platform_lead_id) WHERE platform_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_sources_gclid           ON opportunity_sources(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_sources_fbclid          ON opportunity_sources(fbclid) WHERE fbclid IS NOT NULL;
