-- 121_app_feature_flags.sql
-- Runtime feature-flag store. DB-row overrides the env-var default at deploy
-- time. super_admin-only flip via /admin/system-tools → Feature Flags section,
-- surfaced in the API as GET /api/admin/feature-flags and PUT same.
--
-- Why this exists: the layout's SOLARDOG_ENABLED env var is the deploy default,
-- but admins need to flip a flag at runtime without redeploying. This table is
-- the override layer. Resolution order: DB row if present → env var → off.
--
-- Idempotent plain DDL (CREATE TABLE / CREATE INDEX IF NOT EXISTS only). No DO
-- blocks, no ALTER, no data migration — per the System Tools migration runner.

CREATE TABLE IF NOT EXISTS app_feature_flags (
  id                    TEXT PRIMARY KEY,            -- slug: e.g. 'solardog_enabled'

  -- ── IDENTITY ─────────────────────────────────────────────────────────────
  flag_key              TEXT NOT NULL UNIQUE,        -- e.g. 'solardog_enabled'
  description           TEXT NOT NULL DEFAULT '',   -- shown in admin UI

  -- ── STATE ────────────────────────────────────────────────────────────────
  enabled               BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── AUDIT TRAIL ──────────────────────────────────────────────────────────
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id    TEXT,                        -- FK to users.id (informational, not enforced)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot-path index — the layout reads this on every page render.
CREATE INDEX IF NOT EXISTS idx_app_feature_flags_key ON app_feature_flags (flag_key);
