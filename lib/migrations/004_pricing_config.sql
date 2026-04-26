-- ============================================================
-- SolarPro Platform — Migration 004: Pricing Config Table
-- Single-row pricing configuration persisted in Neon PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS pricing_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_per_watt          DOUBLE PRECISION NOT NULL DEFAULT 3.10,
  labor_cost_per_watt     DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  equipment_cost_per_watt DOUBLE PRECISION NOT NULL DEFAULT 0.55,
  fixed_cost              DOUBLE PRECISION NOT NULL DEFAULT 2000,
  profit_margin           DOUBLE PRECISION NOT NULL DEFAULT 40,
  tax_credit_rate         DOUBLE PRECISION NOT NULL DEFAULT 30,
  utility_escalation      DOUBLE PRECISION NOT NULL DEFAULT 3,
  system_life             INTEGER          NOT NULL DEFAULT 25,
  -- Per-system-type price overrides (NULL = use price_per_watt)
  roof_price_per_watt     DOUBLE PRECISION,
  ground_price_per_watt   DOUBLE PRECISION,
  fence_price_per_watt    DOUBLE PRECISION,
  carport_price_per_watt  DOUBLE PRECISION,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with one default row if table is empty
INSERT INTO pricing_config (
  price_per_watt, labor_cost_per_watt, equipment_cost_per_watt,
  fixed_cost, profit_margin, tax_credit_rate, utility_escalation, system_life,
  roof_price_per_watt, ground_price_per_watt, fence_price_per_watt, carport_price_per_watt
)
SELECT 3.10, 0.75, 0.55, 2000, 40, 30, 3, 25, 3.10, 2.35, 4.25, 3.75
WHERE NOT EXISTS (SELECT 1 FROM pricing_config);