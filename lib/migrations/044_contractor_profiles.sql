-- ============================================================
-- Migration 044: contractor_profiles
--
-- Stores capability intelligence for each SolarPro contractor.
-- Powers intelligent opportunity matching — not just zip-code routing.
--
-- Phase 1: manually configured by contractor
-- Phase 2+: auto-enriched from real project history / install outcomes
--
-- Safe to re-run (IF NOT EXISTS guards).
-- ============================================================

CREATE TABLE IF NOT EXISTS contractor_profiles (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- ── Capability tags (phase 1: self-reported) ─────────────────────────────
  battery_certified     BOOLEAN     NOT NULL DEFAULT FALSE,
  commercial_capable    BOOLEAN     NOT NULL DEFAULT FALSE,
  roofing_capable       BOOLEAN     NOT NULL DEFAULT FALSE,
  steep_roof_capable    BOOLEAN     NOT NULL DEFAULT FALSE,
  ev_charger_capable    BOOLEAN     NOT NULL DEFAULT FALSE,
  generator_capable     BOOLEAN     NOT NULL DEFAULT FALSE,

  -- ── Service territory ────────────────────────────────────────────────────
  -- Array of 2-letter state codes: ['CA','NV','AZ']
  service_states        TEXT[]      NOT NULL DEFAULT '{}',

  -- Array of ZIP codes for fine-grained territory
  service_zips          TEXT[]      NOT NULL DEFAULT '{}',

  -- Travel radius in miles from company address (0 = ZIP/state only)
  travel_radius_miles   INTEGER     NOT NULL DEFAULT 50,

  -- ── Equipment ecosystems ──────────────────────────────────────────────────
  -- Known values: 'enphase' | 'solaredge' | 'tesla' | 'franklin' | 'sungrow'
  --               | 'goodwe' | 'generac' | 'sol-ark' | 'ecoflow' | 'other'
  equipment_ecosystems  TEXT[]      NOT NULL DEFAULT '{}',

  -- ── Project size preference ───────────────────────────────────────────────
  min_project_kw        NUMERIC(6,2),
  max_project_kw        NUMERIC(6,2),

  -- ── Phase 2 fields (auto-enriched from history) ───────────────────────────
  -- Populated automatically as projects close — do not write manually in phase 1
  total_installs        INTEGER     NOT NULL DEFAULT 0,
  avg_close_rate_pct    NUMERIC(5,2),            -- closed / claimed * 100
  avg_response_hours    NUMERIC(6,2),            -- avg hours from claim to first contact
  inspection_pass_rate  NUMERIC(5,2),            -- passed / total inspections * 100
  known_ahjs            TEXT[]      NOT NULL DEFAULT '{}',   -- AHJ names they've worked in
  known_utilities       TEXT[]      NOT NULL DEFAULT '{}',   -- utility names they've worked with

  -- ── Metadata ──────────────────────────────────────────────────────────────
  profile_complete      BOOLEAN     NOT NULL DEFAULT FALSE,  -- set true when states + 1 capability set
  network_active        BOOLEAN     NOT NULL DEFAULT TRUE,   -- can be toggled to pause receiving opps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by user
CREATE INDEX IF NOT EXISTS idx_contractor_profiles_user
  ON contractor_profiles (user_id);

-- Filter active profiles in matching queries
CREATE INDEX IF NOT EXISTS idx_contractor_profiles_active
  ON contractor_profiles (network_active)
  WHERE network_active = TRUE;

COMMENT ON TABLE contractor_profiles IS
  'Contractor capability intelligence — powers opportunity matching. Phase 1: self-reported. Phase 2+: auto-enriched from project history.';
