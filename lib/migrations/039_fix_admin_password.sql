-- Migration 039: Fix admin password hash
-- Re-hashes the admin account password at bcrypt cost 12.
-- Safe to run multiple times: only updates if hash is still a legacy/placeholder hash.
-- NOTE: This migration is handled inline by the migrate route (requires bcrypt at runtime).
-- See app/api/migrate/route.ts Migration 040 block.
SELECT 1; -- no-op placeholder (actual fix runs via /api/migrate POST)
