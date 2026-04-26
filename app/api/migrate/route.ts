export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady , handleRouteDbError} from '@/lib/db-neon';

export async function GET(req: NextRequest) {
  // Allow GET with secret param for easy browser access
  const secret = req.nextUrl.searchParams.get('secret');
  const migrateSecret = process.env.MIGRATE_SECRET;
  if (!migrateSecret) return NextResponse.json({ success: false, error: 'MIGRATE_SECRET env var not configured' }, { status: 500 });
  const validSecret = secret === migrateSecret;
  if (!validSecret) return NextResponse.json({ success: false, error: 'Invalid secret' }, { status: 401 });
  return POST(req);
}

export async function POST(req: NextRequest) {
  try {
    // Allow either authenticated user OR valid migrate secret key
    // SECURITY: Require MIGRATE_SECRET — authenticated users alone cannot run migrations
    const body = await req.json().catch(() => ({}));
    const secret = body?.secret || req.nextUrl.searchParams.get('secret');
    const migrateSecret = process.env.MIGRATE_SECRET;
    if (!migrateSecret) return NextResponse.json({ success: false, error: 'MIGRATE_SECRET env var not configured' }, { status: 500 });
    if (secret !== migrateSecret) return NextResponse.json({ success: false, error: 'Valid MIGRATE_SECRET required' }, { status: 401 });

    const sql = await getDbReady();
    const results: string[] = [];

    // Migration 003: unique constraint on productions.project_id
    try {
      const exists = await sql`
        SELECT 1 FROM pg_constraint WHERE conname = 'productions_project_id_unique'
      `;
      if (exists.length === 0) {
        // Remove duplicate rows first (keep latest per project)
        await sql`
          DELETE FROM productions p1
          USING productions p2
          WHERE p1.project_id = p2.project_id
            AND p1.calculated_at < p2.calculated_at
        `;
        await sql`
          ALTER TABLE productions
            ADD CONSTRAINT productions_project_id_unique UNIQUE (project_id)
        `;
        results.push('✅ Added UNIQUE constraint on productions.project_id');
      } else {
        results.push('⏭ productions.project_id unique constraint already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ productions unique constraint: ${(e as Error).message}`);
    }

    // Migration 003: data_json column on productions
    try {
      const exists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'productions' AND column_name = 'data_json'
      `;
      if (exists.length === 0) {
        await sql`ALTER TABLE productions ADD COLUMN data_json JSONB`;
        results.push('✅ Added data_json column to productions');
      } else {
        results.push('⏭ productions.data_json already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ productions.data_json: ${(e as Error).message}`);
    }

    // Ensure proposals table has data_json column
    try {
      const exists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'proposals' AND column_name = 'data_json'
      `;
      if (exists.length === 0) {
        await sql`ALTER TABLE proposals ADD COLUMN data_json JSONB`;
        results.push('✅ Added data_json column to proposals');
      } else {
        results.push('⏭ proposals.data_json already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ proposals.data_json: ${(e as Error).message}`);
    }

    // ============================================================
    // Migration 006: Subscription + free-pass + white-label columns
    // ============================================================

    // ============================================================
    // Fix users_role_check constraint to allow 'super_admin'
    // ============================================================
    try {
      await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
      results.push('✅ Dropped old users_role_check constraint');
    } catch (e: unknown) {
      results.push(`⚠️ Drop users_role_check: ${(e as Error).message}`);
    }
    // Normalize any invalid role values to 'user' before adding constraint
    try {
      await sql`UPDATE users SET role = 'user' WHERE role NOT IN ('user', 'admin', 'super_admin')`;
      results.push('✅ Normalized invalid role values to user');
    } catch (e: unknown) {
      results.push(`⚠️ Normalize roles: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin'))`;
      results.push('✅ Added new users_role_check constraint (user, admin, super_admin)');
    } catch (e: unknown) {
      results.push(`⚠️ Add users_role_check: ${(e as Error).message}`);
    }

    // Add each column individually using static DDL (Neon doesn't support .unsafe())
    const colMigrations: Array<{ name: string; ddl: () => Promise<unknown> }> = [
      { name: 'plan',                   ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter'` },
      { name: 'subscription_status',    ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing'` },
      { name: 'trial_starts_at',        ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_starts_at TIMESTAMPTZ DEFAULT NOW()` },
      { name: 'trial_ends_at',          ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '3 days')` },
      { name: 'stripe_customer_id',     ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT` },
      { name: 'stripe_subscription_id', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT` },
      { name: 'is_free_pass',           ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_free_pass BOOLEAN NOT NULL DEFAULT false` },
      { name: 'free_pass_note',         ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_pass_note TEXT` },
      { name: 'company_logo_url',       ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_logo_url TEXT` },
      { name: 'company_website',        ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_website TEXT` },
      { name: 'company_address',        ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_address TEXT` },
      { name: 'company_phone',          ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_phone TEXT` },
      { name: 'brand_primary_color',    ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_primary_color TEXT DEFAULT '#f59e0b'` },
      { name: 'brand_secondary_color',  ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_secondary_color TEXT DEFAULT '#0f172a'` },
      { name: 'proposal_footer_text',   ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS proposal_footer_text TEXT` },
      { name: 'updated_at',             ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` },
      { name: 'role',                   ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'` },
      // Admin tables
      { name: 'incentive_overrides',    ddl: () => sql`CREATE TABLE IF NOT EXISTS incentive_overrides (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country TEXT NOT NULL DEFAULT 'US',
        state TEXT,
        utility TEXT,
        program_name TEXT NOT NULL,
        type TEXT NOT NULL,
        value NUMERIC NOT NULL,
        value_type TEXT NOT NULL DEFAULT 'percent',
        start_date DATE,
        end_date DATE,
        active BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )` },
      { name: 'utility_policies',       ddl: () => sql`CREATE TABLE IF NOT EXISTS utility_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        utility_name TEXT NOT NULL,
        state TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'US',
        net_metering BOOLEAN NOT NULL DEFAULT true,
        interconnection_limit_kw NUMERIC,
        buyback_rate NUMERIC,
        rate_structure TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )` },
    ];

    for (const { name, ddl } of colMigrations) {
      try {
        await ddl();
        results.push(`✅ users.${name} — added (or already existed)`);
      } catch (e: unknown) {
        results.push(`⚠️ users.${name}: ${(e as Error).message}`);
      }
    }

    // Update existing trialing users to 3-day trial window
    try {
      await sql`
        UPDATE users
        SET trial_ends_at = created_at + INTERVAL '3 days'
        WHERE subscription_status = 'trialing'
          AND is_free_pass = false
          AND trial_ends_at IS NULL
      `;
      results.push('✅ Updated trialing users to 3-day trial window');
    } catch (e: unknown) {
      results.push(`⚠️ trial update: ${(e as Error).message}`);
    }

    // Grant free pass to specified users (upsert by email)
    // IMPORTANT: updated_at column is added above in colMigrations — safe to use here
    const freePassUsers = [
      { name: "Raymond O'Brian", email: 'raymond.obrian@yahoo.com',      company: 'SolarPro',            role: 'super_admin',  note: 'Owner / Founder' },
      { name: 'James Carpenter',  email: 'carpenterjames88@gmail.com',    company: 'SolarPro',            role: 'admin',  note: 'Team member — free pass granted by owner' },
      { name: 'Cody',             email: 'cody@underthesun.solutions',    company: 'Under The Sun',       role: 'admin',  note: 'Team member — free pass granted by owner' },
      { name: 'Angelique',        email: 'angelique@lmdsolarllc.com',     company: 'LMD Solar LLC',       role: 'user',  note: 'LMD Solar partner — free pass granted by owner' },
      { name: 'UTS Marketing',    email: 'utsmarketing25@gmail.com',      company: 'UTS Marketing',       role: 'user',  note: 'Marketing partner — free pass granted by owner' },
      { name: 'Sarah',            email: 'sarah@solfence.solar',          company: 'Solfence Solar',      role: 'user',  note: 'Partner — free pass granted by owner' },
    ];

    for (const u of freePassUsers) {
      try {
        const bcrypt = await import('bcryptjs');
        const placeholderHash = await bcrypt.hash('ChangeMe123!', 10);
        // Use full UPSERT — handles both existing and new users atomically
        await sql`
          INSERT INTO users (name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
          VALUES (
            ${u.name}, ${u.email}, ${placeholderHash}, ${u.company},
            ${u.role}, 'contractor', 'free_pass', true, ${u.note},
            '2099-12-31 23:59:59+00'
          )
          ON CONFLICT (email) DO UPDATE SET
            plan                = 'contractor',
            subscription_status = 'free_pass',
            is_free_pass        = true,
            free_pass_note      = ${u.note},
            trial_ends_at       = '2099-12-31 23:59:59+00',
            role                = EXCLUDED.role,
            password_hash       = ${placeholderHash}
        `;
        results.push(`✅ Free pass upserted: ${u.email}`);
      } catch (e: unknown) {
        results.push(`⚠️ free pass ${u.email}: ${(e as Error).message}`);
      }
    }

    // ============================================================
    // Migration 007b: bill_data + system_size_kw columns on projects
    // ============================================================
    try {
      const billDataExists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'bill_data'
      `;
      if (billDataExists.length === 0) {
        await sql`ALTER TABLE projects ADD COLUMN bill_data JSONB`;
        results.push('✅ Added bill_data column to projects');
      } else {
        results.push('⏭ projects.bill_data already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ projects.bill_data: ${(e as Error).message}`);
    }

    // Migration 007c: system_size_kw column on projects
    // ============================================================
    try {
      const sizeKwExists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'system_size_kw'
      `;
      if (sizeKwExists.length === 0) {
        await sql`ALTER TABLE projects ADD COLUMN system_size_kw NUMERIC(10,3)`;
        results.push('✅ Added system_size_kw column to projects');
      } else {
        results.push('⏭ projects.system_size_kw already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ projects.system_size_kw: ${(e as Error).message}`);
    }

    // ============================================================
    // Migration 007: Enterprise leads table
    // ============================================================
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS enterprise_leads (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_name        TEXT NOT NULL,
          contact_email       TEXT NOT NULL,
          contact_phone       TEXT,
          number_of_installers INTEGER,
          monthly_installs    INTEGER,
          message             TEXT,
          status              TEXT NOT NULL DEFAULT 'new',
          created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ enterprise_leads table ready');
    } catch (e: unknown) {
      results.push(`⚠️ enterprise_leads: ${(e as Error).message}`);
    }

    // ============================================================
    // Migration 008: project_files table (Client Files in Engineering)
    // ============================================================
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS project_files (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
          user_id       UUID NOT NULL,
          file_name     TEXT NOT NULL,
          file_type     TEXT NOT NULL DEFAULT 'other',
          file_size     INTEGER,
          mime_type     TEXT,
          file_data     BYTEA,
          file_url      TEXT,
          notes         TEXT,
          upload_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ project_files table ready');
    } catch (e: unknown) {
      results.push(`⚠️ project_files: ${(e as Error).message}`);
    }

    // Index for fast project lookups
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id)`;
      results.push('✅ project_files index ready');
    } catch (e: unknown) {
      results.push(`⚠️ project_files index: ${(e as Error).message}`);
    }

    // Unique constraint on project_files (project_id, user_id, file_name) for atomic upsert
    try {
      const constraintExists = await sql`
        SELECT 1 FROM pg_constraint
        WHERE conname = 'project_files_project_user_name_unique'
      `;
      if (constraintExists.length === 0) {
        await sql`
          ALTER TABLE project_files
          ADD CONSTRAINT project_files_project_user_name_unique
          UNIQUE (project_id, user_id, file_name)
        `;
        results.push('✅ project_files unique constraint added');
      } else {
        results.push('⏭ project_files unique constraint already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ project_files unique constraint: ${(e as Error).message}`);
    }


    // Migration: engineering_seed JSONB column on projects
    try {
      const hasSeedCol = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'engineering_seed'
      `;
      if (hasSeedCol.length === 0) {
        await sql`ALTER TABLE projects ADD COLUMN engineering_seed JSONB`;
        results.push('✅ Added engineering_seed column to projects');
      } else {
        results.push('⏭ projects.engineering_seed already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ projects.engineering_seed: ${(e as Error).message}`);
    }

        // ============================================================
    // Migration 009: Add default_residential_rate + source to utility_policies
    // ============================================================
    try {
      await sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS default_residential_rate NUMERIC(6,4)`;
      results.push('✅ utility_policies.default_residential_rate — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ utility_policies.default_residential_rate: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'`;
      results.push('✅ utility_policies.source — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ utility_policies.source: ${(e as Error).message}`);
    }
    // Enable pg_trgm extension for fuzzy matching
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
      results.push('✅ pg_trgm extension enabled');
    } catch (e: unknown) {
      results.push(`⚠️ pg_trgm: ${(e as Error).message}`);
    }
    // GIN index on utility_name for fast trigram similarity search
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_utility_policies_name_trgm ON utility_policies USING GIN (utility_name gin_trgm_ops)`;
      results.push('✅ GIN trigram index on utility_policies.utility_name');
    } catch (e: unknown) {
      results.push(`⚠️ trigram index: ${(e as Error).message}`);
    }

    // ============================================================
    // Migration 010: bills table — persistent bill storage per project
    // ============================================================
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS bills (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id         UUID NOT NULL,
          utility_name    TEXT,
          monthly_kwh     NUMERIC(10,2),
          annual_kwh      NUMERIC(10,2),
          electric_rate   NUMERIC(6,4),
          file_url        TEXT,
          parsed_json     JSONB,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ bills table ready');
    } catch (e: unknown) {
      results.push(`⚠️ bills table: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_bills_project_id ON bills(project_id)`;
      results.push('✅ bills.project_id index ready');
    } catch (e: unknown) {
      results.push(`⚠️ bills index: ${(e as Error).message}`);
    }

    // ============================================================
    // Migration 011: utility_policies rate breakdown columns
    // Adds retail_rate, supply_rate, distribution_rate, transmission_rate,
    // fixed_monthly_charge, net_metering_type, last_updated columns.
    // retail_rate is the authoritative all-in rate for solar savings calculations.
    // ============================================================
    const utilityRateColDDLs: Array<[string, () => Promise<unknown>]> = [
      ['retail_rate',          () => sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS retail_rate NUMERIC(7,4)`],
      ['supply_rate',          () => sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS supply_rate NUMERIC(7,4)`],
      ['distribution_rate',    () => sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS distribution_rate NUMERIC(7,4)`],
      ['transmission_rate',    () => sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS transmission_rate NUMERIC(7,4)`],
      ['fixed_monthly_charge', () => sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS fixed_monthly_charge NUMERIC(8,2)`],
      ['net_metering_type',    () => sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS net_metering_type TEXT DEFAULT 'retail_rate'`],
      ['last_updated',         () => sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS last_updated DATE`],
      ['rate_source',          () => sql`ALTER TABLE utility_policies ADD COLUMN IF NOT EXISTS rate_source TEXT`],
    ];
    for (const [col, runDDL] of utilityRateColDDLs) {
      try {
        await runDDL();
        results.push(`✅ utility_policies.${col} — added (or already existed)`);
      } catch (e: unknown) {
        results.push(`⚠️ utility_policies.${col}: ${(e as Error).message}`);
      }
    }

    // Seed accurate 2024/2025 retail rates for known utilities
    // Uses INSERT ... ON CONFLICT (utility_name, state) DO UPDATE to keep rates current
    // Only updates rate columns — preserves all other utility policy data
    const utilityRateSeeds: Array<{
      name: string; state: string;
      retail: number; supply?: number; distribution?: number; transmission?: number;
      fixed?: number; nmType: string; updated: string; source: string;
    }> = [
      // California
      { name: 'PG&E',                    state: 'CA', retail: 0.338, supply: 0.128, distribution: 0.142, transmission: 0.031, fixed: 15.27, nmType: 'nem3_export',  updated: '2024-11-01', source: 'CPUC PG&E E-1 tariff 2024' },
      { name: 'Southern California Edison', state: 'CA', retail: 0.295, supply: 0.115, distribution: 0.138, transmission: 0.029, fixed: 10.00, nmType: 'nem3_export',  updated: '2024-11-01', source: 'CPUC SCE D-RSGHP tariff 2024' },
      // Florida
      { name: 'Florida Power & Light',   state: 'FL', retail: 0.138, supply: 0.068, distribution: 0.052, transmission: 0.012, fixed: 9.99,  nmType: 'retail_rate',  updated: '2024-09-01', source: 'FPSC FPL EV-1 tariff 2024' },
      // New Jersey
      { name: 'PSE&G',                   state: 'NJ', retail: 0.178, supply: 0.098, distribution: 0.062, transmission: 0.014, fixed: 7.04,  nmType: 'retail_rate',  updated: '2024-10-01', source: 'NJBPU PSE&G RS tariff 2024' },
      // Illinois
      { name: 'ComEd',                   state: 'IL', retail: 0.148, supply: 0.072, distribution: 0.063, transmission: 0.010, fixed: 9.95,  nmType: 'retail_rate',  updated: '2024-06-01', source: 'ICC ComEd BES tariff 2024' },
      { name: 'Ameren Illinois',         state: 'IL', retail: 0.128, supply: 0.060, distribution: 0.055, transmission: 0.010, fixed: 11.00, nmType: 'retail_rate',  updated: '2024-06-01', source: 'ICC Ameren IL residential tariff 2024' },
      // Maine — CORRECTED from 0.069/0.198 to accurate 2024 values
      { name: 'Central Maine Power',     state: 'ME', retail: 0.265, supply: 0.138, distribution: 0.098, transmission: 0.022, fixed: 9.00,  nmType: 'retail_rate',  updated: '2024-09-01', source: 'EIA Electric Power Monthly Oct 2024 + CMP tariff sheet 14' },
      { name: 'Versant Power',           state: 'ME', retail: 0.272, supply: 0.138, distribution: 0.105, transmission: 0.022, fixed: 10.25, nmType: 'retail_rate',  updated: '2024-09-01', source: 'EIA Electric Power Monthly Oct 2024 + Versant tariff 2024' },
      // New England
      { name: 'Eversource Energy',       state: 'MA', retail: 0.248, supply: 0.128, distribution: 0.098, transmission: 0.016, fixed: 9.96,  nmType: 'retail_rate',  updated: '2024-10-01', source: 'EIA Electric Power Monthly Oct 2024 + Eversource D-1 tariff' },
      { name: 'National Grid',           state: 'MA', retail: 0.248, supply: 0.128, distribution: 0.100, transmission: 0.015, fixed: 7.00,  nmType: 'retail_rate',  updated: '2024-10-01', source: 'EIA Electric Power Monthly Oct 2024 + National Grid R1 tariff' },
      { name: 'Green Mountain Power',    state: 'VT', retail: 0.215, supply: 0.098, distribution: 0.098, transmission: 0.016, fixed: 22.78, nmType: 'retail_rate',  updated: '2024-09-01', source: 'EIA Electric Power Monthly Oct 2024 + GMP R tariff 2024' },
      { name: 'Unitil',                  state: 'NH', retail: 0.235, supply: 0.118, distribution: 0.098, transmission: 0.016, fixed: 11.35, nmType: 'retail_rate',  updated: '2024-09-01', source: 'EIA Electric Power Monthly Oct 2024 + Unitil G tariff 2024' },
    ];

    let seedCount = 0;
    for (const u of utilityRateSeeds) {
      try {
        // Update existing rows by name+state match (case-insensitive)
        const updated = await sql`
          UPDATE utility_policies SET
            retail_rate          = ${u.retail},
            supply_rate          = ${u.supply ?? null},
            distribution_rate    = ${u.distribution ?? null},
            transmission_rate    = ${u.transmission ?? null},
            fixed_monthly_charge = ${u.fixed ?? null},
            net_metering_type    = ${u.nmType},
            last_updated         = ${u.updated}::date,
            rate_source          = ${u.source},
            default_residential_rate = ${u.retail},
            updated_at           = NOW()
          WHERE LOWER(TRIM(utility_name)) ILIKE LOWER(TRIM(${u.name}))
            AND state = ${u.state}
          RETURNING id
        `;
        if (updated.length > 0) {
          seedCount++;
          results.push(`✅ Rate seeded: ${u.name} (${u.state}) = $${u.retail}/kWh`);
        } else {
          // Row doesn't exist yet — insert it
          await sql`
            INSERT INTO utility_policies
              (utility_name, state, country, net_metering, default_residential_rate,
               retail_rate, supply_rate, distribution_rate, transmission_rate,
               fixed_monthly_charge, net_metering_type, last_updated, rate_source, source)
            VALUES
              (${u.name}, ${u.state}, 'US', true, ${u.retail},
               ${u.retail}, ${u.supply ?? null}, ${u.distribution ?? null}, ${u.transmission ?? null},
               ${u.fixed ?? null}, ${u.nmType}, ${u.updated}::date, ${u.source}, 'seeded')
            ON CONFLICT DO NOTHING
          `;
          seedCount++;
          results.push(`✅ Rate inserted: ${u.name} (${u.state}) = $${u.retail}/kWh`);
        }
      } catch (e: unknown) {
        results.push(`⚠️ Rate seed failed for ${u.name}: ${(e as Error).message}`);
      }
    }
    results.push(`✅ Migration 011 complete: ${seedCount}/${utilityRateSeeds.length} utility rates seeded`);

    // ── Migration 010: ToS acceptance tracking ──────────────────────────────
    try {
      await sql`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS tos_accepted_at  TIMESTAMPTZ DEFAULT NULL
      `;
      results.push('✅ users.tos_accepted_at — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ users.tos_accepted_at: ${(e as Error).message}`);
    }
    try {
      await sql`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS tos_version  TEXT DEFAULT NULL
      `;
      results.push('✅ users.tos_version — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ users.tos_version: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_users_tos_version ON users(tos_version)
      `;
      results.push('✅ idx_users_tos_version index — ready');
    } catch (e: unknown) {
      results.push(`⚠️ idx_users_tos_version: ${(e as Error).message}`);
    }
    try {
      await sql`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS tos_ip  TEXT DEFAULT NULL
      `;
      results.push('✅ users.tos_ip — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ users.tos_ip: ${(e as Error).message}`);
    }

        // ── Migration 012: Password Reset Tokens ─────────────────────────────────
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ password_reset_tokens table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ password_reset_tokens table: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens (user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens (token_hash)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens (expires_at)`;
      results.push('✅ password_reset_tokens indexes — ready');
    } catch (e: unknown) {
      results.push(`⚠️ password_reset_tokens indexes: ${(e as Error).message}`);
    }

    // ── Migration 013: projects.no_itc ──────────────────────────────────────
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS no_itc BOOLEAN NOT NULL DEFAULT FALSE`;
      results.push('✅ projects.no_itc — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ projects.no_itc: ${(e as Error).message}`);
    }


    // ── Migration 014: Fix project_roof_faces / no_itc schema drift ────────────
    // Symptom: "column no_itc of relation project_roof_faces does not exist"
    // Root cause: a DB trigger on the `projects` table (created outside this codebase)
    // mirrors project rows into `project_roof_faces`, but that table was created before
    // the no_itc column was added to projects (Migration 013).
    // Fix A: add no_itc to project_roof_faces (if the table exists) — immediate unblock
    // Fix B: list any triggers on projects so they can be reviewed / dropped manually
    try {
      // Check if project_roof_faces table exists and add no_itc if missing
      const tableCheck = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'project_roof_faces'
          AND column_name  = 'no_itc'
        LIMIT 1
      `;
      if (tableCheck.length === 0) {
        // Table exists but lacks no_itc — try to add it
        try {
          await sql`ALTER TABLE project_roof_faces ADD COLUMN IF NOT EXISTS no_itc BOOLEAN NOT NULL DEFAULT FALSE`;
          results.push('✅ project_roof_faces.no_itc — column added (was missing, now fixed)');
        } catch (alterErr: unknown) {
          // Table may not exist at all — that's fine
          if (String((alterErr as Error).message).includes('does not exist')) {
            results.push('✅ project_roof_faces table does not exist — no action needed');
          } else {
            results.push(`⚠️ Migration 014 alter: ${(alterErr as Error).message}`);
          }
        }
      } else {
        results.push('✅ project_roof_faces.no_itc — already exists, no action needed');
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 014 column check: ${(e as Error).message}`);
    }

    try {
      // List all triggers on projects table for diagnostics
      const triggers = await sql`
        SELECT trigger_name, event_manipulation, action_timing
        FROM information_schema.triggers
        WHERE event_object_table = 'projects'
          AND trigger_schema = 'public'
        ORDER BY trigger_name
      `;
      if (triggers.length > 0) {
        const names = triggers.map((t: any) => `${t.trigger_name}(${t.action_timing} ${t.event_manipulation})`).join(', ');
        results.push(`ℹ️ Triggers on projects table: ${names}`);
      } else {
        results.push('✅ No triggers found on projects table');
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 014 trigger list: ${(e as Error).message}`);
    }

        // ── Migration 015: canonical_snapshot column on projects ──────────────────
    // Stores the output of syncProjectPipeline() as a single JSONB blob.
    // This is the canonical source of truth for all downstream pages.
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS canonical_snapshot JSONB`;
      results.push('✅ projects.canonical_snapshot — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ projects.canonical_snapshot: ${(e as Error).message}`);
    }

    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_projects_canonical_snapshot ON projects USING GIN (canonical_snapshot)`;
      results.push('✅ idx_projects_canonical_snapshot index — ready');
    } catch (e: unknown) {
      results.push(`⚠️ idx_projects_canonical_snapshot: ${(e as Error).message}`);
    }

        // ══════════════════════════════════════════════════════════════════
    // Migration 016: Operations Pipeline — v47.350
    // ══════════════════════════════════════════════════════════════════

    // 016a: New columns on projects table for operations tracking
    // Each ALTER TABLE must be a static tagged template (Neon doesn't support dynamic DDL)
    const ddlStatements: Array<{ name: string; run: () => Promise<any> }> = [
      { name: 'project_status',      run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_status TEXT DEFAULT 'lead'` },
      { name: 'contract_signed_at',  run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMP` },
      { name: 'install_date',        run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS install_date DATE` },
      { name: 'estimated_completion',run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_completion DATE` },
      { name: 'actual_completion',   run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS actual_completion DATE` },
      { name: 'crew_assigned',       run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS crew_assigned TEXT` },
      { name: 'labor_hours',         run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS labor_hours NUMERIC DEFAULT 0` },
      { name: 'labor_cost',          run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS labor_cost NUMERIC DEFAULT 0` },
      { name: 'material_cost',       run: () => sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS material_cost NUMERIC DEFAULT 0` },
    ];

    for (const ddl of ddlStatements) {
      try {
        await ddl.run();
        results.push(`✅ projects.${ddl.name} — ensured`);
      } catch (e: unknown) {
        results.push(`⚠️ projects.${ddl.name}: ${(e as Error).message}`);
      }
    }


    // 016b: project_tasks table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS project_tasks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'pending',
          stage TEXT,
          created_at TIMESTAMP DEFAULT now(),
          completed_at TIMESTAMP
        )
      `;
      results.push('✅ project_tasks table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ project_tasks table: ${(e as Error).message}`);
    }

    // 016c: project_milestones table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS project_milestones (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          due_date DATE,
          status TEXT DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT now()
        )
      `;
      results.push('✅ project_milestones table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ project_milestones table: ${(e as Error).message}`);
    }

    // 016d: Indexes for operations queries
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_project_tasks_stage ON project_tasks(project_id, stage)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(project_status)`;
      results.push('✅ Operations indexes — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Operations indexes: ${(e as Error).message}`);
    }

        // ══════════════════════════════════════════════════════════════════
    // Migration 017: Command Center Execution Engine
    // ══════════════════════════════════════════════════════════════════

    // 017a: command_center_actions table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS command_center_actions (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id         UUID NOT NULL,
          title           TEXT NOT NULL,
          description     TEXT,
          type            TEXT NOT NULL DEFAULT 'custom',
          priority        TEXT NOT NULL DEFAULT 'medium',
          status          TEXT NOT NULL DEFAULT 'pending',
          due_date        DATE,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at    TIMESTAMPTZ,
          auto_generated  BOOLEAN NOT NULL DEFAULT false
        )
      `;
      results.push('✅ command_center_actions table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ command_center_actions table: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_cca_user_status ON command_center_actions(user_id, status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_cca_project ON command_center_actions(project_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_cca_due_date ON command_center_actions(due_date)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_cca_type ON command_center_actions(type)`;
      results.push('✅ command_center_actions indexes — ready');
    } catch (e: unknown) {
      results.push(`⚠️ command_center_actions indexes: ${(e as Error).message}`);
    }

    // 017b: crews table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS crews (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL,
          name       TEXT NOT NULL,
          color      TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ crews table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ crews table: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_crews_user ON crews(user_id)`;
      results.push('✅ crews indexes — ready');
    } catch (e: unknown) {
      results.push(`⚠️ crews indexes: ${(e as Error).message}`);
    }

    // 017c: project_schedule table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS project_schedule (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id    UUID NOT NULL,
          type       TEXT NOT NULL DEFAULT 'custom',
          date       DATE NOT NULL,
          crew_id    UUID REFERENCES crews(id) ON DELETE SET NULL,
          notes      TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ project_schedule table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ project_schedule table: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_ps_user_date ON project_schedule(user_id, date)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_ps_project ON project_schedule(project_id)`;
      results.push('✅ project_schedule indexes — ready');
    } catch (e: unknown) {
      results.push(`⚠️ project_schedule indexes: ${(e as Error).message}`);
    }

    // 017d: project_activity table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS project_activity (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id    UUID NOT NULL,
          type       TEXT NOT NULL DEFAULT 'note',
          title      TEXT NOT NULL,
          details    TEXT,
          metadata   JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ project_activity table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ project_activity table: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_pa_project ON project_activity(project_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pa_user_created ON project_activity(user_id, created_at DESC)`;
      results.push('✅ project_activity indexes — ready');
    } catch (e: unknown) {
      results.push(`⚠️ project_activity indexes: ${(e as Error).message}`);
    }

    // 017e: Financial columns on projects
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_value NUMERIC(12,2)`;
      results.push('✅ projects.contract_value — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ projects.contract_value: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_margin NUMERIC(12,2)`;
      results.push('✅ projects.estimated_margin — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ projects.estimated_margin: ${(e as Error).message}`);
    }


    // ──────────────────────────────────────────────────────────────────────
    // 018: Survey Ingest (v47.434)
    // Adds webhook_deliveries table + projects survey columns + project_files
    // external_id/status columns needed by the survey webhook handler.
    // ──────────────────────────────────────────────────────────────────────

    // 018a: projects — survey columns
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS survey_external_id TEXT`;
      results.push('✅ projects.survey_external_id — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ projects.survey_external_id: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual'`;
      results.push('✅ projects.origin — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ projects.origin: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS survey_category TEXT`;
      results.push('✅ projects.survey_category — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ projects.survey_category: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS survey_meta JSONB`;
      results.push('✅ projects.survey_meta — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ projects.survey_meta: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_survey_external_id_user
          ON projects(user_id, survey_external_id)
          WHERE survey_external_id IS NOT NULL
      `;
      results.push('✅ idx_projects_survey_external_id_user — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_projects_survey_external_id_user: ${(e as Error).message}`);
    }

    // 018b: project_files — external_id + status
    try {
      await sql`ALTER TABLE project_files ADD COLUMN IF NOT EXISTS external_id TEXT`;
      results.push('✅ project_files.external_id — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ project_files.external_id: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE project_files ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'`;
      results.push('✅ project_files.status — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ project_files.status: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_files_external_id_project
          ON project_files(project_id, external_id)
          WHERE external_id IS NOT NULL
      `;
      results.push('✅ idx_project_files_external_id_project — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_project_files_external_id_project: ${(e as Error).message}`);
    }

    // 018c: webhook_deliveries table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id                  VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
          source              TEXT          NOT NULL,
          event_type          TEXT          NOT NULL,
          event_id            TEXT          NOT NULL,
          signature_header    TEXT,
          timestamp_header    TEXT,
          signature_valid     BOOLEAN       NOT NULL,
          raw_body            TEXT,
          status              TEXT          NOT NULL DEFAULT 'received',
          error_message       TEXT,
          project_id          VARCHAR(36),
          received_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
          processed_at        TIMESTAMPTZ,
          created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
        )
      `;
      results.push('✅ webhook_deliveries table — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ webhook_deliveries table: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_source_event
          ON webhook_deliveries(source, event_id)
      `;
      results.push('✅ idx_webhook_deliveries_source_event — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_webhook_deliveries_source_event: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_received
          ON webhook_deliveries(received_at DESC)
      `;
      results.push('✅ idx_webhook_deliveries_received — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_webhook_deliveries_received: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
          ON webhook_deliveries(status)
      `;
      results.push('✅ idx_webhook_deliveries_status — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_webhook_deliveries_status: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_project
          ON webhook_deliveries(project_id)
          WHERE project_id IS NOT NULL
      `;
      results.push('✅ idx_webhook_deliveries_project — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_webhook_deliveries_project: ${(e as Error).message}`);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 019: Survey Ingest v2 (v47.435)
    // Adds ingest pipeline columns to webhook_deliveries, triage support to
    // projects, and async photo-fetch lifecycle columns to project_files.
    // ──────────────────────────────────────────────────────────────────────

    // 019a: webhook_deliveries — pipeline columns
    try {
      await sql`ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS ingest_version TEXT`;
      results.push('✅ webhook_deliveries.ingest_version — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ webhook_deliveries.ingest_version: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS ingest_summary JSONB`;
      results.push('✅ webhook_deliveries.ingest_summary — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ webhook_deliveries.ingest_summary: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ingest_version
          ON webhook_deliveries(ingest_version)
          WHERE ingest_version IS NOT NULL
      `;
      results.push('✅ idx_webhook_deliveries_ingest_version — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_webhook_deliveries_ingest_version: ${(e as Error).message}`);
    }

    // 019b: projects — triage support
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS survey_triage_reason TEXT`;
      results.push('✅ projects.survey_triage_reason — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ projects.survey_triage_reason: ${(e as Error).message}`);
    }

    // 019c: project_files — async photo-fetch lifecycle
    try {
      await sql`ALTER TABLE project_files ADD COLUMN IF NOT EXISTS fetch_error TEXT`;
      results.push('✅ project_files.fetch_error — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ project_files.fetch_error: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE project_files ADD COLUMN IF NOT EXISTS fetch_attempts INTEGER NOT NULL DEFAULT 0`;
      results.push('✅ project_files.fetch_attempts — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ project_files.fetch_attempts: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE project_files ADD COLUMN IF NOT EXISTS mime_type TEXT`;
      results.push('✅ project_files.mime_type — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ project_files.mime_type: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_project_files_status_pending
          ON project_files(project_id, status)
          WHERE status = 'pending'
      `;
      results.push('✅ idx_project_files_status_pending — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_project_files_status_pending: ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_project_files_status_failed
          ON project_files(project_id, status, fetch_attempts)
          WHERE status = 'failed'
      `;
      results.push('✅ idx_project_files_status_failed — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_project_files_status_failed: ${(e as Error).message}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Migration 020: project_physical_data (v47.438)
    // The single source of truth for physical + electrical property data.
    // Survey WRITES to it. Engineering READS from it.
    // ─────────────────────────────────────────────────────────────────────────

    // 020a: Create project_physical_data table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS project_physical_data (
          id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id              UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source                  TEXT          NOT NULL DEFAULT 'survey'
                                    CHECK (source IN ('survey', 'manual', 'api', 'override')),
          roof_material           TEXT,
          roof_pitch              TEXT,
          rafter_spacing_in       INTEGER,
          roof_condition          TEXT,
          roof_age_years          INTEGER,
          attic_access            BOOLEAN,
          panel_brand             TEXT,
          panel_rating_amps       INTEGER,
          available_breaker_slots TEXT,
          meter_socket_type       TEXT,
          interconnection_point   TEXT,
          service_entrance_type   TEXT,
          has_sub_panel           BOOLEAN,
          sub_panel_rating_amps   INTEGER,
          obstructions            JSONB         NOT NULL DEFAULT '[]'::jsonb,
          usable_roof_pct         INTEGER
                                    CHECK (usable_roof_pct IS NULL OR (usable_roof_pct >= 0 AND usable_roof_pct <= 100)),
          inspector_name          TEXT,
          surveyed_at             TIMESTAMPTZ,
          access_notes            TEXT,
          mounting_notes          TEXT,
          electrical_notes        TEXT,
          structure_type          TEXT,
          stories                 TEXT,
          created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
          updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
        )
      `;
      results.push('✅ project_physical_data table — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ project_physical_data table: ${(e as Error).message}`);
    }

    // 020b: Unique index — one record per project
    try {
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_physical_data_project_id
          ON project_physical_data(project_id)
      `;
      results.push('✅ idx_project_physical_data_project_id — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_project_physical_data_project_id: ${(e as Error).message}`);
    }

    // 020c: Source index for admin queries
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_project_physical_data_source
          ON project_physical_data(source)
      `;
      results.push('✅ idx_project_physical_data_source — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ idx_project_physical_data_source: ${(e as Error).message}`);
    }

    // 020d: updated_at trigger function
    try {
      await sql`
        CREATE OR REPLACE FUNCTION update_project_physical_data_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `;
      results.push('✅ update_project_physical_data_updated_at() function — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ update_project_physical_data_updated_at fn: ${(e as Error).message}`);
    }

    // 020e: updated_at trigger
    try {
      await sql`
        DROP TRIGGER IF EXISTS trg_project_physical_data_updated_at ON project_physical_data
      `;
      await sql`
        CREATE TRIGGER trg_project_physical_data_updated_at
          BEFORE UPDATE ON project_physical_data
          FOR EACH ROW
          EXECUTE FUNCTION update_project_physical_data_updated_at()
      `;
      results.push('✅ trg_project_physical_data_updated_at trigger — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ trg_project_physical_data_updated_at trigger: ${(e as Error).message}`);
    }

        return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/migrate]', error);
  }
}