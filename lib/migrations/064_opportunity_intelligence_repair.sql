-- Migration 064: opportunity_intelligence repair / canonical harmonization
--
-- Purpose:
--   Repair shared DBs where opportunity_intelligence exists with older or
--   incompatible column types. The simulator/scoring pipeline writes admin IDs
--   to scored_by, and canonical schema defines scored_by as TEXT.
--
-- System Tools compatible: plain semicolon-delimited SQL only.

CREATE TABLE IF NOT EXISTS opportunity_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
  overall_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  overall_grade TEXT NOT NULL DEFAULT 'C',
  score_version TEXT DEFAULT 'v1.0',
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  scored_by TEXT DEFAULT 'auto',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS score_version TEXT DEFAULT 'v1.0';
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS scored_by TEXT;
ALTER TABLE opportunity_intelligence ALTER COLUMN scored_by DROP DEFAULT;
ALTER TABLE opportunity_intelligence ALTER COLUMN scored_by TYPE TEXT USING scored_by::TEXT;
ALTER TABLE opportunity_intelligence ALTER COLUMN scored_by SET DEFAULT 'auto';

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS property_score NUMERIC(5,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS property_weight NUMERIC(4,3) DEFAULT 0.25;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS property_factors JSONB DEFAULT '{}';

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS solar_score NUMERIC(5,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS solar_weight NUMERIC(4,3) DEFAULT 0.25;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS solar_factors JSONB DEFAULT '{}';

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS financial_score NUMERIC(5,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS financial_weight NUMERIC(4,3) DEFAULT 0.20;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS financial_factors JSONB DEFAULT '{}';

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS market_score NUMERIC(5,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS market_weight NUMERIC(4,3) DEFAULT 0.15;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS market_factors JSONB DEFAULT '{}';

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS intent_score NUMERIC(5,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS intent_weight NUMERIC(4,3) DEFAULT 0.15;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS intent_factors JSONB DEFAULT '{}';

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS market_price NUMERIC(10,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS price_min NUMERIC(10,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS price_max NUMERIC(10,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS pricing_rationale TEXT;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS comparable_leads JSONB DEFAULT '[]';

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS total_eligible_contractors INTEGER DEFAULT 0;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS top_match_contractor_id UUID;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS top_match_score NUMERIC(5,2);
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS match_summary JSONB DEFAULT '[]';

ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS risk_flags TEXT[];
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS opportunity_highlights TEXT[];
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS executive_summary TEXT;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS contractor_pitch TEXT;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS score_history JSONB DEFAULT '[]';
ALTER TABLE opportunity_intelligence ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_intelligence_opp_id ON opportunity_intelligence(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_intelligence_score ON opportunity_intelligence(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_opp_intelligence_grade ON opportunity_intelligence(overall_grade);
CREATE INDEX IF NOT EXISTS idx_opp_intelligence_scored_at ON opportunity_intelligence(scored_at DESC);
