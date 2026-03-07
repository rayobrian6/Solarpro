-- ============================================================
-- SolarPro Platform — Neon PostgreSQL Schema
-- Migration 001: Initial schema with all entities
-- Run once against Neon DB to create all tables
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CLIENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  state           TEXT NOT NULL DEFAULT '',
  zip             TEXT NOT NULL DEFAULT '',
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  utility_provider TEXT NOT NULL DEFAULT '',
  monthly_kwh     JSONB NOT NULL DEFAULT '[]',
  annual_kwh      DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_monthly_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_monthly_bill DOUBLE PRECISION NOT NULL DEFAULT 0,
  annual_bill     DOUBLE PRECISION NOT NULL DEFAULT 0,
  utility_rate    DOUBLE PRECISION NOT NULL DEFAULT 0.13,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients(deleted_at);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

-- ============================================================
-- PROJECTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'lead',
  system_type     TEXT NOT NULL DEFAULT 'roof',
  notes           TEXT NOT NULL DEFAULT '',
  address         TEXT,
  system_size_kw  DOUBLE PRECISION,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);

-- ============================================================
-- LAYOUTS TABLE (panel designs)
-- ============================================================
CREATE TABLE IF NOT EXISTS layouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  system_type     TEXT NOT NULL DEFAULT 'roof',
  panels          JSONB NOT NULL DEFAULT '[]',
  roof_planes     JSONB,
  ground_tilt     DOUBLE PRECISION DEFAULT 20,
  ground_azimuth  DOUBLE PRECISION DEFAULT 180,
  row_spacing     DOUBLE PRECISION DEFAULT 1.5,
  ground_height   DOUBLE PRECISION DEFAULT 0.6,
  fence_azimuth   DOUBLE PRECISION,
  fence_height    DOUBLE PRECISION,
  fence_line      JSONB,
  bifacial_optimized BOOLEAN DEFAULT FALSE,
  total_panels    INTEGER DEFAULT 0,
  system_size_kw  DOUBLE PRECISION DEFAULT 0,
  map_center      JSONB,
  map_zoom        INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layouts_project_id ON layouts(project_id);
CREATE INDEX IF NOT EXISTS idx_layouts_user_id ON layouts(user_id);

-- ============================================================
-- PROJECT VERSIONS TABLE (version history / snapshots)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  version_number  INTEGER NOT NULL DEFAULT 1,
  snapshot        JSONB NOT NULL,
  panels_count    INTEGER DEFAULT 0,
  system_size_kw  DOUBLE PRECISION DEFAULT 0,
  change_summary  TEXT DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_versions_project_id ON project_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_created_at ON project_versions(created_at DESC);

-- ============================================================
-- PRODUCTIONS TABLE (energy calculation results)
-- ============================================================
CREATE TABLE IF NOT EXISTS productions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  annual_production_kwh DOUBLE PRECISION,
  monthly_production  JSONB,
  system_size_kw  DOUBLE PRECISION,
  panel_count     INTEGER,
  performance_ratio DOUBLE PRECISION,
  specific_yield  DOUBLE PRECISION,
  co2_offset_kg   DOUBLE PRECISION,
  calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_productions_project_id ON productions(project_id);

-- ============================================================
-- AUTO-UPDATE updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_layouts_updated_at ON layouts;
CREATE TRIGGER update_layouts_updated_at
  BEFORE UPDATE ON layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();