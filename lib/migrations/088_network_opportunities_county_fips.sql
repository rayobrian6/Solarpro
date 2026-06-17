-- ============================================================================
-- Migration 088: Add county_fips column to network_opportunities
-- ============================================================================
-- Stores the 5-digit US county FIPS code for each marketplace lead, derived
-- from the lead's ZIP. Powers the Territory Intelligence county rollups and the
-- gated county lead view via fast SQL GROUP BY / WHERE instead of per-row work
-- in the application — the path to scaling territory aggregation to 100k leads.
--
-- The column is NULLable and backfilled lazily by the territory endpoint
-- (it maps location_zip -> county_fips from the bundled ZIP crosswalk and
-- persists it the first time a state's territory is viewed). New leads fill in
-- the same way, so no SQL backfill is needed here.
--
-- The composite index matches the territory query's access pattern: filter by
-- state, then group/scan by county.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- No destructive operations.
-- ============================================================================

ALTER TABLE network_opportunities
  ADD COLUMN IF NOT EXISTS county_fips TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_network_opportunities_state_county
  ON network_opportunities (location_state, county_fips);
