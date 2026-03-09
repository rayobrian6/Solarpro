-- ============================================================
-- SolarPro Platform — Neon PostgreSQL Schema
-- Migration 007: Add bill_data JSONB column to projects table
-- Stores extracted utility bill data from bill upload feature
-- Run once: psql $DATABASE_URL -f lib/migrations/007_bill_data.sql
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS bill_data JSONB;

-- Index for querying projects that have bill data
CREATE INDEX IF NOT EXISTS idx_projects_bill_data ON projects USING gin(bill_data)
  WHERE bill_data IS NOT NULL;

COMMENT ON COLUMN projects.bill_data IS
  'Extracted utility bill data from BillUploadFlow — includes kWh usage, rate, utility provider, address, confidence score';