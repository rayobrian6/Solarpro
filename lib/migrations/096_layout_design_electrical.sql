-- ============================================================================
-- Migration 096: Add design_electrical to layouts (Design → Engineering handoff)
-- ============================================================================
-- Stores the electrical design produced in Design Studio so it carries over to
-- the Engineering page automatically (no re-entry): topology (string/optimizer/
-- micro), inverter brand, modules-per-string, racking, panel/optimizer/micro
-- model, and the FINAL per-panel string assignment (auto serpentine + any manual
-- paint overrides). Engineering seeds its SystemState inverter config from this
-- on first load; the engineer's own saved engineering_config still wins after
-- they customize.
--
-- NULLable — scratch designs with no client project never write it, and older
-- layouts simply have NULL (engineering falls back to its seed-based sizing).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. No backfill, no destructive operations.
-- ============================================================================

ALTER TABLE layouts
  ADD COLUMN IF NOT EXISTS design_electrical JSONB NULL;
