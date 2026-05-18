-- ============================================================
-- Migration 045: opportunities
--
-- The unified Opportunity object — the core of the SolarPro
-- Opportunity Network.
--
-- Source types:
--   contractor_shared  — a contractor shares a project they can't service
--   solarpro_generated — homeowner intake via SolarPro (Phase 2+)
--
-- The object is identical regardless of source. Only the source
-- column differs. This is by design — the architecture supports
-- both from day one.
--
-- Intelligence fields are derived from the linked project at
-- creation time and snapshotted here so they survive project edits.
--
-- Safe to re-run (IF NOT EXISTS guards).
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunities (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Origin ────────────────────────────────────────────────────────────────
  -- Who created / owns this opportunity
  created_by_user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Linked project (nullable for Phase 2 homeowner intake before project exists)
  project_id            UUID        REFERENCES projects(id) ON DELETE SET NULL,

  -- Source type — architecture supports both from day one
  source                TEXT        NOT NULL DEFAULT 'contractor_shared'
                          CHECK (source IN ('contractor_shared', 'solarpro_generated')),

  -- ── Status ────────────────────────────────────────────────────────────────
  -- open       → visible in discovery feed, claimable
  -- claimed    → exclusively claimed by one contractor
  -- closed     → deal closed (install underway or complete)
  -- expired    → listing expired without claim
  -- withdrawn  → creator pulled it back
  status                TEXT        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'claimed', 'closed', 'expired', 'withdrawn')),

  -- ── Homeowner / site info (snapshotted from project) ─────────────────────
  site_name             TEXT,                     -- project name / site nickname
  address               TEXT,                     -- full address (shown after claim)
  city                  TEXT,
  state_code            CHAR(2),
  zip                   TEXT,
  lat                   NUMERIC(9,6),
  lng                   NUMERIC(9,6),

  -- ── System intelligence (snapshotted at creation) ─────────────────────────
  system_size_kw        NUMERIC(6,2),
  annual_kwh            NUMERIC(10,2),
  monthly_kwh_avg       NUMERIC(8,2),
  utility_name          TEXT,
  utility_rate_per_kwh  NUMERIC(6,4),
  estimated_system_cost NUMERIC(12,2),
  estimated_payback_yrs NUMERIC(5,2),

  -- ── Roof intelligence ─────────────────────────────────────────────────────
  roof_material         TEXT,
  roof_pitch            TEXT,
  roof_condition        TEXT,
  roof_age_years        INTEGER,
  stories               TEXT,
  structure_type        TEXT,
  usable_roof_pct       NUMERIC(5,2),

  -- ── Fit tags (for matching) ────────────────────────────────────────────────
  -- Set at creation based on project analysis
  battery_candidate     BOOLEAN     NOT NULL DEFAULT FALSE,
  steep_roof            BOOLEAN     NOT NULL DEFAULT FALSE,   -- pitch >= 6:12
  complex_ahj           BOOLEAN     NOT NULL DEFAULT FALSE,
  ahj_name              TEXT,
  equipment_ecosystem   TEXT,        -- primary inverter/battery brand

  -- ── Listing details ───────────────────────────────────────────────────────
  asking_price          NUMERIC(10,2),            -- NULL = make offer / platform sets price
  listing_notes         TEXT,                     -- creator's notes (pre-claim, visible to all)

  -- Expiry — auto-expire open listings after N days
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  -- ── Metadata ──────────────────────────────────────────────────────────────
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Discovery feed: open opportunities by state, sorted newest first
CREATE INDEX IF NOT EXISTS idx_opportunities_open_state
  ON opportunities (state_code, created_at DESC)
  WHERE status = 'open';

-- My shared opportunities
CREATE INDEX IF NOT EXISTS idx_opportunities_creator
  ON opportunities (created_by_user_id, created_at DESC);

-- Linked project lookup
CREATE INDEX IF NOT EXISTS idx_opportunities_project
  ON opportunities (project_id)
  WHERE project_id IS NOT NULL;

-- Expiry scan (cron job)
CREATE INDEX IF NOT EXISTS idx_opportunities_expires
  ON opportunities (expires_at)
  WHERE status = 'open';

COMMENT ON TABLE opportunities IS
  'Unified solar opportunity profile — source-agnostic. contractor_shared (Phase 1) or solarpro_generated (Phase 2+). Same object, same matching logic, same claim flow regardless of source.';
