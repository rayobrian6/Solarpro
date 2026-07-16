-- 103_manufacturer_assets.sql
-- Library of REAL manufacturer detail/spec visual sheets scraped from the web:
-- racking attachment/cross-section details, module/inverter/battery cut sheets.
-- Keyed by equipment_id (joins equipment-db + mounting-hardware-db ids) and brand+model.
-- Feeds PV-3 (attachment detail, by racking brand) + APP-A (spec cut sheets, by equipment id).
-- Idempotent plain DDL (no DO blocks) per the System Tools migration runner.

CREATE TABLE IF NOT EXISTS manufacturer_assets (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL,                    -- racking_detail | module_spec | inverter_spec | microinverter_spec | optimizer_spec | battery_spec
  equipment_id  TEXT,                             -- joins equipment-db / mounting-hardware-db id (e.g. ironridge-xr100, enphase-iq8a)
  brand         TEXT NOT NULL,
  model         TEXT NOT NULL,
  asset_type    TEXT NOT NULL DEFAULT 'pdf',      -- image | pdf | svg
  source_url    TEXT,                             -- manufacturer PDF / download page (verified resolving)
  page_ref      TEXT,                             -- page number of the key detail/cut sheet within the PDF (or full)
  image_url     TEXT,                             -- direct image URL if the detail exists as an image
  data          TEXT,                             -- optional inline/base64 asset when stored locally
  doc_title     TEXT,                             -- e.g. IronRidge Flush Mount Installation Manual
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified      BOOLEAN NOT NULL DEFAULT false,   -- true only when the source_url was fetched and confirmed
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_assets_equipment ON manufacturer_assets (equipment_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_assets_category  ON manufacturer_assets (category);
CREATE INDEX IF NOT EXISTS idx_manufacturer_assets_brand_model ON manufacturer_assets (brand, model);
