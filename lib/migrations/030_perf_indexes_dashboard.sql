-- Migration 030: Performance indexes for hot dashboard queries
CREATE INDEX IF NOT EXISTS idx_projects_user_active_updated  ON projects (user_id, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_productions_project_calc       ON productions (project_id, annual_production_kwh, system_size_kw);
CREATE INDEX IF NOT EXISTS idx_clients_user_active_created    ON clients (user_id, is_active, created_at DESC);
