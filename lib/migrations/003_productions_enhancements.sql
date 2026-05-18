-- Migration 003: Add data_json to productions + unique constraint on project_id
-- Also add data_json column to proposals table for future use
--
-- NOTE: Originally used DO $$ … $$ PL/pgSQL blocks. Replaced with
-- ADD CONSTRAINT IF NOT EXISTS and ADD COLUMN IF NOT EXISTS (Postgres 9.1+)
-- so this file is safe to run via the Neon serverless HTTP driver which does
-- not support dollar-quoted strings.

-- Deduplicate productions rows before adding the unique constraint
-- (safe no-op if already deduplicated)
DELETE FROM productions p1
USING productions p2
WHERE p1.project_id = p2.project_id
  AND p1.calculated_at < p2.calculated_at;

-- Add unique constraint on productions.project_id (idempotent)
ALTER TABLE productions
  ADD CONSTRAINT IF NOT EXISTS productions_project_id_unique UNIQUE (project_id);

-- Add data_json column to productions if it doesn't exist
ALTER TABLE productions
  ADD COLUMN IF NOT EXISTS data_json JSONB;

-- Add data_json column to proposals if it doesn't exist
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS data_json JSONB;
