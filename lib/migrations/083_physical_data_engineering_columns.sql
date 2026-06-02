-- ============================================================
-- Migration 083: project_physical_data engineering columns
--
-- Adds columns referenced by the permit route and
-- fromPhysicalData.ts bridge that were never created in
-- the base schema (migration 013) or any subsequent ALTER.
--
-- These columns exist in the TypeScript interface
-- ProjectPhysicalDataRow but were missing from the actual
-- database, causing the permit route's SELECT to always
-- throw a PostgreSQL "column does not exist" error.
--
-- All additive. IF NOT EXISTS guards make this safe to re-run.
-- ============================================================

-- Roof pitch in numeric degrees (base table has roof_pitch TEXT enum:
-- flat|low|standard|steep|very_steep). This column stores the
-- engineering-ready numeric value.
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS roof_pitch_degrees NUMERIC(6,2);

-- Decking / sheathing thickness in inches (e.g., 7/16 OSB = 0.4375)
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS decking_thickness_in NUMERIC(6,3);

-- Free-form structural notes from inspector
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS structural_notes TEXT;

-- Main panel rating in amps (base table has panel_rating_amps INTEGER
-- mapped from PanelRating enum). This column stores the actual measured
-- or nameplate value, which may differ from the enum approximation.
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS main_panel_rating_amps INTEGER;

-- Busbar rating in amps (distinct from main panel rating; needed for
-- NEC 705.12(D) supply-side interconnection calculations)
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS busbar_rating_amps INTEGER;

-- Breaker spaces available as a plain integer (base table has
-- available_breaker_slots TEXT with values like '0','1-2','3-4','5+').
-- This column stores the exact count when known.
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS breaker_spaces_available INTEGER;

-- Whether the property already has an existing solar installation
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS has_existing_solar BOOLEAN DEFAULT FALSE;

-- Total roof area in square feet (distinct from usable_roof_pct which
-- is a 0-100 percentage)
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS total_roof_area_sqft NUMERIC(12,2);

-- Usable roof area in square feet (distinct from usable_roof_pct which
-- is a 0-100 percentage). This is the actual area available for panel
-- placement after setbacks, obstructions, and orientation filtering.
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS usable_area_sqft NUMERIC(12,2);

-- Site street address (projects table has lat/lng but no address column;
-- the survey captures the inspector-verified address)
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS site_address TEXT;

-- Latitude / Longitude on project_physical_data itself, so engineering
-- can read location from a single row without JOINing to projects.
-- The projects table also has lat/lng (migration 002) but these are
-- the survey-verified coordinates.
ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
