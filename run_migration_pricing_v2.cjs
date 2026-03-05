#!/usr/bin/env node
/**
 * Migration: Add new pricing_config columns for multi-mode pricing
 * - pricing_mode, is_commercial, itc_rate_commercial, itc_rate_residential
 * - material_cost_per_panel, labor_cost_per_panel, overhead_percent, margin_percent
 * - roof_price_per_panel, ground_price_per_panel, fence_price_per_panel, default_panel_wattage
 */
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require';

async function runMigration() {
  const sql = neon(DATABASE_URL);

  console.log('Running pricing_config v2 migration...\n');

  // First ensure the table exists with base columns
  await sql`
    CREATE TABLE IF NOT EXISTS pricing_config (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      price_per_watt          DOUBLE PRECISION NOT NULL DEFAULT 3.10,
      labor_cost_per_watt     DOUBLE PRECISION NOT NULL DEFAULT 0.75,
      equipment_cost_per_watt DOUBLE PRECISION NOT NULL DEFAULT 0.55,
      fixed_cost              DOUBLE PRECISION NOT NULL DEFAULT 2000,
      profit_margin           DOUBLE PRECISION NOT NULL DEFAULT 40,
      tax_credit_rate         DOUBLE PRECISION NOT NULL DEFAULT 0,
      utility_escalation      DOUBLE PRECISION NOT NULL DEFAULT 3,
      system_life             INTEGER          NOT NULL DEFAULT 25,
      updated_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✅ pricing_config base table ensured');

  const alterSteps = [
    { name: 'pricing_mode',            sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'per_panel'` },
    { name: 'roof_price_per_watt',     sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS roof_price_per_watt DOUBLE PRECISION` },
    { name: 'ground_price_per_watt',   sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS ground_price_per_watt DOUBLE PRECISION` },
    { name: 'fence_price_per_watt',    sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS fence_price_per_watt DOUBLE PRECISION` },
    { name: 'carport_price_per_watt',  sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS carport_price_per_watt DOUBLE PRECISION` },
    { name: 'roof_price_per_panel',    sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS roof_price_per_panel DOUBLE PRECISION` },
    { name: 'ground_price_per_panel',  sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS ground_price_per_panel DOUBLE PRECISION` },
    { name: 'fence_price_per_panel',   sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS fence_price_per_panel DOUBLE PRECISION` },
    { name: 'default_panel_wattage',   sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS default_panel_wattage DOUBLE PRECISION NOT NULL DEFAULT 440` },
    { name: 'material_cost_per_panel', sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS material_cost_per_panel DOUBLE PRECISION NOT NULL DEFAULT 350` },
    { name: 'labor_cost_per_panel',    sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS labor_cost_per_panel DOUBLE PRECISION NOT NULL DEFAULT 200` },
    { name: 'overhead_percent',        sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS overhead_percent DOUBLE PRECISION NOT NULL DEFAULT 15` },
    { name: 'margin_percent',          sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS margin_percent DOUBLE PRECISION NOT NULL DEFAULT 25` },
    { name: 'is_commercial',           sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS is_commercial BOOLEAN NOT NULL DEFAULT false` },
    { name: 'itc_rate_commercial',     sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS itc_rate_commercial DOUBLE PRECISION NOT NULL DEFAULT 30` },
    { name: 'itc_rate_residential',    sql: `ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS itc_rate_residential DOUBLE PRECISION NOT NULL DEFAULT 0` },
    // Fix tax_credit_rate default to 0 (no residential ITC)
    { name: 'tax_credit_rate default 0', sql: `ALTER TABLE pricing_config ALTER COLUMN tax_credit_rate SET DEFAULT 0` },
  ];

  let success = 0, failed = 0;
  for (const step of alterSteps) {
    try {
      await sql.unsafe(step.sql);
      console.log(`  ✅ Added column: ${step.name}`);
      success++;
    } catch (e) {
      if (e.message.includes('already exists') || e.message.includes('duplicate column')) {
        console.log(`  ⚠️  Already exists: ${step.name}`);
        success++;
      } else {
        console.error(`  ❌ FAILED: ${step.name}`);
        console.error(`     Error: ${e.message}`);
        failed++;
      }
    }
  }

  // Also ensure productions table has data_json column
  try {
    await sql.unsafe(`ALTER TABLE productions ADD COLUMN IF NOT EXISTS data_json JSONB`);
    console.log('  ✅ productions.data_json ensured');
  } catch (e) {
    console.log('  ⚠️  productions.data_json:', e.message);
  }

  // Ensure unique constraint on productions.project_id
  try {
    await sql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'productions_project_id_key' 
          AND conrelid = 'productions'::regclass
        ) THEN
          ALTER TABLE productions ADD CONSTRAINT productions_project_id_key UNIQUE (project_id);
        END IF;
      END $$
    `);
    console.log('  ✅ productions.project_id UNIQUE constraint ensured');
  } catch (e) {
    console.log('  ⚠️  productions unique constraint:', e.message);
  }

  console.log(`\nMigration complete: ${success} succeeded, ${failed} failed`);

  // Show current pricing_config columns
  const cols = await sql`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'pricing_config' AND table_schema = 'public'
    ORDER BY ordinal_position
  `;
  console.log('\npricing_config columns:');
  cols.forEach(c => console.log(`  - ${c.column_name} (${c.data_type}) default: ${c.column_default}`));
}

runMigration().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});