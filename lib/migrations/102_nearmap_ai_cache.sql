-- 102_nearmap_ai_cache.sql
-- Durable cache for Nearmap AI Feature responses so the permit route fetches a
-- given location AT MOST ONCE, EVER — protects the metered AI-parcel quota
-- (the eval trial is only 100 parcels). The in-memory cache doesn't survive
-- Vercel's serverless cold starts, so each fresh generate would otherwise spend
-- a parcel; this table makes re-renders free. Idempotent, no DO blocks.

CREATE TABLE IF NOT EXISTS nearmap_ai_cache (
  location_key TEXT PRIMARY KEY,          -- "lat.5f,lng.5f" (~1 m bucket)
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  survey_date  TEXT,                       -- Nearmap capture date of the response
  response     JSONB NOT NULL,             -- raw AI Feature response
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
