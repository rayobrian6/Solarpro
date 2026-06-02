ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS roof_pitch_degrees NUMERIC(6,2);

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS decking_thickness_in NUMERIC(6,3);

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS structural_notes TEXT;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS main_panel_rating_amps INTEGER;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS busbar_rating_amps INTEGER;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS breaker_spaces_available INTEGER;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS has_existing_solar BOOLEAN DEFAULT FALSE;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS total_roof_area_sqft NUMERIC(12,2);

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS usable_area_sqft NUMERIC(12,2);

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS site_address TEXT;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
