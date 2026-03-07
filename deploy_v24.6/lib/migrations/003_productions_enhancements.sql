-- Migration 003: Add data_json to productions + unique constraint on project_id
-- Also add data_json column to proposals table for future use

-- Add unique constraint on productions.project_id (one production record per project)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'productions_project_id_unique'
  ) THEN
    -- Delete duplicate rows keeping only the latest per project
    DELETE FROM productions p1
    USING productions p2
    WHERE p1.project_id = p2.project_id
      AND p1.calculated_at < p2.calculated_at;

    ALTER TABLE productions
      ADD CONSTRAINT productions_project_id_unique UNIQUE (project_id);
  END IF;
END $$;

-- Add data_json column to productions if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'productions' AND column_name = 'data_json'
  ) THEN
    ALTER TABLE productions ADD COLUMN data_json JSONB;
  END IF;
END $$;

-- Add data_json column to proposals if it doesn't exist (already there but ensure)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'proposals' AND column_name = 'data_json'
  ) THEN
    ALTER TABLE proposals ADD COLUMN data_json JSONB;
  END IF;
END $$;