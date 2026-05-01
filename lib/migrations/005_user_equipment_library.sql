-- ============================================================
-- SolarPro Platform — User Equipment Library
-- Migration 005: User-customizable equipment tables
-- ============================================================

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USER EQUIPMENT - SOLAR PANELS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_equipment_panels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  
  -- Equipment identification
  manufacturer    TEXT NOT NULL,
  model           TEXT NOT NULL,
  
  -- Electrical specs
  wattage         INTEGER NOT NULL DEFAULT 400,
  efficiency      DECIMAL(4,2) NOT NULL DEFAULT 21.0,
  temperature_coeff DECIMAL(4,2) NOT NULL DEFAULT -0.30,
  
  -- Physical dimensions (meters)
  width           DECIMAL(6,3) NOT NULL DEFAULT 1.046,
  height          DECIMAL(6,3) NOT NULL DEFAULT 1.812,
  weight          DECIMAL(6,2), -- kg
  
  -- Bifacial
  bifacial        BOOLEAN NOT NULL DEFAULT FALSE,
  bifacial_factor DECIMAL(3,2) NOT NULL DEFAULT 1.0,
  
  -- Pricing
  price_per_watt  DECIMAL(6,3) NOT NULL DEFAULT 0.35,
  
  -- Additional info
  cell_type       TEXT,
  warranty        INTEGER, -- years
  datasheet_url   TEXT,
  
  -- Status
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom       BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_equipment_panels_user_id ON user_equipment_panels(user_id);
CREATE INDEX IF NOT EXISTS idx_user_equipment_panels_manufacturer ON user_equipment_panels(manufacturer);

-- ============================================================
-- USER EQUIPMENT - INVERTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_equipment_inverters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  
  -- Equipment identification
  manufacturer    TEXT NOT NULL,
  model           TEXT NOT NULL,
  
  -- Inverter type
  type            TEXT NOT NULL DEFAULT 'string', -- 'string', 'micro', 'hybrid', 'optimizer'
  
  -- Electrical specs
  max_ac_output   DECIMAL(6,2) NOT NULL, -- kW
  max_dc_input    DECIMAL(6,2), -- kW
  efficiency      DECIMAL(4,2) NOT NULL DEFAULT 97.0,
  mppt_channels   INTEGER DEFAULT 2,
  
  -- Grid specs
  voltage         INTEGER DEFAULT 240,
  phases          INTEGER DEFAULT 1,
  
  -- Pricing
  price_per_unit  DECIMAL(10,2) NOT NULL DEFAULT 0,
  
  -- Additional info
  warranty        INTEGER, -- years
  datasheet_url   TEXT,
  
  -- Battery compatibility (for hybrid)
  battery_compatible BOOLEAN DEFAULT FALSE,
  battery_max_kw   DECIMAL(6,2),
  battery_max_kwh  DECIMAL(6,2),
  
  -- Status
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom       BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_equipment_inverters_user_id ON user_equipment_inverters(user_id);
CREATE INDEX IF NOT EXISTS idx_user_equipment_inverters_type ON user_equipment_inverters(type);

-- ============================================================
-- USER EQUIPMENT - MOUNTING SYSTEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_equipment_mounting (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  
  -- Equipment identification
  manufacturer    TEXT NOT NULL,
  model           TEXT NOT NULL,
  
  -- Mount type
  mount_type      TEXT NOT NULL DEFAULT 'roof', -- 'roof', 'ground', 'fence', 'carport'
  system_type     TEXT NOT NULL DEFAULT 'rail', -- 'rail', 'railless', 'attached', 'ballasted'
  
  -- Roof compatibility
  compatible_roof_types TEXT[] DEFAULT ARRAY['asphalt_shingle', 'tile_concrete', 'metal_standing_seam'],
  
  -- Structural specs
  uplift_capacity_lbs INTEGER DEFAULT 500,
  fasteners_per_mount INTEGER DEFAULT 2,
  max_spacing_in     DECIMAL(4,1) DEFAULT 48,
  
  -- Rail specs (if applicable)
  rail_length_ft    DECIMAL(6,2),
  rail_price_per_ft DECIMAL(6,2),
  
  -- Pricing
  price_per_mount DECIMAL(8,2) DEFAULT 0,
  price_per_watt  DECIMAL(6,3) DEFAULT 0,
  
  -- Additional info
  icc_es_report   TEXT, -- ICC-ES report number
  ul_2703_certified BOOLEAN DEFAULT FALSE,
  warranty        INTEGER, -- years
  datasheet_url   TEXT,
  
  -- Status
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom       BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_equipment_mounting_user_id ON user_equipment_mounting(user_id);
CREATE INDEX IF NOT EXISTS idx_user_equipment_mounting_type ON user_equipment_mounting(mount_type);

-- ============================================================
-- USER EQUIPMENT - BATTERIES
-- ============================================================
CREATE TABLE IF NOT EXISTS user_equipment_batteries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  
  -- Equipment identification
  manufacturer    TEXT NOT NULL,
  model           TEXT NOT NULL,
  
  -- Battery specs
  capacity_kwh    DECIMAL(6,2) NOT NULL,
  power_kw        DECIMAL(6,2) NOT NULL,
  chemistry        TEXT NOT NULL DEFAULT 'LFP', -- 'LFP', 'NMC', 'Lead Acid'
  round_trip_efficiency DECIMAL(4,2) DEFAULT 90.0,
  
  -- Dimensions
  width           DECIMAL(6,2), -- inches
  height          DECIMAL(6,2),
  depth           DECIMAL(6,2),
  weight          DECIMAL(6,2), -- lbs
  
  -- Pricing
  price_per_unit  DECIMAL(10,2) NOT NULL DEFAULT 0,
  
  -- Additional info
  warranty_years  INTEGER,
  cycles          INTEGER,
  datasheet_url   TEXT,
  
  -- Status
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom       BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_equipment_batteries_user_id ON user_equipment_batteries(user_id);