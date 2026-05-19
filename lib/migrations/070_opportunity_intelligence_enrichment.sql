-- Migration 070: opportunity_intelligence enrichment projection
--
-- Adds canonical structured enrichment payloads to opportunity_intelligence.
-- This is intentionally an additive projection on the existing canonical
-- intelligence table, not a duplicate scoring/intelligence table.

ALTER TABLE opportunity_intelligence
  ADD COLUMN IF NOT EXISTS enrichment_version TEXT DEFAULT 'opportunity-enrichment.v1',
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_payload JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enrichment_completeness NUMERIC(5,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrichment_warnings JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_opp_intelligence_enriched_at
  ON opportunity_intelligence(enriched_at DESC);

CREATE INDEX IF NOT EXISTS idx_opp_intelligence_enrichment_completeness
  ON opportunity_intelligence(enrichment_completeness DESC);

COMMENT ON COLUMN opportunity_intelligence.enrichment_payload IS
  'Structured canonical opportunity enrichment projection with values, confidence, factors, notes, warnings, and missing-data metadata. Not a duplicate scoring system.';
