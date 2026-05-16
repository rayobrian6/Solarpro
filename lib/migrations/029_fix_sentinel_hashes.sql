-- Migration 029: Repair bcrypt-of-sentinel password hashes
-- Users with bcrypt(hash('__SOLARPRO_MUST_RESET__', 4)) are updated to the sentinel string
-- so the login route can detect them and show a reset prompt.
-- This is handled inline by the migrate route (requires bcrypt at runtime).
-- See app/api/migrate/route.ts Migration 030 block.
SELECT 1; -- no-op placeholder
