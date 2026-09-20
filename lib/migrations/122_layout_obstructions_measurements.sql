-- ============================================================================
-- Migration 122: Add obstructions + measurements to layouts
-- ============================================================================
-- The last two DESIGN entities in Design Studio that never survived a reload.
--
-- WHY OBSTRUCTIONS MATTER MOST
-- ----------------------------
-- An obstruction is not an annotation. It is a KEEP-OUT ZONE: SolarEngine3D
-- runs removeObstructedPanels() against it, so a vent, skylight, chimney, HVAC
-- unit or dormer physically removes panels from the array. Because they lived
-- only in component state, reloading a design silently re-filled panels over
-- every obstruction the user had placed — and the panel count, the BOM, the
-- production model and the permit drawing all changed with it, with nothing to
-- indicate anything had been lost.
--
-- Measurements are the field record the user took off the model (horizontal and
-- slope distance between two points). They are evidence, not decoration, and
-- were discarded on unmount for the same reason.
--
-- WHY TWO COLUMNS AND NOT ONE BLOB
-- --------------------------------
-- They are independent entities with independent shapes (types/index.ts
-- PlacedObstruction, lib/3d/measureMath.ts Measurement). A single "extras" blob
-- would make either one unqueryable and would invite every future entity to be
-- dumped in beside them.
--
-- NOT INCLUDED, deliberately:
--   • camera/orbit pose — per-viewer preference, not design data. On the shared
--     layouts row it would move every other user's view and make every nudge a
--     database write.
--   • vertexSpecs (trees/blocks/gables/hips) — the engine types it as `any` and
--     reads it back zero times. Persisting a shape nothing consumes and nothing
--     defines would be cargo-cult schema. It needs a real type first.
--
-- NULLable — a design with no obstructions writes NULL, and every older layout
-- simply has NULL. No backfill.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, twice. No ALTER of an existing column,
-- no DO block, no data migration, no destructive operation, seeds no rows.
-- ============================================================================

ALTER TABLE layouts
  ADD COLUMN IF NOT EXISTS obstructions JSONB NULL;

ALTER TABLE layouts
  ADD COLUMN IF NOT EXISTS measurements JSONB NULL;
