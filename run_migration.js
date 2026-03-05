#!/usr/bin/env node
/**
 * Run Neon PostgreSQL migration using tagged template literals
 */
const { neon } = require('@neondatabase/serverless');
const path = require('path');

const DATABASE_URL = 'postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require';

async function runMigration() {
  const sql = neon(DATABASE_URL);
  
  console.log('Running migration...\n');

  const steps = [
    // Enable pgcrypto
    { name: 'Enable pgcrypto', fn: () => sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"` },

    // Clients table
    { name: 'Create clients table', fn: () => sql`
      CREATE TABLE IF NOT EXISTS clients (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL,
        name            TEXT NOT NULL,
        email           TEXT NOT NULL,
        phone           TEXT NOT NULL DEFAULT '',
        address         TEXT NOT NULL DEFAULT '',
        city            TEXT NOT NULL DEFAULT '',
        state           TEXT NOT NULL DEFAULT '',
        zip             TEXT NOT NULL DEFAULT '',
        lat             DOUBLE PRECISION,
        lng             DOUBLE PRECISION,
        utility_provider TEXT NOT NULL DEFAULT '',
        monthly_kwh     JSONB NOT NULL DEFAULT '[]',
        annual_kwh      DOUBLE PRECISION NOT NULL DEFAULT 0,
        average_monthly_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
        average_monthly_bill DOUBLE PRECISION NOT NULL DEFAULT 0,
        annual_bill     DOUBLE PRECISION NOT NULL DEFAULT 0,
        utility_rate    DOUBLE PRECISION NOT NULL DEFAULT 0.13,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      )
    ` },

    // Add missing columns to clients if they don't exist
    { name: 'Add deleted_at to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ` },
    { name: 'Add updated_at to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` },
    { name: 'Add utility_provider to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS utility_provider TEXT NOT NULL DEFAULT ''` },
    { name: 'Add monthly_kwh to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS monthly_kwh JSONB NOT NULL DEFAULT '[]'` },
    { name: 'Add annual_kwh to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS annual_kwh DOUBLE PRECISION NOT NULL DEFAULT 0` },
    { name: 'Add average_monthly_kwh to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS average_monthly_kwh DOUBLE PRECISION NOT NULL DEFAULT 0` },
    { name: 'Add average_monthly_bill to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS average_monthly_bill DOUBLE PRECISION NOT NULL DEFAULT 0` },
    { name: 'Add annual_bill to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS annual_bill DOUBLE PRECISION NOT NULL DEFAULT 0` },
    { name: 'Add utility_rate to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS utility_rate DOUBLE PRECISION NOT NULL DEFAULT 0.13` },
    { name: 'Add lat to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION` },
    { name: 'Add lng to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION` },
    { name: 'Add city to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT ''` },
    { name: 'Add state to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT ''` },
    { name: 'Add zip to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS zip TEXT NOT NULL DEFAULT ''` },
    { name: 'Add phone to clients', fn: () => sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''` },

    // Clients indexes
    { name: 'Index clients.user_id', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id)` },
    { name: 'Index clients.deleted_at', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients(deleted_at)` },
    { name: 'Index clients.email', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email)` },

    // Projects table
    { name: 'Create projects table', fn: () => sql`
      CREATE TABLE IF NOT EXISTS projects (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL,
        client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
        name            TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'lead',
        system_type     TEXT NOT NULL DEFAULT 'roof',
        notes           TEXT NOT NULL DEFAULT '',
        address         TEXT,
        system_size_kw  DOUBLE PRECISION,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      )
    ` },

    // Add missing columns to projects
    { name: 'Add deleted_at to projects', fn: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ` },
    { name: 'Add updated_at to projects', fn: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` },
    { name: 'Add system_type to projects', fn: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS system_type TEXT NOT NULL DEFAULT 'roof'` },
    { name: 'Add notes to projects', fn: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''` },
    { name: 'Add system_size_kw to projects', fn: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS system_size_kw DOUBLE PRECISION` },

    // Projects indexes
    { name: 'Index projects.user_id', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)` },
    { name: 'Index projects.client_id', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id)` },
    { name: 'Index projects.deleted_at', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at)` },

    // Layouts table
    { name: 'Create layouts table', fn: () => sql`
      CREATE TABLE IF NOT EXISTS layouts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL,
        system_type     TEXT NOT NULL DEFAULT 'roof',
        panels          JSONB NOT NULL DEFAULT '[]',
        roof_planes     JSONB,
        ground_tilt     DOUBLE PRECISION DEFAULT 20,
        ground_azimuth  DOUBLE PRECISION DEFAULT 180,
        row_spacing     DOUBLE PRECISION DEFAULT 1.5,
        ground_height   DOUBLE PRECISION DEFAULT 0.6,
        fence_azimuth   DOUBLE PRECISION,
        fence_height    DOUBLE PRECISION,
        fence_line      JSONB,
        bifacial_optimized BOOLEAN DEFAULT FALSE,
        total_panels    INTEGER DEFAULT 0,
        system_size_kw  DOUBLE PRECISION DEFAULT 0,
        map_center      JSONB,
        map_zoom        INTEGER,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    ` },

    // Layouts indexes
    { name: 'Index layouts.project_id', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_layouts_project_id ON layouts(project_id)` },
    { name: 'Index layouts.user_id', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_layouts_user_id ON layouts(user_id)` },

    // Project versions table
    { name: 'Create project_versions table', fn: () => sql`
      CREATE TABLE IF NOT EXISTS project_versions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL,
        version_number  INTEGER NOT NULL DEFAULT 1,
        snapshot        JSONB NOT NULL,
        panels_count    INTEGER DEFAULT 0,
        system_size_kw  DOUBLE PRECISION DEFAULT 0,
        change_summary  TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    ` },

    // Project versions indexes
    { name: 'Index project_versions.project_id', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_versions_project_id ON project_versions(project_id)` },
    { name: 'Index project_versions.created_at', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_versions_created_at ON project_versions(created_at DESC)` },

    // Productions table
    { name: 'Create productions table', fn: () => sql`
      CREATE TABLE IF NOT EXISTS productions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL,
        annual_production_kwh DOUBLE PRECISION,
        monthly_production  JSONB,
        system_size_kw  DOUBLE PRECISION,
        panel_count     INTEGER,
        performance_ratio DOUBLE PRECISION,
        specific_yield  DOUBLE PRECISION,
        co2_offset_kg   DOUBLE PRECISION,
        calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    ` },

    // Productions index
    { name: 'Index productions.project_id', fn: () => sql`CREATE INDEX IF NOT EXISTS idx_productions_project_id ON productions(project_id)` },

    // Auto-update trigger function
    { name: 'Create update_updated_at_column function', fn: () => sql`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    ` },

    // Triggers
    { name: 'Trigger: clients updated_at', fn: () => sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_clients_updated_at') THEN
          CREATE TRIGGER update_clients_updated_at
            BEFORE UPDATE ON clients
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END $$
    ` },
    { name: 'Trigger: projects updated_at', fn: () => sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_projects_updated_at') THEN
          CREATE TRIGGER update_projects_updated_at
            BEFORE UPDATE ON projects
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END $$
    ` },
    { name: 'Trigger: layouts updated_at', fn: () => sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_layouts_updated_at') THEN
          CREATE TRIGGER update_layouts_updated_at
            BEFORE UPDATE ON layouts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END $$
    ` },
  ];

  let success = 0, failed = 0;
  for (const step of steps) {
    try {
      await step.fn();
      console.log(`  ✅ ${step.name}`);
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
  
  console.log(`\nMigration complete: ${success} succeeded, ${failed} failed`);
  
  // Verify tables exist
  const tables = await sql`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `;
  console.log('\nTables in database:');
  tables.forEach(t => console.log(`  - ${t.table_name}`));

  // Show columns for clients table
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'clients' AND table_schema = 'public'
    ORDER BY ordinal_position
  `;
  console.log('\nClients table columns:');
  cols.forEach(c => console.log(`  - ${c.column_name} (${c.data_type}, nullable: ${c.is_nullable})`));
}

runMigration().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});