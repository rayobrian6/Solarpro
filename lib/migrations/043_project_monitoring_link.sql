-- Migration 043: Add monitoring_url + monitoring_platform to projects
-- ─────────────────────────────────────────────────────────────────────────────
-- Enables installers to link a project to its monitoring provider dashboard
-- (Enphase Enlighten, SolarEdge Monitoring, APsystems, Hoymiles, etc.) so the
-- homeowner portal can surface a live "View Your System" link or embedded frame.
-- ─────────────────────────────────────────────────────────────────────────────

-- monitoring_platform: 'enphase' | 'solaredge' | 'apsystems' | 'hoymiles' |
--                      'generac' | 'sma' | 'fronius' | 'solis' | 'other'
-- monitoring_url:      Full URL to the homeowner-facing monitoring dashboard.
--                      E.g. https://enlighten.enphaseenergy.com/systems/12345

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS monitoring_platform TEXT,
  ADD COLUMN IF NOT EXISTS monitoring_url      TEXT;
