import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export async function GET(req: NextRequest) {
  // Allow GET with secret param for easy browser access
  const secret = req.nextUrl.searchParams.get('secret');
  const validSecret = secret === (process.env.MIGRATE_SECRET || 'solarpro-migrate-2024');
  if (!validSecret) return NextResponse.json({ success: false, error: 'Provide ?secret=solarpro-migrate-2024' }, { status: 401 });
  return POST(req);
}

export async function POST(req: NextRequest) {
  try {
    // Allow either authenticated user OR valid migrate secret key
    const user = getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const secret = body?.secret || req.nextUrl.searchParams.get('secret');
    const validSecret = secret === (process.env.MIGRATE_SECRET || 'solarpro-migrate-2024');
    if (!user && !validSecret) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const sql = getDb();
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
    } catch (e: any) {
      results.push(`⚠️ productions unique constraint: ${e.message}`);
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
    } catch (e: any) {
      results.push(`⚠️ productions.data_json: ${e.message}`);
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
    } catch (e: any) {
      results.push(`⚠️ proposals.data_json: ${e.message}`);
    }

    // ============================================================
    // Migration 006: Subscription + free-pass + white-label columns
    // ============================================================

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
    ];

    for (const { name, ddl } of colMigrations) {
      try {
        await ddl();
        results.push(`✅ users.${name} — added (or already existed)`);
      } catch (e: any) {
        results.push(`⚠️ users.${name}: ${e.message}`);
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
    } catch (e: any) {
      results.push(`⚠️ trial update: ${e.message}`);
    }

    // Grant free pass to specified users (upsert by email)
    const freePassUsers = [
      { name: "Raymond O'Brian", email: 'raymond.obrian@yahoo.com',      company: 'SolarPro',            role: 'user',  note: 'Owner / Founder' },
      { name: 'James Carpenter',  email: 'carpenterjames88@gmail.com',    company: 'SolarPro',            role: 'user',  note: 'Team member — free pass granted by owner' },
      { name: 'Cody',             email: 'cody@underthesun.solutions',    company: 'Under The Sun',       role: 'user',  note: 'Team member — free pass granted by owner' },
      { name: 'Angelique',        email: 'angelique@lmdsolarllc.com',     company: 'LMD Solar LLC',       role: 'user',  note: 'LMD Solar partner — free pass granted by owner' },
      { name: 'UTS Marketing',    email: 'utsmarketing25@gmail.com',      company: 'UTS Marketing',       role: 'user',  note: 'Marketing partner — free pass granted by owner' },
      { name: 'Sarah',            email: 'sarah@solfence.solar',          company: 'Solfence Solar',      role: 'user',  note: 'Partner — free pass granted by owner' },
    ];

    for (const u of freePassUsers) {
      try {
        const existing = await sql`SELECT id FROM users WHERE email = ${u.email} LIMIT 1`;
        if (existing.length > 0) {
          await sql`
            UPDATE users SET
              plan = 'contractor',
              subscription_status = 'free_pass',
              is_free_pass = true,
              free_pass_note = ${u.note},
              trial_ends_at = '2099-12-31 23:59:59+00',
              role = ${u.role},
              updated_at = NOW()
            WHERE email = ${u.email}
          `;
          results.push(`✅ Free pass granted (updated): ${u.email}`);
        } else {
          // User hasn't registered yet — create placeholder row
          const bcrypt = await import('bcryptjs');
          const placeholderHash = await bcrypt.hash('ChangeMe123!', 10);
          await sql`
            INSERT INTO users (name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
            VALUES (
              ${u.name}, ${u.email}, ${placeholderHash}, ${u.company},
              ${u.role}, 'contractor', 'free_pass', true, ${u.note},
              '2099-12-31 23:59:59+00'
            )
          `;
          results.push(`✅ Free pass granted (created): ${u.email}`);
        }
      } catch (e: any) {
        results.push(`⚠️ free pass ${u.email}: ${e.message}`);
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
    } catch (e: any) {
      results.push(`⚠️ projects.bill_data: ${e.message}`);
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
    } catch (e: any) {
      results.push(`⚠️ projects.system_size_kw: ${e.message}`);
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
    } catch (e: any) {
      results.push(`⚠️ enterprise_leads: ${e.message}`);
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
    } catch (e: any) {
      results.push(`⚠️ project_files: ${e.message}`);
    }

    // Index for fast project lookups
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id)`;
      results.push('✅ project_files index ready');
    } catch (e: any) {
      results.push(`⚠️ project_files index: ${e.message}`);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    console.error('[POST /api/migrate]', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}