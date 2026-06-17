-- Migration 092: installer_prospects
--
-- The SUPPLY side of the marketplace. Everything above this point (network_
-- opportunities, territory pages, Stripe pay-to-claim) is the DEMAND side —
-- homeowner leads ready to be sold. But a marketplace with no buyers sells
-- nothing. This table is the prospect pool: solar installers OUT IN THE WORLD
-- who have not signed up yet. The acquisition robots discover + enrich them
-- here; the admin "floor" works them through a pipeline until they convert into
-- a real `users` row (plan='contractor') that can buy leads.
--
-- Distinct from `contractor_profiles` (migration 044), which is capability
-- intelligence for contractors who have ALREADY signed up. A prospect graduates
-- OUT of this table when it becomes a user.
--
-- Idempotent, no DO blocks (Admin -> System Tools migration runner).

CREATE TABLE IF NOT EXISTS installer_prospects (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Identity ──────────────────────────────────────────────────────────────
  company_name       TEXT        NOT NULL,
  -- Normalized "name|STATE" (or domain) — the upsert key so re-running the
  -- robots never duplicates a company. Computed in lib/network/installerProspects.ts.
  dedupe_key         TEXT        NOT NULL UNIQUE,

  -- ── Contact ───────────────────────────────────────────────────────────────
  contact_name       TEXT,
  email              TEXT,
  phone              TEXT,
  website            TEXT,

  -- ── Location ──────────────────────────────────────────────────────────────
  address            TEXT,
  city               TEXT,
  state              TEXT,                                  -- 2-letter
  zip                TEXT,
  service_states     TEXT[]      NOT NULL DEFAULT '{}',

  -- ── Vetting signals ───────────────────────────────────────────────────────
  license_number     TEXT,
  license_status     TEXT,                                  -- active | expired | unknown
  rating             NUMERIC(2,1),                          -- e.g. 4.7
  review_count       INTEGER,
  employee_estimate  TEXT,                                  -- e.g. '1-10', '11-50'

  -- ── Provenance ────────────────────────────────────────────────────────────
  -- google_places | nabcep | state_license | seia | yelp | agent_research
  source             TEXT        NOT NULL DEFAULT 'agent_research',
  source_url         TEXT,

  -- ── Pipeline ──────────────────────────────────────────────────────────────
  -- discovered -> enriched -> qualified -> contacted -> signed_up | rejected
  stage              TEXT        NOT NULL DEFAULT 'discovered',
  quality_score      INTEGER,                               -- 0-100, derived on ingest
  notes              TEXT,
  metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- ── Timestamps ────────────────────────────────────────────────────────────
  discovered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted_at       TIMESTAMPTZ,
  converted_user_id  UUID,                                  -- set when they become a user
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Filter the floor by territory
CREATE INDEX IF NOT EXISTS idx_installer_prospects_state ON installer_prospects (state);
-- Pipeline board columns
CREATE INDEX IF NOT EXISTS idx_installer_prospects_stage ON installer_prospects (stage);
-- Newest discoveries first
CREATE INDEX IF NOT EXISTS idx_installer_prospects_discovered ON installer_prospects (discovered_at DESC);

COMMENT ON TABLE installer_prospects IS
  'Supply-side prospect pool — solar installers discovered/enriched by the acquisition robots, worked through a pipeline until they sign up as contractor users.';
