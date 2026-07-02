-- ============================================================================
-- Migration 095: EagleView roof measurement orders
-- ============================================================================
-- Tracks EagleView Measurement Orders (the pay-per-report roof geometry source)
-- through their async lifecycle: an order is placed for an address, EagleView
-- builds the report (minutes–hours), then we retrieve + parse it into roof
-- facets. This table is the durable record so the result can be picked up by a
-- webhook or poller and later fed to the 3D engine / planset.
--
-- ADDITIVE + SAFE: brand-new table, no foreign keys, no changes to any existing
-- table. project_id/survey_id are nullable soft links (no FK) so this can never
-- break the projects/surveys schema. Idempotent (CREATE ... IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS eagleview_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id    BIGINT UNIQUE NOT NULL,           -- EagleView report id
  order_id     BIGINT,                            -- EagleView order id
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | complete | failed
  env          TEXT,                              -- sandbox | production
  project_id   UUID,                              -- soft link (no FK)
  survey_id    UUID,                              -- soft link (no FK)
  address      TEXT,
  city         TEXT,
  state        TEXT,
  zip          TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  facet_count  INTEGER,
  facets       JSONB,                             -- parsed RoofFacet[] once complete
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_eagleview_orders_status  ON eagleview_orders (status);
CREATE INDEX IF NOT EXISTS idx_eagleview_orders_project ON eagleview_orders (project_id);
