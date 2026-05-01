-- ============================================================
-- SolarPro Platform — Migration 002
-- Add lat/lng coordinates to projects table
-- Run once against Neon DB
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS lat  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng  DOUBLE PRECISION;

-- Index for spatial queries (e.g. find projects near a location)
CREATE INDEX IF NOT EXISTS idx_projects_lat_lng ON projects(lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

COMMENT ON COLUMN projects.lat IS 'Geocoded latitude of project site address';
COMMENT ON COLUMN projects.lng IS 'Geocoded longitude of project site address';