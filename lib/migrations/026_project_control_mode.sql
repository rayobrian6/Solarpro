-- Migration 026: Project control mode and system config locks
ALTER TABLE projects ADD COLUMN IF NOT EXISTS control_mode TEXT DEFAULT 'auto';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS system_config_locks JSONB DEFAULT '{}'::jsonb;
