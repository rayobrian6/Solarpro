-- Add setback_notes column to project_physical_data.
-- The survey-enrichment pipeline (route.ts ~659) SELECTs this column,
-- and fromPhysicalData.ts consumes it in installerNotes, but the column
-- was never created via migration, causing "column setback_notes does not exist".
-- (access_notes, mounting_notes, electrical_notes already exist in the
--  original CREATE TABLE definition; only setback_notes was omitted.)

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS setback_notes TEXT;
