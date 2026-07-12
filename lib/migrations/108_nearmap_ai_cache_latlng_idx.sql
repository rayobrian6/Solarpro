-- 108_nearmap_ai_cache_latlng_idx.sql
-- Proximity index for the fail-closed Nearmap AI cache (2026-07-12).
-- getNearmapSurfacesCached now matches cached responses within a ~60 m box of
-- the requested point (aerial re-center / array-centroid drift used to mint
-- fresh exact keys and re-bill the SAME property — 81/100 trial parcels burned
-- in 5 days). This composite index serves that box query. Idempotent, no DO
-- blocks.

CREATE INDEX IF NOT EXISTS nearmap_ai_cache_lat_lng_idx
  ON nearmap_ai_cache (lat, lng);
