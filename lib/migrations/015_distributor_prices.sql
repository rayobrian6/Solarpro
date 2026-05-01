-- ============================================================
-- Migration 015: Distributor price overrides table
-- ─────────────────────────────────────────────────────────────
-- Stores admin-managed per-company price overrides that win
-- over the static distributor catalog in lib/bom/distributorPricing.ts.
--
-- Resolution order (see distributorPricing.ts):
--   1. Exact part-number override  (this table, part_number != '*')
--   2. Category-level override     (this table, part_number = '*')
--   3. Static catalog              (lib/bom/distributorPricing.ts)
--   4. Category fallback           (CATEGORY_FALLBACK_PRICES)
--
-- Scope: user_id NULL = global default; user_id set = per-company override.
-- ============================================================

CREATE TABLE IF NOT EXISTS distributor_prices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner (NULL = platform default, set = company/user override)
  user_id         UUID        REFERENCES users(id) ON DELETE CASCADE,

  -- Lookup key: exact part number OR '*' for category-wide override
  part_number     TEXT        NOT NULL,

  -- Category (required when part_number = '*', optional otherwise for display)
  category        TEXT,

  -- Human-readable label for admin UI
  label           TEXT,

  -- Price per unit (USD, contractor net)
  unit_cost       NUMERIC(10,4) NOT NULL CHECK (unit_cost >= 0),

  -- Source distributor (CED | Soligent | KWh | Internal | Custom)
  source          TEXT        NOT NULL DEFAULT 'Custom',

  -- Optional: price sheet date this override is based on
  price_date      DATE,

  -- Optional notes (e.g. "Q2 2025 CED contract price")
  notes           TEXT,

  -- Active flag — soft delete pattern
  active          BOOLEAN     NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Fast lookup by user + part number (primary query path in applyDistributorPricing)
CREATE INDEX IF NOT EXISTS idx_distributor_prices_user_part
  ON distributor_prices (user_id, part_number)
  WHERE active = TRUE;

-- Fast lookup by user + category (for wildcard overrides)
CREATE INDEX IF NOT EXISTS idx_distributor_prices_user_category
  ON distributor_prices (user_id, category)
  WHERE active = TRUE AND part_number = '*';

-- Global defaults (user_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_distributor_prices_global
  ON distributor_prices (part_number)
  WHERE active = TRUE AND user_id IS NULL;

-- ─── Auto-update updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_distributor_prices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_distributor_prices_updated_at ON distributor_prices;
CREATE TRIGGER trg_distributor_prices_updated_at
  BEFORE UPDATE ON distributor_prices
  FOR EACH ROW EXECUTE FUNCTION update_distributor_prices_updated_at();

-- ─── Seed: global platform defaults from static catalog ───────────────────────
-- These mirror the netPrice values in DISTRIBUTOR_PRICE_CATALOG and serve as
-- the "installed" baseline. Admins can add company-specific rows on top.
-- ON CONFLICT DO NOTHING — safe to re-run migration.

INSERT INTO distributor_prices (user_id, part_number, category, label, unit_cost, source, price_date)
VALUES
  -- Solar Panels
  (NULL, 'Q.PEAK DUO BLK ML-G10+400', 'solar_panel',    'Qcells Q.Peak Duo 400W',            136.00, 'CED',      '2025-01-15'),
  (NULL, 'REC405AA-PURE-R',            'solar_panel',    'REC Alpha Pure 405W',                149.85, 'CED',      '2025-01-15'),
  (NULL, 'SIL-380-BK',                 'solar_panel',    'Silfab SIL-380-BK',                  117.80, 'CED',      '2025-01-15'),
  (NULL, 'PS-MNB108-HCBF-440W',        'solar_panel',    'Panasonic EverVolt 440W',            193.60, 'Soligent', '2025-01-15'),
  -- String Inverters
  (NULL, 'PRIMO-8.2-1-240',            'string_inverter', 'Fronius Primo 8.2kW',              1584.00, 'CED',      '2025-01-15'),
  (NULL, 'SB7.7-1SP-US-40',            'string_inverter', 'SMA Sunny Boy 7.7kW',             1320.00, 'CED',      '2025-01-15'),
  (NULL, 'SG8K-D-US',                  'string_inverter', 'Sungrow SG8K-D',                  1160.00, 'Soligent', '2025-01-15'),
  (NULL, 'SE7600H-US000BNU4',          'string_inverter', 'SolarEdge SE7600H',               1512.00, 'CED',      '2025-01-15'),
  (NULL, 'SE10000H-US000BNU4',         'string_inverter', 'SolarEdge SE10000H',              1680.00, 'CED',      '2025-01-15'),
  -- Hybrid Inverters
  (NULL, 'SE10K-RWS',                  'hybrid_inverter', 'SolarEdge StorEdge SE10K-RWS',    2280.00, 'CED',      '2025-01-15'),
  (NULL, 'EF-PO-5K-HV',               'hybrid_inverter', 'EcoFlow PowerOcean 5kW',          1870.00, 'Soligent', '2025-01-15'),
  (NULL, 'EF-PO-10K-HV',              'hybrid_inverter', 'EcoFlow PowerOcean 10kW',         2890.00, 'Soligent', '2025-01-15'),
  (NULL, 'EF-PO-20K-HV-PRO',          'hybrid_inverter', 'EcoFlow PowerOcean 20kW Pro',     4930.00, 'Soligent', '2025-01-15'),
  -- Microinverters
  (NULL, 'IQ8PLUS-72-2-US',           'microinverter',   'Enphase IQ8+',                     156.00, 'CED',      '2025-01-15'),
  (NULL, 'IQ8M-72-2-US',              'microinverter',   'Enphase IQ8M',                     172.00, 'CED',      '2025-01-15'),
  -- Optimizers
  (NULL, 'P401-5R2MRM',               'optimizer',       'SolarEdge P401',                    49.60, 'CED',      '2025-01-15'),
  (NULL, 'P505-5R2MRM',               'optimizer',       'SolarEdge P505',                    54.40, 'CED',      '2025-01-15'),
  (NULL, 'TAP-TS4-A-O',               'optimizer',       'Tigo TS4-A-O',                      36.00, 'Soligent', '2025-01-15'),
  -- Batteries
  (NULL, 'IQ-BAT-5P-1P-240',          'battery',         'Enphase IQ Battery 5P',           3230.00, 'CED',      '2025-01-15'),
  (NULL, 'PW3-US',                     'battery',         'Tesla Powerwall 3',               8280.00, 'Soligent', '2025-01-15'),
  (NULL, 'EF-BATT-5K-LFP',            'battery',         'EcoFlow 5kWh LFP Module',         2720.00, 'Soligent', '2025-01-15')
ON CONFLICT DO NOTHING;

-- ─── Comments ────────────────────────────────────────────────────────────────
COMMENT ON TABLE distributor_prices IS
  'Admin-managed BOM price overrides. Wins over static catalog in lib/bom/distributorPricing.ts. '
  'user_id NULL = global platform default; user_id set = per-company override.';

COMMENT ON COLUMN distributor_prices.part_number IS
  'Exact SKU/part number to match (case-insensitive) OR "*" for category-wide override.';

COMMENT ON COLUMN distributor_prices.unit_cost IS
  'Contractor net price per unit (USD). For solar panels this is per-panel (not $/W).';