-- Migration 035: Lead source tracking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_source ON leads (lead_source) WHERE lead_source IS NOT NULL;
