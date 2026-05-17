-- Migration 042: utility_policies unique constraint
-- ─────────────────────────────────────────────────────────────────────────────
-- Add UNIQUE(utility_name, state) to utility_policies so the seed function
-- can use INSERT … ON CONFLICT (utility_name, state) DO UPDATE SET … in a
-- single bulk query instead of an UPDATE-then-INSERT loop (~240 serial DB
-- queries reduced to 1 batched round-trip).
--
-- The constraint is added with a deduplication step: if there are existing
-- duplicate (utility_name, state) pairs, keep the row with the highest id
-- (most recently inserted) and delete the rest.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Remove duplicate (utility_name, state) rows, keeping latest id
DELETE FROM utility_policies a
USING utility_policies b
WHERE a.id < b.id
  AND LOWER(TRIM(a.utility_name)) = LOWER(TRIM(b.utility_name))
  AND a.state = b.state;

-- Step 2: Add the unique constraint (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'utility_policies_utility_name_state_key'
      AND conrelid = 'utility_policies'::regclass
  ) THEN
    ALTER TABLE utility_policies
      ADD CONSTRAINT utility_policies_utility_name_state_key
      UNIQUE (utility_name, state);
  END IF;
END $$;

-- Note: site_aliases is already handled by migration 018_site_aliases.sql.
