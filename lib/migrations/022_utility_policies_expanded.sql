-- Migration 022: Expanded utility policies (133 utilities seeded)
-- Adds extra rate columns and seeds comprehensive utility rate data
ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS retail_rate NUMERIC(10,6);
ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS supply_rate NUMERIC(10,6);
ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS distribution_rate NUMERIC(10,6);
ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS transmission_rate NUMERIC(10,6);
ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS fixed_monthly_charge NUMERIC(10,2);
ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS net_metering_type TEXT;
ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;
ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS rate_source TEXT;
