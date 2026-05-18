-- Migration 042: utility_policies unique constraint
-- ---------------------------------------------------------------------------
-- Add UNIQUE(utility_name, state) to utility_policies so the seed function
-- can use INSERT … ON CONFLICT (utility_name, state) DO UPDATE SET … in a
-- single bulk query instead of an UPDATE-then-INSERT loop (~240 serial DB
-- queries reduced to 1 batched round-trip).
--
-- The constraint is added with a deduplication step: if there are existing
-- duplicate (utility_name, state) pairs, keep the row with the highest id
-- (most recently inserted) and delete the rest.
--
-- NOTE: Originally used a PL/pgSQL DO block for the idempotent constraint
-- check. Replaced with ALTER TABLE … ADD CONSTRAINT IF NOT EXISTS
-- (Postgres 9.1+, fully supported by Neon serverless) because the Neon HTTP
-- driver does not support dollar-quoted strings.
--
-- Note: site_aliases is already handled by migration 018_site_aliases.sql.
-- ---------------------------------------------------------------------------

-- Step 1: Remove duplicate (utility_name, state) rows, keeping latest id
DELETE FROM utility_policies a
USING utility_policies b
WHERE a.id < b.id
  AND LOWER(TRIM(a.utility_name)) = LOWER(TRIM(b.utility_name))
  AND a.state = b.state;

-- Step 2: Add the unique constraint (idempotent — IF NOT EXISTS skips if already present)
ALTER TABLE utility_policies
  ADD CONSTRAINT IF NOT EXISTS utility_policies_utility_name_state_key
  UNIQUE (utility_name, state);
