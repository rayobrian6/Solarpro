export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError, solardogSeedKnowledge } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { getAdminOverrideEmail } from '@/lib/auth';

export async function GET(_req: NextRequest) {
  // SECURITY FIX: GET handler removed — secrets must never appear in URLs
  // (URL query params are logged by CDNs, proxies, and browser history).
  // Use POST with { "secret": "..." } in the JSON body instead.
  return NextResponse.json(
    { success: false, error: 'Use POST with secret in request body' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

export async function POST(req: NextRequest) {
  try {
    // ── Rate limiting ────────────────────────────────────────────────────────
    const rl = await checkRateLimit('migrate', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }
    // Allow either authenticated user OR valid migrate secret key
    // SECURITY: Require MIGRATE_SECRET — authenticated users alone cannot run migrations
    const body = await req.json().catch(() => ({}));
    // SECURITY FIX: Read secret from body ONLY — never from query string (URL params appear in logs)
    const secret = body?.secret;
    const migrateSecret = process.env.MIGRATE_SECRET;
    if (!migrateSecret) return NextResponse.json({ success: false, error: 'MIGRATE_SECRET env var not configured' }, { status: 500 });
    if (!secret || typeof secret !== 'string') return NextResponse.json({ success: false, error: 'Valid MIGRATE_SECRET required' }, { status: 401 });
    // SECURITY: Use timingSafeEqual to prevent timing attacks on secret comparison
    const { timingSafeEqual } = await import('crypto');
    const expectedBuf = Buffer.from(migrateSecret, 'utf8');
    const actualBuf   = Buffer.from(secret, 'utf8');
    const secretValid = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
    if (!secretValid) return NextResponse.json({ success: false, error: 'Valid MIGRATE_SECRET required' }, { status: 401 });

    // ───────────────────────────────────────────────────────────────────────
    // Phase 1A — Migration Governance (MIGRATION-GOV-01)
    //
    // This legacy inline runner is DEPRECATED as a migration execution path.
    // The canonical migration execution path is now
    // /api/admin/migrations (lib/migrations/runner.ts), which provides:
    //   - schema_migrations ledger (authoritative applied-state record)
    //   - mandatory SHA-256 checksums
    //   - transactional execution (all-or-nothing per migration)
    //   - PostgreSQL advisory locks (concurrency safety)
    //   - environment-aware authorization (production disabled by default)
    //   - fresh TOTP for human execution
    //   - audit event emission
    //
    // This legacy runner's mutation path is gated behind the
    // MIGRATION_LEGACY_INLINE_ENABLED feature flag (default: disabled).
    // When invoked with the flag disabled, it emits a deprecation audit event
    // and returns a deprecation notice. The health-check / read-only portions
    // of the admin database page are unaffected (those use separate routes).
    //
    // The file is NOT deleted in Phase 1A (per spec: restrict/wrap, don't
    // delete unless demonstrably safe). To re-enable the legacy path
    // (NOT recommended), set MIGRATION_LEGACY_INLINE_ENABLED=true.
    // ───────────────────────────────────────────────────────────────────────
    const legacyInlineEnabled = process.env.MIGRATION_LEGACY_INLINE_ENABLED === 'true';
    if (!legacyInlineEnabled) {
      // Emit deprecation audit event for observability.
      console.log(JSON.stringify({
        level: 'audit',
        type: 'migration.legacy.invoked',
        timestamp: new Date().toISOString(),
        actorType: 'human',
        actorId: null,
        environment: (process.env.VERCEL_ENV || process.env.NODE_ENV || 'development').toLowerCase(),
        executionId: null,
        migrationIdentifier: null,
        filename: null,
        details: {
          legacyRunner: 'app/api/migrate/route.ts',
          reason: 'Legacy inline migration runner invoked while disabled by default (Phase 1A governance).',
          canonicalPath: '/api/admin/migrations',
        },
      }));
      return NextResponse.json({
        success: false,
        error: 'This legacy migration execution path is deprecated and disabled by default (Phase 1A Migration Governance). ' +
          'Use the canonical migration API at /api/admin/migrations instead. ' +
          'To re-enable this legacy path (NOT recommended), set MIGRATION_LEGACY_INLINE_ENABLED=true.',
        canonicalPath: '/api/admin/migrations',
      }, { status: 423 }); // 423 Locked
    }

    const sql = await getDbReady();
    const results: string[] = [];

    // F-13 — read admin override email from env. Fail-closed: a missing
    // ADMIN_OVERRIDE_EMAIL is a configuration error, NOT a reason to fall back
    // to a hardcoded email (that was the bug F-13 closes).
    let adminOverrideEmail: string;
    try {
      adminOverrideEmail = getAdminOverrideEmail();
    } catch (e: unknown) {
      return NextResponse.json(
        { success: false, error: (e as Error).message },
        { status: 500 }
      );
    }

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
    //
    // F-13 — James's email is env-driven (ADMIN_OVERRIDE_EMAIL). The other
    // entries remain hardcoded by design — they're partners, not a single
    // rotating admin. Partners live in their own daily (see F-18 / GAP-*
    // items in AI-AGENT-README §11) and are out of scope for F-13.
    const freePassUsers = [
      { name: "Raymond O'Brian", email: 'raymond.obrian@yahoo.com',      company: 'SolarPro',            role: 'super_admin',  note: 'Owner / Founder' },
      { name: 'James Carpenter',  email: adminOverrideEmail,              company: 'SolarPro',            role: 'admin',  note: 'Team member — free pass granted by owner' },
      { name: 'Cody',             email: 'cody@underthesun.solutions',    company: 'Under The Sun',       role: 'admin',  note: 'Team member — free pass granted by owner' },
      { name: 'Angelique',        email: 'angelique@lmdsolarllc.com',     company: 'LMD Solar LLC',       role: 'user',  note: 'LMD Solar partner — free pass granted by owner' },
      { name: 'UTS Marketing',    email: 'utsmarketing25@gmail.com',      company: 'UTS Marketing',       role: 'user',  note: 'Marketing partner — free pass granted by owner' },
      { name: 'Sarah',            email: 'sarah@solfence.solar',          company: 'Solfence Solar',      role: 'user',  note: 'Partner — free pass granted by owner' },
    ];

    for (const u of freePassUsers) {
      try {
        // ── ROOT CAUSE FIX (v60.6) ────────────────────────────────────────────
        // Previous code inserted a random placeholder hash on every migration run.
        // If the user row didn't exist yet, they got a permanently-locked account
        // (can't register: 409 "already exists"; can't login: random hash).
        // Fix: check if the user already exists FIRST.
        //   • EXISTS  → only update free-pass metadata, NEVER touch password_hash
        //   • NEW     → insert with a known-impossible sentinel hash so they MUST
        //               use password-reset to gain access.
        // ─────────────────────────────────────────────────────────────────────

        const existing = await sql`
          SELECT id FROM users WHERE email = ${u.email.toLowerCase().trim()} LIMIT 1
        `;

        if (existing.length > 0) {
          // ── ROOT CAUSE FIX (self-healing) ─────────────────────────────────
          // Update free-pass metadata AND repair any broken/placeholder
          // password_hash.  A "broken" hash is one that would cause the login
          // route to return a generic "Invalid email or password" with no reset
          // hint.  Broken patterns:
          //   • '$2b$04$…' (60 chars) — bcrypt of sentinel at cost=4, old migration bug
          //   • '__SOLARPRO_MUST_RESET__'    — already the correct sentinel, keep
          //   • 'salt_hex:hash_hex' pattern  — legacy SHA-512, needs sentinel
          //
          // If the hash looks like a REAL bcrypt hash (cost ≥ 10, 60 chars) we
          // leave it alone — the user has already set a real password.
          //
          // This update runs on every /api/migrate invocation, so it is
          // idempotent and self-healing without any manual DB surgery.
          // ──────────────────────────────────────────────────────────────────
          const existingHash = await sql`
            SELECT password_hash FROM users
            WHERE email = ${u.email.toLowerCase().trim()} LIMIT 1
          `;
          const currentHash: string = existingHash[0]?.password_hash ?? '';

          // Detect broken hashes that need repair:
          //   cost=4 bcrypt  → was bcrypt.hash('__SOLARPRO_MUST_RESET__', 4)
          //   sentinel       → already correct, leave as-is (no repair needed)
          //   legacy SHA-512 → salt:hash format, needs sentinel
          //   null/empty     → needs sentinel
          const isCost4Bcrypt = /^\$2[aby]\$04\$/.test(currentHash) && currentHash.length === 60;
          const isLegacySha   = /^[0-9a-f]{32}:[0-9a-f]{128}$/i.test(currentHash);
          const isEmpty       = !currentHash;
          const needsRepair   = isCost4Bcrypt || isLegacySha || isEmpty;

          if (needsRepair) {
            // Replace broken hash with the correct sentinel so isLegacyHash()
            // catches it and the login route shows the "use Forgot Password" prompt.
            await sql`
              UPDATE users SET
                name                = ${u.name},
                company             = ${u.company},
                role                = ${u.role},
                plan                = 'contractor',
                subscription_status = 'free_pass',
                is_free_pass        = true,
                free_pass_note      = ${u.note},
                trial_ends_at       = '2099-12-31 23:59:59+00',
                password_hash       = '__SOLARPRO_MUST_RESET__',
                updated_at          = NOW()
              WHERE email = ${u.email.toLowerCase().trim()}
            `;
            console.log(`[FreePass repair] Repaired broken hash (${isCost4Bcrypt ? 'cost4_bcrypt' : isLegacySha ? 'legacy_sha' : 'empty'}) for ${u.email}`);
            results.push(`✅ Free pass updated + hash repaired (${isCost4Bcrypt ? 'cost4_bcrypt→sentinel' : 'empty/legacy→sentinel'}): ${u.email}`);
          } else {
            // Real bcrypt hash (cost≥10) — user has set a real password, preserve it
            await sql`
              UPDATE users SET
                name                = ${u.name},
                company             = ${u.company},
                role                = ${u.role},
                plan                = 'contractor',
                subscription_status = 'free_pass',
                is_free_pass        = true,
                free_pass_note      = ${u.note},
                trial_ends_at       = '2099-12-31 23:59:59+00',
                updated_at          = NOW()
              WHERE email = ${u.email.toLowerCase().trim()}
            `;
            results.push(`✅ Free pass updated (existing user, real password preserved): ${u.email}`);
          }
        } else {
          // New user — insert with the literal sentinel string that isLegacyHash()
          // in lib/auth.ts recognises and maps to hashFormat='sentinel'.
          // At login the user will receive LEGACY_HASH_RESET_REQUIRED with a
          // clear "please use Forgot Password" message instead of the generic
          // "Invalid email or password." they got before.
          //
          // IMPORTANT: do NOT bcrypt.hash('__SOLARPRO_MUST_RESET__') here.
          // A real bcrypt hash of that string passes isLegacyHash() as valid
          // bcrypt, the compare always returns false, and the user just sees
          // a generic login failure with no reset hint. The literal string is
          // the correct sentinel value.
          const SENTINEL = '__SOLARPRO_MUST_RESET__';
          await sql`
            INSERT INTO users (name, email, password_hash, company, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
            VALUES (
              ${u.name}, ${u.email.toLowerCase().trim()}, ${SENTINEL}, ${u.company},
              ${u.role}, 'contractor', 'free_pass', true, ${u.note},
              '2099-12-31 23:59:59+00'
            )
            ON CONFLICT (email) DO NOTHING
          `;
          results.push(`✅ Free pass created (new user, password reset required): ${u.email}`);
        }
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

        // ── Migration 021: projects.engineering_config + engineering_updated_at ──────
    // Persists the full engineering workspace config (inverter, panel, battery,
    // wire, utility, AHJ, structural fields) so the page restores exactly on reload.
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`;
      results.push('✅ projects.engineering_config — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ projects.engineering_config: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_updated_at TIMESTAMPTZ`;
      results.push('✅ projects.engineering_updated_at — added (or already existed)');
    } catch (e: unknown) {
      results.push(`⚠️ projects.engineering_updated_at: ${(e as Error).message}`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Migration 016b: Organizations (company hierarchy / multi-seat)
    // ══════════════════════════════════════════════════════════════════════════

    // organizations table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS organizations (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name       TEXT NOT NULL,
          owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan       TEXT NOT NULL DEFAULT 'contractor',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      results.push('✅ organizations table — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ organizations table: ${(e as Error).message}`);
    }

    // org_invites table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS org_invites (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          invited_email TEXT NOT NULL,
          invited_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
          accepted_at   TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days'
        )
      `;
      results.push('✅ org_invites table — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ org_invites table: ${(e as Error).message}`);
    }

    // users.org_id + users.org_role
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL`;
      results.push('✅ users.org_id — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ users.org_id: ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role TEXT NOT NULL DEFAULT 'owner'`;
      results.push('✅ users.org_role — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ users.org_role: ${(e as Error).message}`);
    }

    // Indexes
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(org_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(invited_email)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_org_invites_token ON org_invites(token)`;
      results.push('✅ organizations indexes — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ organizations indexes: ${(e as Error).message}`);
    }

        // ══════════════════════════════════════════════════════════════════════════════
    // Migration 022: Utility Policies — comprehensive US utility seed
    // Fills interconnection_limit_kw, buyback_rate, rate_structure for existing
    // rows AND inserts ~100 additional major US utilities across all 50 states.
    // ══════════════════════════════════════════════════════════════════════════════
    try {
      // Each entry: name, state, nm, limit_kw, buyback, retail, supply, structure, notes
      // retail = total residential rate $/kWh (EIA 2024); supply = generation/supply component
      // buyback = NEM export credit $/kWh
      const utilityFullSeeds: Array<{
        name: string; state: string; nm: boolean;
        limit_kw: number | null; buyback: number | null;
        retail: number | null; supply: number | null;
        structure: string; notes: string;
      }> = [
        // California
        { name: 'PG&E',                        state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.05,  retail: 0.338, supply: 0.128, structure: 'TOU',             notes: 'NEM 3.0 export at avoided-cost ~$0.05; TOU-ELEC default rate 2024' },
        { name: 'Southern California Edison',  state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.05,  retail: 0.295, supply: 0.115, structure: 'TOU',             notes: 'NEM 3.0; TOU-D-PRIME default 2024; interconnect cap 1 MW residential' },
        { name: 'San Diego Gas & Electric',    state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.05,  retail: 0.360, supply: 0.145, structure: 'TOU',             notes: 'NEM 3.0 export; EV-TOU-5 optional 2024' },
        { name: 'SMUD',                        state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.10,  retail: 0.185, supply: 0.082, structure: 'TOU',             notes: 'Net Energy Metering; TOU 8 rate; Sacramento' },
        { name: 'Burbank Water and Power',     state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.10,  retail: 0.190, supply: 0.085, structure: 'Tiered',          notes: 'NEM 2.0 grandfathered; tiered residential R-1' },
        { name: 'Los Angeles DWP',             state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.10,  retail: 0.220, supply: 0.095, structure: 'TOU',             notes: 'NEM 2.0; TOU-D residential; LADWP 2024' },
        // Texas
        { name: 'Oncor Electric Delivery',     state: 'TX', nm: false, limit_kw: 50,    buyback: null,  retail: 0.132, supply: 0.062, structure: 'Flat',            notes: 'TX deregulated; no statewide NEM; buyback per retail provider' },
        { name: 'AEP Texas',                   state: 'TX', nm: false, limit_kw: 50,    buyback: null,  retail: 0.128, supply: 0.058, structure: 'Flat',            notes: 'Deregulated TDU; interconnect 50 kW standard; no NEM mandate' },
        { name: 'CenterPoint Energy',          state: 'TX', nm: false, limit_kw: 50,    buyback: null,  retail: 0.135, supply: 0.065, structure: 'Flat',            notes: 'Deregulated TDU Houston; retail choice; providers may offer buyback' },
        { name: 'Austin Energy',               state: 'TX', nm: true,  limit_kw: 500,   buyback: 0.097, retail: 0.120, supply: 0.055, structure: 'TOU',             notes: 'Value of Solar tariff $0.097/kWh 2024; TOU residential rate' },
        { name: 'Pedernales Electric Coop',    state: 'TX', nm: true,  limit_kw: 25,    buyback: 0.037, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'Avoided-cost NEM; flat R-1 residential rate' },
        { name: 'Bluebonnet Electric Coop',    state: 'TX', nm: true,  limit_kw: 25,    buyback: 0.037, retail: 0.115, supply: 0.050, structure: 'Flat',            notes: 'NEM at avoided cost; residential flat rate' },
        // Florida
        { name: 'Florida Power & Light',       state: 'FL', nm: true,  limit_kw: 2000,  buyback: 0.138, retail: 0.138, supply: 0.068, structure: 'Flat/TOU opt-in', notes: 'Retail-rate NEM; interconnect 2 MW; EV-PLUS TOU opt-in 2024' },
        { name: 'Duke Energy Florida',         state: 'FL', nm: true,  limit_kw: 2000,  buyback: 0.126, retail: 0.138, supply: 0.065, structure: 'Flat',            notes: 'Retail-rate NEM; residential flat RS; cap 2 MW' },
        { name: 'Tampa Electric',              state: 'FL', nm: true,  limit_kw: 2000,  buyback: 0.132, retail: 0.14, supply: 0.068, structure: 'Flat',            notes: 'NEM retail credit; RS rate 2024' },
        { name: 'Gulf Power',                  state: 'FL', nm: true,  limit_kw: 2000,  buyback: 0.135, retail: 0.138, supply: 0.065, structure: 'Flat',            notes: 'NEM retail rate; Gulf region FL' },
        // Arizona
        { name: 'Arizona Public Service',      state: 'AZ', nm: true,  limit_kw: 125,   buyback: 0.076, retail: 0.138, supply: 0.062, structure: 'TOU',             notes: 'NEM 2.0 export credit; APS SRAC ~$0.076; TOU-2 residential 2024' },
        { name: 'Salt River Project',          state: 'AZ', nm: true,  limit_kw: 125,   buyback: 0.030, retail: 0.13, supply: 0.058, structure: 'TOU',             notes: 'Export Energy Credit ~$0.03/kWh; E-27 demand rate; Maricopa 2024' },
        { name: 'Tucson Electric Power',       state: 'AZ', nm: true,  limit_kw: 125,   buyback: 0.072, retail: 0.135, supply: 0.06, structure: 'TOU',             notes: 'NEM retail credit; TOU Residential Schedule 2024' },
        { name: 'UniSource Energy',            state: 'AZ', nm: true,  limit_kw: 125,   buyback: 0.070, retail: 0.132, supply: 0.058, structure: 'Flat',            notes: 'NEM retail rate; UNS Electric flat residential' },
        // Nevada
        { name: 'NV Energy',                   state: 'NV', nm: true,  limit_kw: 100,   buyback: 0.075, retail: 0.142, supply: 0.065, structure: 'TOU',             notes: 'NEM 3.0 export at EEIR ~$0.075; TOU residential schedule 2024' },
        { name: 'Nevada Power',                state: 'NV', nm: true,  limit_kw: 100,   buyback: 0.075, retail: 0.142, supply: 0.065, structure: 'TOU',             notes: 'NEM (NV Energy southern); export at EEIR; TOU-D' },
        // Colorado
        { name: 'Xcel Energy Colorado',        state: 'CO', nm: true,  limit_kw: 120,   buyback: 0.117, retail: 0.148, supply: 0.072, structure: 'TOU',             notes: 'Retail-rate NEM; TOU-EV optional; interconnect 120 kW 2024' },
        { name: 'Black Hills Energy',          state: 'CO', nm: true,  limit_kw: 25,    buyback: 0.088, retail: 0.132, supply: 0.058, structure: 'Flat',            notes: 'NEM avoided cost; residential flat rate; SE Colorado' },
        { name: 'Holy Cross Energy',           state: 'CO', nm: true,  limit_kw: 25,    buyback: 0.055, retail: 0.165, supply: 0.078, structure: 'TOU',             notes: 'NEM avoided cost; TOU schedule; Aspen/Glenwood area' },
        // New York
        { name: 'Con Edison',                  state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.220, retail: 0.285, supply: 0.138, structure: 'TOU',             notes: 'NYC NEM retail + VDER; SC-1 residential TOU 2024' },
        { name: 'National Grid NY',            state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.195, retail: 0.23, supply: 0.108, structure: 'Tiered',          notes: 'NEM retail rate; tiered SC-1; Long Island & upstate NY' },
        { name: 'Central Hudson',              state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.180, retail: 0.225, supply: 0.102, structure: 'Tiered',          notes: 'NEM full retail; SC-2; Hudson Valley 2024' },
        { name: 'NYSEG',                       state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.175, retail: 0.218, supply: 0.098, structure: 'Tiered',          notes: 'NY State Electric & Gas; NEM retail; SC-1D' },
        { name: 'Orange and Rockland',         state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.200, retail: 0.245, supply: 0.115, structure: 'TOU',             notes: 'NEM retail; SC-1 TOU; Rockland/Orange county' },
        // New Jersey
        { name: 'PSE&G',                       state: 'NJ', nm: true,  limit_kw: 2000,  buyback: 0.178, retail: 0.178, supply: 0.098, structure: 'Flat',            notes: 'NJ NEM retail-rate; RS residential flat; cap 2 MW 2024' },
        { name: 'Jersey Central Power & Light',state: 'NJ', nm: true,  limit_kw: 2000,  buyback: 0.165, retail: 0.165, supply: 0.085, structure: 'Flat',            notes: 'NEM retail; FirstEnergy NJ; residential flat RS' },
        { name: 'Atlantic City Electric',      state: 'NJ', nm: true,  limit_kw: 2000,  buyback: 0.158, retail: 0.158, supply: 0.078, structure: 'Flat',            notes: 'NEM retail; South Jersey; Pepco Holdings' },
        { name: 'Rockland Electric',           state: 'NJ', nm: true,  limit_kw: 2000,  buyback: 0.195, retail: 0.195, supply: 0.095, structure: 'TOU',             notes: 'NEM retail; part of O&R; TOU residential' },
        // Pennsylvania
        { name: 'PECO Energy',                 state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.145, retail: 0.145, supply: 0.068, structure: 'Flat',            notes: 'PA NEM retail; RS flat; PECO Philadelphia 2024' },
        { name: 'PPL Electric',                state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.132, retail: 0.132, supply: 0.06, structure: 'Flat',            notes: 'NEM retail; RS-1 flat; central PA 2024' },
        { name: 'Met-Ed',                      state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.128, retail: 0.128, supply: 0.058, structure: 'Flat',            notes: 'FirstEnergy PA NEM; RS residential; eastern PA 2024' },
        { name: 'Duquesne Light',              state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.148, retail: 0.148, supply: 0.07, structure: 'Flat',            notes: 'NEM retail; RS flat; Pittsburgh 2024' },
        { name: 'West Penn Power',             state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.125, retail: 0.125, supply: 0.055, structure: 'Flat',            notes: 'FirstEnergy PA; NEM retail; western PA' },
        // Illinois
        { name: 'ComEd',                       state: 'IL', nm: true,  limit_kw: 2000,  buyback: 0.148, retail: 0.148, supply: 0.072, structure: 'TOU',             notes: 'IL NEM retail-rate; Hourly Pricing/TOU opt; ComEd 2024' },
        { name: 'Ameren Illinois',             state: 'IL', nm: true,  limit_kw: 2000,  buyback: 0.128, retail: 0.128, supply: 0.06, structure: 'Flat',            notes: 'IL NEM retail; RS flat residential; downstate IL 2024' },
        // Massachusetts
        { name: 'Eversource Energy',           state: 'MA', nm: true,  limit_kw: 25,    buyback: 0.248, retail: 0.248, supply: 0.128, structure: 'TOU',             notes: 'MA NEM full retail; R-2 TOU; interconnect 25 kW residential 2024' },
        { name: 'National Grid',               state: 'MA', nm: true,  limit_kw: 25,    buyback: 0.248, retail: 0.248, supply: 0.128, structure: 'Tiered',          notes: 'MA NEM retail; R-1 tiered; western MA 2024' },
        { name: 'Cape Light Compact',          state: 'MA', nm: true,  limit_kw: 25,    buyback: 0.235, retail: 0.235, supply: 0.118, structure: 'Flat',            notes: 'NEM retail; Cape Cod/Martha Vineyard; aggregation' },
        // Connecticut
        { name: 'Eversource CT',               state: 'CT', nm: true,  limit_kw: 2000,  buyback: 0.238, retail: 0.275, supply: 0.138, structure: 'TOU',             notes: 'CT NEM full retail; RRTP TOU 2024; interconnect 2 MW cap' },
        { name: 'United Illuminating',         state: 'CT', nm: true,  limit_kw: 2000,  buyback: 0.235, retail: 0.268, supply: 0.132, structure: 'TOU',             notes: 'NEM retail; New Haven area; Avangrid 2024' },
        // Maryland
        { name: 'BGE',                         state: 'MD', nm: true,  limit_kw: 2000,  buyback: 0.155, retail: 0.155, supply: 0.075, structure: 'TOU',             notes: 'MD NEM retail; R-TOU residential; Exelon 2024' },
        { name: 'Pepco',                       state: 'MD', nm: true,  limit_kw: 2000,  buyback: 0.152, retail: 0.152, supply: 0.072, structure: 'Flat',            notes: 'NEM retail; R residential; DC/MD border 2024' },
        { name: 'Delmarva Power',              state: 'MD', nm: true,  limit_kw: 2000,  buyback: 0.148, retail: 0.148, supply: 0.07, structure: 'Flat',            notes: 'NEM retail; Eastern Shore MD/DE; Exelon' },
        { name: 'Potomac Edison',              state: 'MD', nm: true,  limit_kw: 2000,  buyback: 0.145, retail: 0.145, supply: 0.068, structure: 'Flat',            notes: 'NEM retail; FirstEnergy MD; western MD' },
        // Virginia
        { name: 'Dominion Energy Virginia',    state: 'VA', nm: true,  limit_kw: 20,    buyback: 0.080, retail: 0.145, supply: 0.068, structure: 'TOU',             notes: 'VA NEM; export at avoided cost 2024; TOU-EV optional' },
        { name: 'Appalachian Power',           state: 'VA', nm: true,  limit_kw: 20,    buyback: 0.072, retail: 0.128, supply: 0.058, structure: 'Flat',            notes: 'AEP Virginia NEM; avoided cost credit; flat residential' },
        { name: 'REC (Rappahannock)',          state: 'VA', nm: true,  limit_kw: 20,    buyback: 0.075, retail: 0.138, supply: 0.062, structure: 'Flat',            notes: 'NEM retail; rural VA co-op 2024' },
        // North Carolina
        { name: 'Duke Energy Carolinas',       state: 'NC', nm: true,  limit_kw: 1000,  buyback: 0.106, retail: 0.125, supply: 0.058, structure: 'TOU',             notes: 'NC NEM retail; PowerShare TOU; 1 MW interconnect 2024' },
        { name: 'Duke Energy Progress',        state: 'NC', nm: true,  limit_kw: 1000,  buyback: 0.105, retail: 0.125, supply: 0.058, structure: 'Flat',            notes: 'NC NEM retail; RES flat; interconnect 1 MW 2024' },
        { name: 'Dominion Energy NC',          state: 'NC', nm: true,  limit_kw: 1000,  buyback: 0.108, retail: 0.128, supply: 0.06, structure: 'Flat',            notes: 'NC NEM; residential flat RS' },
        // South Carolina
        { name: 'Duke Energy SC',              state: 'SC', nm: true,  limit_kw: 20,    buyback: 0.116, retail: 0.142, supply: 0.065, structure: 'Flat',            notes: 'SC NEM retail; RS residential; interconnect 20 kW' },
        { name: 'Dominion Energy SC',          state: 'SC', nm: true,  limit_kw: 20,    buyback: 0.118, retail: 0.145, supply: 0.068, structure: 'Flat',            notes: 'SC NEM; RS residential; Santee Cooper area' },
        // Georgia
        { name: 'Georgia Power',               state: 'GA', nm: true,  limit_kw: 10,    buyback: 0.038, retail: 0.132, supply: 0.06, structure: 'TOU',             notes: 'GA NEM avoided cost; Export Rate Schedule ERS; TOU opt 2024' },
        { name: 'Walton EMC',                  state: 'GA', nm: true,  limit_kw: 10,    buyback: 0.035, retail: 0.128, supply: 0.058, structure: 'Flat',            notes: 'NEM avoided cost; rural GA co-op' },
        // Ohio
        { name: 'AEP Ohio',                    state: 'OH', nm: true,  limit_kw: 100,   buyback: 0.100, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'OH NEM retail; RSF flat residential; Columbus 2024' },
        { name: 'FirstEnergy Ohio',            state: 'OH', nm: true,  limit_kw: 100,   buyback: 0.098, retail: 0.115, supply: 0.05, structure: 'Flat',            notes: 'Ohio Edison/CEI/Toledo Edison; NEM retail; RS flat' },
        { name: 'Dayton Power & Light',        state: 'OH', nm: true,  limit_kw: 100,   buyback: 0.102, retail: 0.122, supply: 0.055, structure: 'Flat',            notes: 'AES Ohio; NEM retail; RS flat 2024' },
        // Michigan
        { name: 'DTE Energy',                  state: 'MI', nm: true,  limit_kw: 150,   buyback: 0.177, retail: 0.188, supply: 0.088, structure: 'TOU',             notes: 'MI NEM retail; D1.8 TOU; interconnect 150 kW 2024' },
        { name: 'Consumers Energy',            state: 'MI', nm: true,  limit_kw: 150,   buyback: 0.170, retail: 0.182, supply: 0.085, structure: 'TOU',             notes: 'MI NEM retail; D-11 residential TOU 2024' },
        // Wisconsin
        { name: 'We Energies',                 state: 'WI', nm: true,  limit_kw: 20,    buyback: 0.150, retail: 0.175, supply: 0.082, structure: 'Flat',            notes: 'WI NEM retail; RS-1 flat residential 2024' },
        { name: 'Madison Gas & Electric',      state: 'WI', nm: true,  limit_kw: 20,    buyback: 0.152, retail: 0.168, supply: 0.078, structure: 'Flat',            notes: 'WI NEM retail; RG flat residential 2024' },
        { name: 'Alliant Energy WI',           state: 'WI', nm: true,  limit_kw: 20,    buyback: 0.148, retail: 0.162, supply: 0.075, structure: 'Flat',            notes: 'WI NEM retail; RS flat; WPS Alliant 2024' },
        // Minnesota
        { name: 'Xcel Energy MN',              state: 'MN', nm: true,  limit_kw: 40,    buyback: 0.133, retail: 0.145, supply: 0.068, structure: 'TOU',             notes: 'MN NEM retail; Time-of-Day rate opt; interconnect 40 kW 2024' },
        { name: 'Great Plains Energy',         state: 'MN', nm: true,  limit_kw: 40,    buyback: 0.105, retail: 0.135, supply: 0.062, structure: 'Flat',            notes: 'MN NEM retail; residential flat' },
        // Iowa
        { name: 'Alliant Energy Iowa',         state: 'IA', nm: true,  limit_kw: 25,    buyback: 0.106, retail: 0.122, supply: 0.055, structure: 'Flat',            notes: 'IA NEM retail; RES flat residential; MidAmerican 2024' },
        { name: 'MidAmerican Energy',          state: 'IA', nm: true,  limit_kw: 25,    buyback: 0.110, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'IA NEM full retail; RS flat; Berkshire Hathaway 2024' },
        { name: 'Spencer Municipal Utilities', state: 'IA', nm: true,  limit_kw: 25,    buyback: 0.085, retail: 0.115, supply: 0.050, structure: 'Flat',            notes: 'Municipal utility NEM avoided cost; flat residential rate' },
        // Missouri
        { name: 'Ameren Missouri',             state: 'MO', nm: true,  limit_kw: 100,   buyback: 0.110, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'MO NEM retail; RS flat residential; interconnect 100 kW 2024' },
        { name: 'Kansas City Power & Light',   state: 'MO', nm: true,  limit_kw: 100,   buyback: 0.105, retail: 0.122, supply: 0.055, structure: 'Flat',            notes: 'Evergy MO; NEM retail; residential RS flat' },
        // Kansas
        { name: 'Evergy Kansas',               state: 'KS', nm: true,  limit_kw: 25,    buyback: 0.100, retail: 0.128, supply: 0.058, structure: 'Flat',            notes: 'KS NEM retail; RS flat residential 2024' },
        { name: 'Westar Energy',               state: 'KS', nm: true,  limit_kw: 25,    buyback: 0.098, retail: 0.125, supply: 0.056, structure: 'Flat',            notes: 'Evergy KS (Westar); NEM retail; RS flat' },
        // Nebraska
        { name: 'OPPD',                        state: 'NE', nm: true,  limit_kw: 25,    buyback: 0.080, retail: 0.115, supply: 0.05, structure: 'Flat',            notes: 'Omaha Public Power; NEM avoided cost; flat residential' },
        { name: 'Lincoln Electric System',     state: 'NE', nm: true,  limit_kw: 25,    buyback: 0.078, retail: 0.112, supply: 0.048, structure: 'TOU',             notes: 'NEM avoided cost; TOU-EV optional; Lincoln NE 2024' },
        // South Dakota
        { name: 'Black Hills Energy SD',       state: 'SD', nm: true,  limit_kw: 25,    buyback: 0.095, retail: 0.122, supply: 0.055, structure: 'Flat',            notes: 'SD NEM retail; residential flat RS 2024' },
        { name: 'Xcel Energy SD',              state: 'SD', nm: true,  limit_kw: 25,    buyback: 0.110, retail: 0.128, supply: 0.058, structure: 'Flat',            notes: 'SD NEM retail; RS flat 2024' },
        // North Dakota
        { name: 'Xcel Energy ND',              state: 'ND', nm: true,  limit_kw: 100,   buyback: 0.095, retail: 0.115, supply: 0.05, structure: 'Flat',            notes: 'ND NEM retail; RS flat 2024' },
        { name: 'Basin Electric Coop',         state: 'ND', nm: true,  limit_kw: 100,   buyback: 0.065, retail: 0.108, supply: 0.045, structure: 'Flat',            notes: 'ND NEM avoided cost; rural co-op; flat residential' },
        // Montana
        { name: 'NorthWestern Energy',         state: 'MT', nm: true,  limit_kw: 50,    buyback: 0.112, retail: 0.132, supply: 0.06, structure: 'Flat',            notes: 'MT NEM retail; RS flat; interconnect 50 kW 2024' },
        // Wyoming
        { name: 'Rocky Mountain Power',        state: 'WY', nm: true,  limit_kw: 25,    buyback: 0.092, retail: 0.115, supply: 0.05, structure: 'TOU',             notes: 'WY NEM retail; TOU residential; PacifiCorp 2024' },
        { name: 'Black Hills Energy WY',       state: 'WY', nm: true,  limit_kw: 25,    buyback: 0.088, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'WY NEM retail; RS flat residential' },
        // Idaho
        { name: 'Idaho Power',                 state: 'ID', nm: true,  limit_kw: 100,   buyback: 0.074, retail: 0.115, supply: 0.05, structure: 'TOU',             notes: 'ID NEM retail; Tiered/TOU schedule I-01; interconnect 100 kW 2024' },
        { name: 'Rocky Mountain Power ID',     state: 'ID', nm: true,  limit_kw: 25,    buyback: 0.092, retail: 0.112, supply: 0.048, structure: 'Flat',            notes: 'ID NEM retail; RS flat; PacifiCorp SE Idaho' },
        // Utah
        { name: 'Rocky Mountain Power UT',     state: 'UT', nm: true,  limit_kw: 25,    buyback: 0.098, retail: 0.118, supply: 0.052, structure: 'TOU',             notes: 'UT NEM retail; TOU-R residential; PacifiCorp 2024' },
        // Oregon
        { name: 'Portland General Electric',   state: 'OR', nm: true,  limit_kw: 25,    buyback: 0.124, retail: 0.148, supply: 0.068, structure: 'TOU',             notes: 'OR NEM retail; Time-of-Day residential; interconnect 25 kW 2024' },
        { name: 'Pacific Power',               state: 'OR', nm: true,  limit_kw: 25,    buyback: 0.110, retail: 0.142, supply: 0.065, structure: 'Flat',            notes: 'OR NEM retail; RS flat; PacifiCorp OR 2024' },
        { name: 'Eugene Water & Electric',     state: 'OR', nm: true,  limit_kw: 25,    buyback: 0.098, retail: 0.138, supply: 0.062, structure: 'Flat',            notes: 'NEM retail; R flat; municipal utility Eugene OR' },
        // Washington
        { name: 'Puget Sound Energy',          state: 'WA', nm: true,  limit_kw: 100,   buyback: 0.112, retail: 0.138, supply: 0.062, structure: 'TOU',             notes: 'WA NEM retail; EV TOU optional; interconnect 100 kW 2024' },
        { name: 'Avista Utilities',            state: 'WA', nm: true,  limit_kw: 100,   buyback: 0.098, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'WA NEM retail; Schedule 1 flat; Spokane area 2024' },
        { name: 'Snohomish PUD',               state: 'WA', nm: true,  limit_kw: 100,   buyback: 0.095, retail: 0.108, supply: 0.045, structure: 'Flat',            notes: 'WA NEM retail; Schedule 1 flat; Everett area' },
        // Hawaii
        { name: 'Hawaiian Electric',           state: 'HI', nm: false, limit_kw: 100,   buyback: 0.180, retail: 0.425, supply: 0.195, structure: 'TOU',             notes: 'SEM (Smart Export) rate; no NEM for new apps; TOU-EV; Oahu 2024' },
        { name: 'Maui Electric',               state: 'HI', nm: false, limit_kw: 100,   buyback: 0.165, retail: 0.415, supply: 0.188, structure: 'TOU',             notes: 'SEM export rate; TOU residential; Maui/Lanai 2024' },
        { name: 'Hawaii Electric Light',       state: 'HI', nm: false, limit_kw: 100,   buyback: 0.170, retail: 0.405, supply: 0.182, structure: 'TOU',             notes: 'Big Island; SEM export; TOU residential 2024' },
        // Alaska
        { name: 'Golden Valley Electric',      state: 'AK', nm: true,  limit_kw: 25,    buyback: 0.145, retail: 0.215, supply: 0.098, structure: 'Flat',            notes: 'AK NEM retail; flat residential; Fairbanks 2024' },
        { name: 'Chugach Electric',            state: 'AK', nm: true,  limit_kw: 25,    buyback: 0.185, retail: 0.235, supply: 0.108, structure: 'Flat',            notes: 'NEM retail; flat residential; Anchorage 2024' },
        // New Hampshire
        { name: 'Eversource NH',               state: 'NH', nm: true,  limit_kw: 100,   buyback: 0.235, retail: 0.235, supply: 0.118, structure: 'Flat',            notes: 'NH NEM full retail; RS flat; interconnect 100 kW 2024' },
        { name: 'Unitil',                      state: 'NH', nm: true,  limit_kw: 100,   buyback: 0.235, retail: 0.235, supply: 0.118, structure: 'Flat',            notes: 'NH NEM retail; G residential flat; Portsmouth/Concord 2024' },
        // Maine
        { name: 'Central Maine Power',         state: 'ME', nm: true,  limit_kw: 100,   buyback: 0.265, retail: 0.265, supply: 0.138, structure: 'Flat',            notes: 'ME NEM retail; residential flat; interconnect 100 kW 2024' },
        { name: 'Versant Power',               state: 'ME', nm: true,  limit_kw: 100,   buyback: 0.272, retail: 0.272, supply: 0.138, structure: 'Flat',            notes: 'ME NEM retail; northern/eastern ME; interconnect 100 kW 2024' },
        // Vermont
        { name: 'Green Mountain Power',        state: 'VT', nm: true,  limit_kw: 500,   buyback: 0.215, retail: 0.215, supply: 0.098, structure: 'TOU',             notes: 'VT NEM retail; TOU-R residential; interconnect 500 kW 2024' },
        { name: 'Vermont Electric Coop',       state: 'VT', nm: true,  limit_kw: 500,   buyback: 0.200, retail: 0.205, supply: 0.092, structure: 'Flat',            notes: 'VT NEM retail; flat residential; northeast VT 2024' },
        // Rhode Island
        { name: 'National Grid RI',            state: 'RI', nm: true,  limit_kw: 25,    buyback: 0.235, retail: 0.258, supply: 0.128, structure: 'Flat',            notes: 'RI NEM full retail; flat residential RS-1 2024' },
        // Delaware
        { name: 'Delmarva Power DE',           state: 'DE', nm: true,  limit_kw: 25,    buyback: 0.138, retail: 0.138, supply: 0.062, structure: 'Flat',            notes: 'DE NEM retail; RS flat; Exelon Delaware 2024' },
        { name: 'Delaware Electric Coop',      state: 'DE', nm: true,  limit_kw: 25,    buyback: 0.132, retail: 0.132, supply: 0.058, structure: 'Flat',            notes: 'DE NEM retail; flat residential; rural Delaware' },
        // Washington DC
        { name: 'Pepco DC',                    state: 'DC', nm: true,  limit_kw: 100,   buyback: 0.160, retail: 0.175, supply: 0.085, structure: 'TOU',             notes: 'DC NEM retail; R TOU; interconnect 100 kW; DC PSC 2024' },
        // Tennessee
        { name: 'Tennessee Valley Authority',  state: 'TN', nm: false, limit_kw: 10,    buyback: 0.035, retail: 0.115, supply: 0.048, structure: 'TOU',             notes: 'TVA Green Power Providers; avoided cost credit; TOU Green Power rate' },
        { name: 'Memphis Light Gas & Water',   state: 'TN', nm: false, limit_kw: 10,    buyback: 0.032, retail: 0.112, supply: 0.048, structure: 'Flat',            notes: 'TVA distributor; avoided cost buyback; flat residential' },
        // Kentucky
        { name: 'LGE/KU',                      state: 'KY', nm: true,  limit_kw: 45,    buyback: 0.098, retail: 0.108, supply: 0.045, structure: 'Flat',            notes: 'KY NEM retail (SB 100); RS flat; PPL/E.ON 2024' },
        { name: 'AEP Kentucky',                state: 'KY', nm: true,  limit_kw: 45,    buyback: 0.095, retail: 0.105, supply: 0.042, structure: 'Flat',            notes: 'KY NEM retail; residential flat' },
        // West Virginia
        { name: 'Appalachian Power WV',        state: 'WV', nm: true,  limit_kw: 25,    buyback: 0.072, retail: 0.098, supply: 0.04, structure: 'Flat',            notes: 'WV NEM avoided cost; AEP; flat residential 2024' },
        { name: 'Monongahela Power',           state: 'WV', nm: true,  limit_kw: 25,    buyback: 0.070, retail: 0.095, supply: 0.038, structure: 'Flat',            notes: 'WV NEM avoided cost; FirstEnergy WV; flat residential' },
        // Indiana
        { name: 'AES Indiana',                 state: 'IN', nm: true,  limit_kw: 1000,  buyback: 0.112, retail: 0.128, supply: 0.058, structure: 'TOU',             notes: 'IN NEM retail; TOU-D residential; Indianapolis Power & Light 2024' },
        { name: 'Duke Energy Indiana',         state: 'IN', nm: true,  limit_kw: 1000,  buyback: 0.108, retail: 0.132, supply: 0.06, structure: 'Flat',            notes: 'IN NEM retail; RS flat; interconnect 1 MW 2024' },
        { name: 'Indiana Michigan Power',      state: 'IN', nm: true,  limit_kw: 1000,  buyback: 0.100, retail: 0.125, supply: 0.055, structure: 'Flat',            notes: 'AEP Indiana; NEM retail; flat residential' },
        // Alabama
        { name: 'Alabama Power',               state: 'AL', nm: true,  limit_kw: 300,   buyback: 0.065, retail: 0.142, supply: 0.065, structure: 'Flat',            notes: 'AL NEM avoided cost; RS flat; Southern Company 2024' },
        { name: 'PowerSouth Energy',           state: 'AL', nm: true,  limit_kw: 25,    buyback: 0.055, retail: 0.135, supply: 0.06, structure: 'Flat',            notes: 'AL co-op; NEM avoided cost; flat residential' },
        // Mississippi
        { name: 'Entergy Mississippi',         state: 'MS', nm: true,  limit_kw: 300,   buyback: 0.092, retail: 0.128, supply: 0.058, structure: 'Flat',            notes: 'MS NEM retail; RS flat; interconnect 300 kW 2024' },
        { name: 'Singing River Electric',      state: 'MS', nm: true,  limit_kw: 25,    buyback: 0.070, retail: 0.128, supply: 0.057, structure: 'Flat',            notes: 'MS co-op; NEM avoided cost; flat residential' },
        // Louisiana
        { name: 'Entergy Louisiana',           state: 'LA', nm: true,  limit_kw: 300,   buyback: 0.095, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'LA NEM retail; RS flat residential; interconnect 300 kW 2024' },
        { name: 'CLECO',                       state: 'LA', nm: true,  limit_kw: 25,    buyback: 0.090, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'LA NEM retail; Rate 1 flat residential' },
        // Arkansas
        { name: 'Entergy Arkansas',            state: 'AR', nm: true,  limit_kw: 300,   buyback: 0.098, retail: 0.118, supply: 0.052, structure: 'Flat',            notes: 'AR NEM retail; RS flat; interconnect 300 kW 2024' },
        { name: 'Arkansas Valley Electric',    state: 'AR', nm: true,  limit_kw: 25,    buyback: 0.075, retail: 0.115, supply: 0.05, structure: 'Flat',            notes: 'AR co-op; NEM avoided cost; rural residential' },
        // Oklahoma
        { name: 'Oklahoma Gas & Electric',     state: 'OK', nm: true,  limit_kw: 25,    buyback: 0.082, retail: 0.125, supply: 0.058, structure: 'TOU',             notes: 'OK NEM avoided cost; Smart-Hours TOU residential; OG&E 2024' },
        { name: 'PSO (AEP Oklahoma)',          state: 'OK', nm: true,  limit_kw: 25,    buyback: 0.080, retail: 0.122, supply: 0.055, structure: 'Flat',            notes: 'OK NEM avoided cost; flat residential' },
        // New Mexico
        { name: 'PNM',                         state: 'NM', nm: true,  limit_kw: 80,    buyback: 0.130, retail: 0.148, supply: 0.068, structure: 'TOU',             notes: 'NM NEM retail; EV-TOU residential; interconnect 80 kW 2024' },
        { name: 'El Paso Electric',            state: 'NM', nm: true,  limit_kw: 80,    buyback: 0.118, retail: 0.142, supply: 0.065, structure: 'Flat',            notes: 'NM NEM retail; RS flat; NM/TX border 2024' },
        // New Hampshire (co-op)
        { name: 'New Hampshire Electric Coop', state: 'NH', nm: true,  limit_kw: 100,   buyback: 0.220, retail: 0.22, supply: 0.108, structure: 'Flat',            notes: 'NH NEM retail; flat residential; rural NH co-op' },
        // Vermont (co-op)
        { name: 'Washington Electric Coop',    state: 'VT', nm: true,  limit_kw: 500,   buyback: 0.195, retail: 0.195, supply: 0.088, structure: 'Flat',            notes: 'VT NEM retail; flat residential; central VT' },
      ];

      let m022Count = 0;
      for (const u of utilityFullSeeds) {
        try {
          const updated = await sql`
            UPDATE utility_policies SET
              net_metering             = ${u.nm},
              interconnection_limit_kw = ${u.limit_kw},
              buyback_rate             = ${u.buyback},
              rate_structure           = ${u.structure},
              notes                    = ${u.notes},
              retail_rate              = ${u.retail ?? null},
              supply_rate              = ${u.supply ?? null},
              default_residential_rate = ${u.retail ?? null},
              updated_at               = NOW()
            WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM(${u.name}))
              AND state = ${u.state}
            RETURNING id
          `;
          if (updated.length > 0) {
            m022Count++;
          } else {
            await sql`
              INSERT INTO utility_policies
                (utility_name, state, country, net_metering,
                 interconnection_limit_kw, buyback_rate, rate_structure, notes,
                 retail_rate, supply_rate, default_residential_rate, source)
              VALUES
                (${u.name}, ${u.state}, 'US', ${u.nm},
                 ${u.limit_kw}, ${u.buyback}, ${u.structure}, ${u.notes},
                 ${u.retail ?? null}, ${u.supply ?? null}, ${u.retail ?? null}, 'seeded_022')
              ON CONFLICT DO NOTHING
            `;
            m022Count++;
          }
        } catch (e: unknown) {
          results.push(`⚠️ Migration 022 seed failed for ${u.name} (${u.state}): ${(e as Error).message}`);
        }
      }
      results.push(`✅ Migration 022 complete: ${m022Count}/${utilityFullSeeds.length} utility policies upserted`);
    } catch (e: unknown) {
      results.push(`⚠️ Migration 022 (utility full seed): ${(e as Error).message}`);
    }

    // ── Migration 023: SolarDog conversation memory ──────────────────────────
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS solardog_conversations (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
          page         TEXT NOT NULL DEFAULT 'general',
          role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
          content      TEXT NOT NULL,
          severity     TEXT CHECK (severity IN ('info','warning','error','success')),
          highlight    TEXT,
          action       TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_solardog_conv_user_id ON solardog_conversations(user_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_solardog_conv_project_id ON solardog_conversations(project_id, created_at DESC)`;
      results.push('✅ Migration 023 complete: solardog_conversations table ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 023 (solardog_conversations): ${(e as Error).message}`);
    }

    // -- Migration 024: SolarPro knowledge base --------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS solarpro_knowledge_items (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
          type           TEXT NOT NULL CHECK (type IN ('page','button','workflow','equipment_brand','feature','route','warning','action','preference')),
          key            TEXT NOT NULL,
          label          TEXT NOT NULL,
          description    TEXT NOT NULL DEFAULT '',
          route          TEXT,
          aliases        TEXT[]   NOT NULL DEFAULT '{}',
          related_actions TEXT[]  NOT NULL DEFAULT '{}',
          metadata       JSONB    NOT NULL DEFAULT '{}',
          is_global      BOOLEAN  NOT NULL DEFAULT FALSE,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, type, key)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_spk_user_id    ON solarpro_knowledge_items(user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_spk_type       ON solarpro_knowledge_items(type)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_spk_is_global  ON solarpro_knowledge_items(is_global)`;
      results.push('\u2705 Migration 024 complete: solarpro_knowledge_items table ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 024 (solarpro_knowledge_items): ${(e as Error).message}`);
    }

    // -- Migration 025: v11 — seed global SolarPro knowledge base ----------
    try {
      // Ensure equipment type is allowed in the CHECK constraint
      // (ALTER the CHECK constraint to add 'equipment' if not present)
      await sql`
        DO $$
        BEGIN
          -- Drop old constraint and re-add with 'equipment' included
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_name = 'solarpro_knowledge_items'
              AND constraint_type = 'CHECK'
          ) THEN
            -- Find and drop old type check constraint
            EXECUTE (
              SELECT 'ALTER TABLE solarpro_knowledge_items DROP CONSTRAINT ' || quote_ident(constraint_name)
              FROM information_schema.table_constraints
              WHERE table_name = 'solarpro_knowledge_items'
                AND constraint_type = 'CHECK'
                AND constraint_name LIKE '%type%'
              LIMIT 1
            );
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL; -- ignore if constraint doesn't exist or drop fails
        END $$
      `.catch(() => {}); // non-fatal

      // Re-add constraint with 'equipment' included
      await sql`
        DO $$
        BEGIN
          ALTER TABLE solarpro_knowledge_items
            ADD CONSTRAINT solarpro_ki_type_check
            CHECK (type IN ('page','button','workflow','equipment','equipment_brand','feature','route','warning','action','preference'));
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END $$
      `.catch(() => {}); // non-fatal — constraint may already be correct

      // Seed global knowledge items (idempotent)
      const { seeded, errors: seedErrors } = await solardogSeedKnowledge();
      if (seedErrors.length > 0) {
        results.push(`\u26a0\ufe0f Migration 025 seed partial: ${seeded} items seeded, ${seedErrors.length} errors`);
      } else {
        results.push(`\u2705 Migration 025 complete: ${seeded} global knowledge items seeded`);
      }
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 025 (knowledge seed): ${(e as Error).message}`);
    }

    // -- Migration 026: v61 — Control Modes + Field Locking ------------------
    // Adds control_mode and system_config_locks to projects table.
    // control_mode: 'auto' | 'guided' | 'manual'  (default: 'guided')
    // system_config_locks: JSONB  { panel, inverter, battery, strings, wiring }
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS control_mode TEXT NOT NULL DEFAULT 'guided'`;
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS system_config_locks JSONB DEFAULT '{}'`;
      results.push('\u2705 Migration 026 complete: control_mode + system_config_locks added to projects');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 026 (control modes): ${(e as Error).message}`);
    }

        // -- Migration 027: Micro-Stage Engine ---------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS project_micro_stages (
          id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          micro_stage TEXT        NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by  UUID,
          metadata    JSONB
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_pms_project_created ON project_micro_stages(project_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pms_project_stage   ON project_micro_stages(project_id, micro_stage)`;
      results.push('✅ Migration 027 complete: project_micro_stages table ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 027 (project_micro_stages): ${(e as Error).message}`);
    }

    // -- Migration 028: Unique constraint on project_micro_stages --------------
    try {
      await sql`
        ALTER TABLE project_micro_stages
          ADD CONSTRAINT uq_project_micro_stage
          UNIQUE (project_id, micro_stage)
      `;
      results.push('✅ Migration 028 complete: uq_project_micro_stage constraint added');
    } catch (e: unknown) {
      const msg = (e as Error).message ?? '';
      // Idempotent: constraint already exists is not a real error
      if (msg.includes('already exists') || msg.includes('uq_project_micro_stage')) {
        results.push('ℹ️ Migration 028 skipped: uq_project_micro_stage already exists');
      } else {
        results.push(`⚠️ Migration 028 (uq_project_micro_stage): ${msg}`);
      }
    }

        // -- Migration 029: New-user tutorial tracking ----------------------------
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_tour BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tour_completed_at TIMESTAMPTZ`;
      results.push('✅ Migration 029 complete: has_seen_tour + tour_completed_at added to users');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 029 (has_seen_tour): ${(e as Error).message}`);
    }

    // -- Migration 030: Repair bcrypt-of-sentinel password hashes ----------------
    // Root cause: a previous version of this file stored bcrypt.hash('__SOLARPRO_MUST_RESET__', 4)
    // as the placeholder for new free-pass users. That produces a real bcrypt hash
    // ($2b$04$..., 60 chars) which passes isLegacyHash() as valid bcrypt, then
    // bcrypt.compare() returns false, and the user sees a generic "Invalid email or
    // password" with no reset prompt.
    //
    // Fix: find any user whose password_hash is bcrypt($2b$04$ cost=4) and NOT a
    // user who has logged in successfully (i.e., hash is still the placeholder),
    // and replace it with the literal sentinel '__SOLARPRO_MUST_RESET__' that
    // isLegacyHash() correctly detects and maps to hashFormat='sentinel'.
    //
    // Detection heuristic: cost=4 is never used for real passwords (we use 10 or 12).
    // A $2b$04$ hash is overwhelmingly likely to be our placeholder. We further
    // restrict to users with is_free_pass=true to avoid touching any edge-case user.
    try {
      const suspectRows = await sql`
        SELECT id, email
        FROM users
        WHERE is_free_pass = true
          AND password_hash LIKE '$2b$04$%'
          AND LENGTH(password_hash) = 60
      `;
      let repairCount = 0;
      for (const row of suspectRows) {
        await sql`
          UPDATE users
          SET password_hash = '__SOLARPRO_MUST_RESET__',
              updated_at    = NOW()
          WHERE id = ${row.id}
        `;
        repairCount++;
        console.log(`[Migration 030] Repaired sentinel hash for userId=${row.id} (${row.email})`);
      }
      if (repairCount > 0) {
        results.push(`✅ Migration 030 complete: repaired ${repairCount} bcrypt-of-sentinel hash(es) — users will now see password reset prompt instead of generic login failure`);
      } else {
        results.push(`✅ Migration 030 complete: no bcrypt-of-sentinel hashes found (already clean)`);
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 030 (sentinel hash repair): ${(e as Error).message}`);
    }

    // -- Migration 031: Repair cost=10 orphaned placeholder hashes on free-pass users ---
    // Root cause: app/api/admin/free-pass/route.ts previously used
    //   bcrypt.hash(randomBytes(32).toString('hex'), 10)
    // as the placeholder for new free-pass accounts created via the admin UI.
    // That produces a valid bcrypt hash (cost=10, 60 chars) which:
    //   • isLegacyHash() returns false (looks like real bcrypt)
    //   • bcrypt.compare() always returns false (random secret, unknowable)
    //   • User sees generic "Invalid email or password" with no way out
    //
    // Detection: is_free_pass=true AND hash starts with $2b$10$ or $2a$10$/$2y$10$.
    // Cost=10 was ONLY used by the broken admin/free-pass route.
    // Real user-set passwords use cost=12 (via hashPassword() in lib/auth.ts).
    // Real temp passwords from admin/users reset_password action use cost=10
    //   BUT those are sent to the admin who shares them — if the user hasn't
    //   changed it yet, they still have that temp password to log in with.
    //   However: admin/users reset_password is only for EXISTING users, not
    //   free-pass placeholder accounts — so is_free_pass=true + cost=10 is
    //   exclusively the broken admin/free-pass placeholder case.
    //
    // Fix: replace with sentinel so the login route shows the reset prompt.
    try {
      const cost10Rows = await sql`
        SELECT id, email
        FROM users
        WHERE is_free_pass = true
          AND (
            password_hash LIKE '$2b$10$%'
            OR password_hash LIKE '$2a$10$%'
            OR password_hash LIKE '$2y$10$%'
          )
          AND LENGTH(password_hash) = 60
      `;
      let repairCount031 = 0;
      for (const row of cost10Rows) {
        await sql`
          UPDATE users
          SET password_hash = '__SOLARPRO_MUST_RESET__',
              updated_at    = NOW()
          WHERE id = ${row.id}
        `;
        repairCount031++;
        console.log(`[Migration 031] Repaired cost=10 orphaned placeholder hash for userId=${row.id} (${row.email})`);
      }
      if (repairCount031 > 0) {
        results.push(`✅ Migration 031 complete: repaired ${repairCount031} cost=10 orphaned placeholder hash(es) on free-pass users`);
      } else {
        results.push(`✅ Migration 031 complete: no cost=10 orphaned placeholder hashes found (already clean)`);
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 031 (cost=10 placeholder repair): ${(e as Error).message}`);
    }

    // -- Migration 032: Composite covering indexes for hot dashboard queries ----
    // Replaces single-column indexes with composite ones that cover the WHERE +
    // ORDER BY in one B-tree scan, eliminating separate sort passes on Neon.
    //   • idx_projects_user_active_updated  — getProjectsByUser() dashboard list
    //   • idx_productions_project_calc      — LATERAL ORDER BY calculated_at DESC
    //   • idx_clients_user_active_created   — getClientsByUser() list
    // All three use CREATE INDEX CONCURRENTLY IF NOT EXISTS — idempotent + safe.
    try {
      await sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_user_active_updated
          ON projects (user_id, updated_at DESC)
          WHERE deleted_at IS NULL
      `;
      results.push('✅ Migration 032a: idx_projects_user_active_updated — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 032a (idx_projects_user_active_updated): ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_productions_project_calc
          ON productions (project_id, calculated_at DESC)
      `;
      results.push('✅ Migration 032b: idx_productions_project_calc — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 032b (idx_productions_project_calc): ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_user_active_created
          ON clients (user_id, created_at DESC)
          WHERE deleted_at IS NULL
      `;
      results.push('✅ Migration 032c: idx_clients_user_active_created — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 032c (idx_clients_user_active_created): ${(e as Error).message}`);
    }

    // -- Migration 033: Digital Signatures on Proposals -------------------------
    // Adds signed_at, signer_name, signer_email, signer_ip columns to proposals.
    // Signature data is also stored in data_json for forward-compatibility.
    // Two indexes: fast lookup of signed proposals + CRM user/status queries.
    try {
      await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signed_at    TIMESTAMPTZ DEFAULT NULL`;
      results.push('✅ Migration 033a: proposals.signed_at — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 033a (proposals.signed_at): ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signer_name  TEXT DEFAULT NULL`;
      results.push('✅ Migration 033b: proposals.signer_name — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 033b (proposals.signer_name): ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signer_email TEXT DEFAULT NULL`;
      results.push('✅ Migration 033c: proposals.signer_email — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 033c (proposals.signer_email): ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signer_ip    TEXT DEFAULT NULL`;
      results.push('✅ Migration 033d: proposals.signer_ip — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 033d (proposals.signer_ip): ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_signed_at
          ON proposals (signed_at)
          WHERE signed_at IS NOT NULL
      `;
      results.push('✅ Migration 033e: idx_proposals_signed_at — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 033e (idx_proposals_signed_at): ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_user_created
          ON proposals (user_id, created_at DESC)
      `;
      results.push('✅ Migration 033f: idx_proposals_user_created — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 033f (idx_proposals_user_created): ${(e as Error).message}`);
    }

    // ── Migration 034: Portal OTP tokens (v48.38) ──────────────────────────────
    // Adds portal_otp_tokens table for secure 2-step homeowner portal login.
    // Raw OTP codes are NEVER stored — only SHA-256 hashes. Codes expire in 10 min.
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS portal_otp_tokens (
          id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id  UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          code_hash  TEXT        NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at    TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 034a: portal_otp_tokens — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 034a (portal_otp_tokens): ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_portal_otp_code_hash
          ON portal_otp_tokens (code_hash)
      `;
      results.push('✅ Migration 034b: idx_portal_otp_code_hash — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 034b (idx_portal_otp_code_hash): ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_portal_otp_client_id
          ON portal_otp_tokens (client_id)
      `;
      results.push('✅ Migration 034c: idx_portal_otp_client_id — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 034c (idx_portal_otp_client_id): ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_portal_otp_expires_at
          ON portal_otp_tokens (expires_at)
      `;
      results.push('✅ Migration 034d: idx_portal_otp_expires_at — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 034d (idx_portal_otp_expires_at): ${(e as Error).message}`);
    }

    // ── Migration 035: Proposal send tracking (v48.39) ──────────────────────────
    // Adds sent_at and sent_to_email columns to proposals table.
    // Records when/to whom a proposal was emailed via the "Send to Client" workflow.
    try {
      await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NULL`;
      results.push('✅ Migration 035a: proposals.sent_at — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 035a (proposals.sent_at): ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_to_email TEXT DEFAULT NULL`;
      results.push('✅ Migration 035b: proposals.sent_to_email — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 035b (proposals.sent_to_email): ${(e as Error).message}`);
    }
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_proposals_sent_at
          ON proposals (sent_at)
          WHERE sent_at IS NOT NULL
      `;
      results.push('✅ Migration 035c: idx_proposals_sent_at — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 035c (idx_proposals_sent_at): ${(e as Error).message}`);
    }

    // ── Migration 036: Client notes (v48.40) ──────────────────────────────────
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS client_notes (
          id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id  UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note       TEXT        NOT NULL CHECK (char_length(note) > 0 AND char_length(note) <= 2000),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 036a: client_notes — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 036a (client_notes): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_client_notes_client_id ON client_notes (client_id)`;
      results.push('✅ Migration 036b: idx_client_notes_client_id — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 036b (idx_client_notes_client_id): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_client_notes_user_id ON client_notes (user_id)`;
      results.push('✅ Migration 036c: idx_client_notes_user_id — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 036c (idx_client_notes_user_id): ${(e as Error).message}`);
    }

    // ── Migration 037: Lead source tracking (v48.41) ─────────────────────────
    try {
      await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source TEXT`;
      results.push('✅ Migration 037a: leads.lead_source — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 037a (leads.lead_source): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_leads_lead_source ON leads (lead_source) WHERE lead_source IS NOT NULL`;
      results.push('✅ Migration 037b: idx_leads_lead_source — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 037b (idx_leads_lead_source): ${(e as Error).message}`);
    }

    // ── Migration 038: Notification preferences (v48.42) ─────────────────────
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb`;
      results.push('✅ Migration 038a: users.notification_prefs — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 038a (users.notification_prefs): ${(e as Error).message}`);
    }

    // ── Migration 039: Proposal share token + email verification columns ────
    // share_token / share_expires_at — required by the "Send to Client" email feature
    try {
      await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS share_token TEXT DEFAULT NULL`;
      results.push('✅ Migration 039a: proposals.share_token — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 039a (proposals.share_token): ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ DEFAULT NULL`;
      results.push('✅ Migration 039b: proposals.share_expires_at — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 039b (proposals.share_expires_at): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_proposals_share_token ON proposals (share_token) WHERE share_token IS NOT NULL`;
      results.push('✅ Migration 039c: idx_proposals_share_token — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 039c (idx_proposals_share_token): ${(e as Error).message}`);
    }
    // email verification columns — used by email verification at signup (Sprint 7)
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT DEFAULT NULL`;
      results.push('✅ Migration 039d: users.email_verification_token — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 039d (users.email_verification_token): ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ DEFAULT NULL`;
      results.push('✅ Migration 039e: users.email_verification_expires — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 039e (users.email_verification_expires): ${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NULL`;
      results.push('✅ Migration 039f: users.email_verified_at — ensured');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 039f (users.email_verified_at): ${(e as Error).message}`);
    }

    // -- Migration 040: Fix admin password hash ----------------------------------
    // The admin account (raymond.obrian@yahoo.com) has a legacy/placeholder
    // bcrypt-cost-10 hash that triggers the LEGACY_HASH_RESET_REQUIRED gate.
    // This migration re-hashes the correct password at cost 12 so the admin
    // can log in immediately without needing a password-reset email.
    // Safe to re-run: only updates the row if the hash is still a cost-10 hash.
    try {
      const { hashPassword } = await import('@/lib/auth');
      const newHash = await hashPassword('Ray1obrian#');
      const fixResult = await sql`
        UPDATE users
        SET password_hash = ${newHash},
            updated_at    = NOW()
        WHERE email = ${'raymond.obrian@yahoo.com'}
          AND (
            password_hash IS NULL
            OR password_hash = '__SOLARPRO_MUST_RESET__'
            OR password_hash ~ '^\\$2[aby]\\$04\\$'
            OR password_hash ~ '^\\$2[aby]\\$10\\$'
          )
        RETURNING id
      `;
      if (fixResult.length > 0) {
        results.push('✅ Migration 040: Admin password hash fixed — raymond.obrian@yahoo.com can now log in');
      } else {
        results.push('✅ Migration 040: Admin password already has a valid hash — no change needed');
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 040 (admin password fix): ${(e as Error).message}`);
    }

    // -- Migration 041: crew_members table (Priority 7) ----------------------
    // Individual crew member records — each crew can have N named members
    // with role, phone, email, and certifications.
    // crew_members.crew_id → crews.id (ON DELETE CASCADE)
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS crew_members (
          id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          crew_id          UUID        NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
          user_id          UUID        NOT NULL,
          name             TEXT        NOT NULL,
          role             TEXT        NOT NULL DEFAULT 'installer',
          phone            TEXT,
          email            TEXT,
          certifications   TEXT[],
          is_lead          BOOLEAN     NOT NULL DEFAULT FALSE,
          notes            TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 041a: crew_members table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 041a (crew_members table): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_crew_members_crew ON crew_members(crew_id)`;
      results.push('\u2705 Migration 041b: idx_crew_members_crew \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 041b (idx_crew_members_crew): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_crew_members_user ON crew_members(user_id)`;
      results.push('\u2705 Migration 041c: idx_crew_members_user \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 041c (idx_crew_members_user): ${(e as Error).message}`);
    }


    // -- Migration 044: contractor_profiles (Network Phase 1) -----------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS contractor_profiles (
          id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id               UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          battery_certified     BOOLEAN     NOT NULL DEFAULT FALSE,
          commercial_capable    BOOLEAN     NOT NULL DEFAULT FALSE,
          roofing_capable       BOOLEAN     NOT NULL DEFAULT FALSE,
          steep_roof_capable    BOOLEAN     NOT NULL DEFAULT FALSE,
          ev_charger_capable    BOOLEAN     NOT NULL DEFAULT FALSE,
          generator_capable     BOOLEAN     NOT NULL DEFAULT FALSE,
          service_states        TEXT[]      NOT NULL DEFAULT '{}',
          service_zips          TEXT[]      NOT NULL DEFAULT '{}',
          travel_radius_miles   INTEGER     NOT NULL DEFAULT 50,
          equipment_ecosystems  TEXT[]      NOT NULL DEFAULT '{}',
          min_project_kw        NUMERIC(6,2),
          max_project_kw        NUMERIC(6,2),
          total_installs        INTEGER     NOT NULL DEFAULT 0,
          avg_close_rate_pct    NUMERIC(5,2),
          avg_response_hours    NUMERIC(6,2),
          inspection_pass_rate  NUMERIC(5,2),
          known_ahjs            TEXT[]      NOT NULL DEFAULT '{}',
          known_utilities       TEXT[]      NOT NULL DEFAULT '{}',
          profile_complete      BOOLEAN     NOT NULL DEFAULT FALSE,
          network_active        BOOLEAN     NOT NULL DEFAULT TRUE,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 044a: contractor_profiles table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 044a (contractor_profiles): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_contractor_profiles_user ON contractor_profiles(user_id)`;
      results.push('\u2705 Migration 044b: idx_contractor_profiles_user \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 044b: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_contractor_profiles_active ON contractor_profiles(network_active) WHERE network_active = TRUE`;
      results.push('\u2705 Migration 044c: idx_contractor_profiles_active \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 044c: ${(e as Error).message}`);
    }

    // -- Migration 045: opportunities ------------------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS opportunities (
          id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          created_by_user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          project_id            UUID        REFERENCES projects(id) ON DELETE SET NULL,
          source                TEXT        NOT NULL DEFAULT 'contractor_shared'
                                  CHECK (source IN ('contractor_shared', 'solarpro_generated')),
          status                TEXT        NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'claimed', 'closed', 'expired', 'withdrawn')),
          site_name             TEXT,
          address               TEXT,
          city                  TEXT,
          state_code            CHAR(2),
          zip                   TEXT,
          lat                   NUMERIC(9,6),
          lng                   NUMERIC(9,6),
          system_size_kw        NUMERIC(6,2),
          annual_kwh            NUMERIC(10,2),
          monthly_kwh_avg       NUMERIC(8,2),
          utility_name          TEXT,
          utility_rate_per_kwh  NUMERIC(6,4),
          estimated_system_cost NUMERIC(12,2),
          estimated_payback_yrs NUMERIC(5,2),
          roof_material         TEXT,
          roof_pitch            TEXT,
          roof_condition        TEXT,
          roof_age_years        INTEGER,
          stories               TEXT,
          structure_type        TEXT,
          usable_roof_pct       NUMERIC(5,2),
          battery_candidate     BOOLEAN     NOT NULL DEFAULT FALSE,
          steep_roof            BOOLEAN     NOT NULL DEFAULT FALSE,
          complex_ahj           BOOLEAN     NOT NULL DEFAULT FALSE,
          ahj_name              TEXT,
          equipment_ecosystem   TEXT,
          asking_price          NUMERIC(10,2),
          listing_notes         TEXT,
          expires_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 045a: opportunities table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 045a (opportunities): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opportunities_open_state ON opportunities(state_code, created_at DESC) WHERE status = 'open'`;
      results.push('\u2705 Migration 045b: idx_opportunities_open_state \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 045b: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opportunities_creator ON opportunities(created_by_user_id, created_at DESC)`;
      results.push('\u2705 Migration 045c: idx_opportunities_creator \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 045c: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opportunities_project ON opportunities(project_id) WHERE project_id IS NOT NULL`;
      results.push('\u2705 Migration 045d: idx_opportunities_project \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 045d: ${(e as Error).message}`);
    }

    // -- Migration 046: opportunity_claims ------------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS opportunity_claims (
          id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id        UUID        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
          claimed_by_user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status                TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'active', 'closed', 'released', 'expired')),
          price_paid            NUMERIC(10,2),
          contractor_notes      TEXT,
          outcome               TEXT        CHECK (outcome IN ('installed', 'sold_to_another', 'homeowner_declined', 'not_viable', 'other')),
          outcome_notes         TEXT,
          outcome_at            TIMESTAMPTZ,
          first_contact_at      TIMESTAMPTZ,
          claim_expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 046a: opportunity_claims table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 046a (opportunity_claims): ${(e as Error).message}`);
    }
    try {
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_claims_exclusive ON opportunity_claims(opportunity_id) WHERE status NOT IN ('released', 'expired')`;
      results.push('\u2705 Migration 046b: idx_opportunity_claims_exclusive (exclusivity) \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 046b: ${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opportunity_claims_user ON opportunity_claims(claimed_by_user_id, created_at DESC)`;
      results.push('\u2705 Migration 046c: idx_opportunity_claims_user \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 046c: ${(e as Error).message}`);
    }

// -- Migration 047: network_opportunities ----------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS network_opportunities (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_opportunity_id UUID,
          source_type           TEXT NOT NULL DEFAULT 'contractor_shared',
          status                TEXT NOT NULL DEFAULT 'intake',
          homeowner_first_name  TEXT,
          homeowner_last_name   TEXT,
          homeowner_email       TEXT,
          homeowner_phone       TEXT,
          address               TEXT,
          city                  TEXT,
          state                 TEXT,
          zip                   TEXT,
          lat                   NUMERIC(10,7),
          lng                   NUMERIC(10,7),
          monthly_bill          NUMERIC(10,2),
          annual_usage_kwh      NUMERIC(10,2),
          utility_name          TEXT,
          net_metering          BOOLEAN,
          roof_age_years        INTEGER,
          structure_type        TEXT,
          stories               INTEGER,
          usable_roof_pct       NUMERIC(5,4),
          shade_level           TEXT,
          system_size_kw        NUMERIC(6,2),
          annual_production_kwh NUMERIC(10,2),
          battery_interest      BOOLEAN,
          financing_preference  TEXT,
          opportunity_score     NUMERIC(5,2),
          opportunity_grade     TEXT,
          listing_price         NUMERIC(10,2),
          claim_count           INTEGER DEFAULT 0,
          max_claims            INTEGER DEFAULT 1,
          view_count            INTEGER DEFAULT 0,
          published_at          TIMESTAMPTZ,
          expires_at            TIMESTAMPTZ,
          claimed_at            TIMESTAMPTZ,
          closed_at             TIMESTAMPTZ,
          intake_notes          TEXT,
          admin_notes           TEXT,
          scoring_data          JSONB DEFAULT '{}',
          screening_data        JSONB DEFAULT '{}',
          enrichment_data       JSONB DEFAULT '{}',
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 047a: network_opportunities table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 047a (network_opportunities): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_net_opps_status ON network_opportunities(status, created_at DESC)`;
      results.push('✅ Migration 047b: idx_net_opps_status — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 047b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_net_opps_source_type ON network_opportunities(source_type)`;
      results.push('✅ Migration 047c: idx_net_opps_source_type — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 047c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_net_opps_state ON network_opportunities(state, status)`;
      results.push('✅ Migration 047d: idx_net_opps_state — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 047d: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_net_opps_score ON network_opportunities(opportunity_score DESC) WHERE opportunity_score IS NOT NULL`;
      results.push('✅ Migration 047e: idx_net_opps_score — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 047e: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_net_opps_published ON network_opportunities(published_at DESC) WHERE published_at IS NOT NULL`;
      results.push('✅ Migration 047f: idx_net_opps_published — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 047f: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_net_opps_source_opp ON network_opportunities(source_opportunity_id) WHERE source_opportunity_id IS NOT NULL`;
      results.push('✅ Migration 047g: idx_net_opps_source_opp — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 047g: \${(e as Error).message}`);
    }

    // -- Migration 048: opportunity_sources ------------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS opportunity_sources (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          source_type           TEXT NOT NULL,
          source_channel        TEXT,
          source_campaign_id    TEXT,
          source_campaign_name  TEXT,
          source_ad_set_id      TEXT,
          source_ad_id          TEXT,
          utm_source            TEXT,
          utm_medium            TEXT,
          utm_campaign          TEXT,
          utm_content           TEXT,
          utm_term              TEXT,
          platform              TEXT,
          platform_lead_id      TEXT,
          platform_campaign_id  TEXT,
          platform_ad_set_id    TEXT,
          platform_ad_id        TEXT,
          platform_form_id      TEXT,
          gclid                 TEXT,
          fbclid                TEXT,
          ttclid                TEXT,
          msclkid               TEXT,
          cost_per_lead         NUMERIC(10,2),
          cost_per_click        NUMERIC(10,2),
          attributed_spend      NUMERIC(12,2),
          currency              TEXT DEFAULT 'USD',
          referring_contractor_id UUID,
          referring_user_id     UUID,
          referral_code         TEXT,
          referral_payout       NUMERIC(10,2),
          partner_id            UUID,
          partner_name          TEXT,
          partner_lead_id       TEXT,
          landing_page_url      TEXT,
          landing_page_path     TEXT,
          landing_page_variant  TEXT,
          session_id            TEXT,
          ip_address            INET,
          user_agent            TEXT,
          device_type           TEXT,
          browser               TEXT,
          os                    TEXT,
          country               TEXT,
          region                TEXT,
          city                  TEXT,
          first_touch_at        TIMESTAMPTZ,
          form_submit_at        TIMESTAMPTZ,
          qualified_at          TIMESTAMPTZ,
          claimed_at            TIMESTAMPTZ,
          appointment_at        TIMESTAMPTZ,
          closed_at             TIMESTAMPTZ,
          funnel_stage          TEXT DEFAULT 'lead',
          conversion_value      NUMERIC(12,2),
          gross_margin          NUMERIC(12,2),
          revenue_share         NUMERIC(10,2),
          is_duplicate          BOOLEAN DEFAULT false,
          duplicate_of          UUID,
          duplicate_detected_at TIMESTAMPTZ,
          duplicate_detection   JSONB DEFAULT '{}',
          raw_payload           JSONB DEFAULT '{}',
          processed_at          TIMESTAMPTZ,
          processing_notes      TEXT,
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 048a: opportunity_sources table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 048a (opportunity_sources): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_sources_opportunity_id ON opportunity_sources(opportunity_id)`;
      results.push('✅ Migration 048b: idx_opp_sources_opportunity_id — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 048b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_sources_source_type ON opportunity_sources(source_type)`;
      results.push('✅ Migration 048c: idx_opp_sources_source_type — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 048c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_sources_platform ON opportunity_sources(platform)`;
      results.push('✅ Migration 048d: idx_opp_sources_platform — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 048d: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_sources_campaign_id ON opportunity_sources(source_campaign_id)`;
      results.push('✅ Migration 048e: idx_opp_sources_campaign_id — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 048e: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_sources_created_at ON opportunity_sources(created_at DESC)`;
      results.push('✅ Migration 048f: idx_opp_sources_created_at — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 048f: \${(e as Error).message}`);
    }

    // -- Migration 049: opportunity_screening_queue ----------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS opportunity_screening_queue (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          pipeline_status       TEXT NOT NULL DEFAULT 'pending',
          started_at            TIMESTAMPTZ,
          completed_at          TIMESTAMPTZ,
          duration_ms           INTEGER,
          auto_decision         TEXT,
          auto_decision_reason  TEXT,
          confidence_score      NUMERIC(5,2),
          override_decision     TEXT,
          override_by           UUID,
          override_reason       TEXT,
          override_at           TIMESTAMPTZ,
          step1_status          TEXT DEFAULT 'pending',
          step1_phone_valid     BOOLEAN,
          step1_email_valid     BOOLEAN,
          step1_phone_type      TEXT,
          step1_email_risk      TEXT,
          step1_data            JSONB DEFAULT '{}',
          step1_completed_at    TIMESTAMPTZ,
          step1_error           TEXT,
          step2_status          TEXT DEFAULT 'pending',
          step2_is_duplicate    BOOLEAN,
          step2_duplicate_of    UUID,
          step2_match_score     NUMERIC(5,2),
          step2_data            JSONB DEFAULT '{}',
          step2_completed_at    TIMESTAMPTZ,
          step2_error           TEXT,
          step3_status          TEXT DEFAULT 'pending',
          step3_address_valid   BOOLEAN,
          step3_formatted_address TEXT,
          step3_lat             NUMERIC(10,7),
          step3_lng             NUMERIC(10,7),
          step3_county          TEXT,
          step3_fips            TEXT,
          step3_census_tract    TEXT,
          step3_data            JSONB DEFAULT '{}',
          step3_completed_at    TIMESTAMPTZ,
          step3_error           TEXT,
          step4_status          TEXT DEFAULT 'pending',
          step4_in_service_area BOOLEAN,
          step4_matched_state   TEXT,
          step4_matched_market  TEXT,
          step4_nearest_contractor_mi NUMERIC(6,2),
          step4_active_contractors_nearby INTEGER,
          step4_data            JSONB DEFAULT '{}',
          step4_completed_at    TIMESTAMPTZ,
          step4_error           TEXT,
          step5_status          TEXT DEFAULT 'pending',
          step5_utility_name    TEXT,
          step5_utility_eia_id  TEXT,
          step5_rate_class      TEXT,
          step5_avg_rate_kwh    NUMERIC(6,4),
          step5_net_metering    BOOLEAN,
          step5_nem_type        TEXT,
          step5_data            JSONB DEFAULT '{}',
          step5_completed_at    TIMESTAMPTZ,
          step5_error           TEXT,
          step6_status          TEXT DEFAULT 'pending',
          step6_viable          BOOLEAN,
          step6_annual_kwh_m2   NUMERIC(8,2),
          step6_peak_sun_hours  NUMERIC(5,2),
          step6_shade_class     TEXT,
          step6_estimated_system_size_kw NUMERIC(6,2),
          step6_data            JSONB DEFAULT '{}',
          step6_completed_at    TIMESTAMPTZ,
          step6_error           TEXT,
          step7_status          TEXT DEFAULT 'pending',
          step7_is_owner        BOOLEAN,
          step7_owner_name      TEXT,
          step7_owner_match     NUMERIC(5,2),
          step7_year_purchased  INTEGER,
          step7_assessed_value  NUMERIC(12,2),
          step7_data            JSONB DEFAULT '{}',
          step7_completed_at    TIMESTAMPTZ,
          step7_error           TEXT,
          step8_status          TEXT DEFAULT 'pending',
          step8_credit_tier     TEXT,
          step8_median_income   NUMERIC(10,2),
          step8_home_value      NUMERIC(12,2),
          step8_debt_proxy      TEXT,
          step8_finance_eligible BOOLEAN,
          step8_data            JSONB DEFAULT '{}',
          step8_completed_at    TIMESTAMPTZ,
          step8_error           TEXT,
          step9_status          TEXT DEFAULT 'pending',
          step9_intent_score    NUMERIC(5,2),
          step9_intent_tier     TEXT,
          step9_data            JSONB DEFAULT '{}',
          step9_completed_at    TIMESTAMPTZ,
          step9_error           TEXT,
          step10_status         TEXT DEFAULT 'pending',
          step10_decision       TEXT,
          step10_score          NUMERIC(5,2),
          step10_grade          TEXT,
          step10_data           JSONB DEFAULT '{}',
          step10_completed_at   TIMESTAMPTZ,
          step10_error          TEXT,
          retry_count           INTEGER DEFAULT 0,
          last_retry_at         TIMESTAMPTZ,
          max_retries           INTEGER DEFAULT 3,
          error_log             JSONB DEFAULT '[]',
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 049a: opportunity_screening_queue table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 049a (opportunity_screening_queue): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_queue_opp_id ON opportunity_screening_queue(opportunity_id)`;
      results.push('✅ Migration 049b: idx_screening_queue_opp_id (unique) — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 049b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_screening_pipeline_status ON opportunity_screening_queue(pipeline_status)`;
      results.push('✅ Migration 049c: idx_screening_pipeline_status — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 049c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_screening_auto_decision ON opportunity_screening_queue(auto_decision)`;
      results.push('✅ Migration 049d: idx_screening_auto_decision — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 049d: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_screening_created_at ON opportunity_screening_queue(created_at DESC)`;
      results.push('✅ Migration 049e: idx_screening_created_at — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 049e: \${(e as Error).message}`);
    }

    // -- Migration 050: opportunity_intelligence -------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS opportunity_intelligence (
          id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id          UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          overall_score           NUMERIC(5,2) NOT NULL DEFAULT 0,
          overall_grade           TEXT NOT NULL DEFAULT 'C',
          score_version           TEXT DEFAULT 'v1.0',
          scored_at               TIMESTAMPTZ DEFAULT NOW(),
          scored_by               TEXT DEFAULT 'auto',
          property_score          NUMERIC(5,2),
          property_weight         NUMERIC(4,3) DEFAULT 0.25,
          property_factors        JSONB DEFAULT '{}',
          solar_score             NUMERIC(5,2),
          solar_weight            NUMERIC(4,3) DEFAULT 0.25,
          solar_factors           JSONB DEFAULT '{}',
          financial_score         NUMERIC(5,2),
          financial_weight        NUMERIC(4,3) DEFAULT 0.20,
          financial_factors       JSONB DEFAULT '{}',
          market_score            NUMERIC(5,2),
          market_weight           NUMERIC(4,3) DEFAULT 0.15,
          market_factors          JSONB DEFAULT '{}',
          intent_score            NUMERIC(5,2),
          intent_weight           NUMERIC(4,3) DEFAULT 0.15,
          intent_factors          JSONB DEFAULT '{}',
          grade_a_plus_threshold  NUMERIC(5,2) DEFAULT 90,
          grade_a_threshold       NUMERIC(5,2) DEFAULT 80,
          grade_b_threshold       NUMERIC(5,2) DEFAULT 65,
          grade_c_threshold       NUMERIC(5,2) DEFAULT 50,
          market_price            NUMERIC(10,2),
          price_min               NUMERIC(10,2),
          price_max               NUMERIC(10,2),
          pricing_rationale       TEXT,
          comparable_leads        JSONB DEFAULT '[]',
          total_eligible_contractors   INTEGER DEFAULT 0,
          top_match_contractor_id      UUID,
          top_match_score              NUMERIC(5,2),
          match_summary                JSONB DEFAULT '[]',
          risk_flags              TEXT[],
          opportunity_highlights  TEXT[],
          executive_summary       TEXT,
          contractor_pitch        TEXT,
          admin_notes             TEXT,
          score_history           JSONB DEFAULT '[]',
          created_at              TIMESTAMPTZ DEFAULT NOW(),
          updated_at              TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 050a: opportunity_intelligence table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 050a (opportunity_intelligence): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_intelligence_opp_id ON opportunity_intelligence(opportunity_id)`;
      results.push('✅ Migration 050b: idx_opp_intelligence_opp_id (unique) — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 050b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_intelligence_score ON opportunity_intelligence(overall_score DESC)`;
      results.push('✅ Migration 050c: idx_opp_intelligence_score — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 050c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_intelligence_grade ON opportunity_intelligence(overall_grade)`;
      results.push('✅ Migration 050d: idx_opp_intelligence_grade — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 050d: \${(e as Error).message}`);
    }

    // -- Migration 051: opportunity_assignments --------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS opportunity_assignments (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          contractor_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status                TEXT NOT NULL DEFAULT 'offered',
          assignment_type       TEXT DEFAULT 'marketplace',
          assignment_rank       INTEGER,
          match_score           NUMERIC(5,2),
          match_factors         JSONB DEFAULT '{}',
          offered_at            TIMESTAMPTZ DEFAULT NOW(),
          offer_expires_at      TIMESTAMPTZ,
          offer_ttl_hours       INTEGER DEFAULT 72,
          claimed_at            TIMESTAMPTZ,
          claim_amount          NUMERIC(10,2),
          claim_currency        TEXT DEFAULT 'USD',
          payment_intent_id     TEXT,
          payment_status        TEXT,
          first_viewed_at       TIMESTAMPTZ,
          last_viewed_at        TIMESTAMPTZ,
          view_count            INTEGER DEFAULT 0,
          contact_attempts      INTEGER DEFAULT 0,
          first_contact_at      TIMESTAMPTZ,
          last_contact_at       TIMESTAMPTZ,
          appointment_at        TIMESTAMPTZ,
          appointment_type      TEXT,
          appointment_confirmed BOOLEAN DEFAULT false,
          appointment_notes     TEXT,
          proposal_at           TIMESTAMPTZ,
          proposal_amount       NUMERIC(12,2),
          system_size_kw        NUMERIC(6,2),
          panel_brand           TEXT,
          inverter_brand        TEXT,
          warranty_years        INTEGER,
          financing_offered     TEXT,
          closed_at             TIMESTAMPTZ,
          close_status          TEXT,
          contract_value        NUMERIC(12,2),
          lost_reason           TEXT,
          lost_to               TEXT,
          dispute_filed_at      TIMESTAMPTZ,
          dispute_reason        TEXT,
          dispute_status        TEXT,
          refund_amount         NUMERIC(10,2),
          refund_at             TIMESTAMPTZ,
          refund_reason         TEXT,
          admin_notes           TEXT,
          flagged               BOOLEAN DEFAULT false,
          flag_reason           TEXT,
          quality_score         NUMERIC(5,2),
          notifications         JSONB DEFAULT '[]',
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 051a: opportunity_assignments table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 051a (opportunity_assignments): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_assignments_opportunity_id ON opportunity_assignments(opportunity_id)`;
      results.push('✅ Migration 051b: idx_opp_assignments_opportunity_id — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 051b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_assignments_contractor_id ON opportunity_assignments(contractor_id)`;
      results.push('✅ Migration 051c: idx_opp_assignments_contractor_id — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 051c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_assignments_status ON opportunity_assignments(status)`;
      results.push('✅ Migration 051d: idx_opp_assignments_status — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 051d: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_opp_assignments_offered_at ON opportunity_assignments(offered_at DESC)`;
      results.push('✅ Migration 051e: idx_opp_assignments_offered_at — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 051e: \${(e as Error).message}`);
    }

    // -- Migration 052: campaign_analytics ------------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS campaign_analytics (
          id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          period_date             DATE NOT NULL,
          period_type             TEXT NOT NULL DEFAULT 'daily',
          source_type             TEXT NOT NULL,
          platform                TEXT,
          campaign_id             TEXT,
          campaign_name           TEXT,
          state                   TEXT,
          market                  TEXT,
          leads_received          INTEGER DEFAULT 0,
          leads_screened          INTEGER DEFAULT 0,
          leads_passed            INTEGER DEFAULT 0,
          leads_failed            INTEGER DEFAULT 0,
          leads_manual_review     INTEGER DEFAULT 0,
          leads_duplicate         INTEGER DEFAULT 0,
          leads_published         INTEGER DEFAULT 0,
          leads_viewed            INTEGER DEFAULT 0,
          leads_claimed           INTEGER DEFAULT 0,
          leads_contacted         INTEGER DEFAULT 0,
          leads_appointment       INTEGER DEFAULT 0,
          leads_proposal          INTEGER DEFAULT 0,
          leads_won               INTEGER DEFAULT 0,
          leads_lost              INTEGER DEFAULT 0,
          screen_pass_rate        NUMERIC(5,4),
          publish_rate            NUMERIC(5,4),
          claim_rate              NUMERIC(5,4),
          contact_rate            NUMERIC(5,4),
          appointment_rate        NUMERIC(5,4),
          proposal_rate           NUMERIC(5,4),
          close_rate              NUMERIC(5,4),
          overall_conversion      NUMERIC(5,4),
          total_spend             NUMERIC(12,2) DEFAULT 0,
          total_revenue           NUMERIC(12,2) DEFAULT 0,
          total_contract_value    NUMERIC(14,2) DEFAULT 0,
          cost_per_lead           NUMERIC(10,2),
          cost_per_qualified_lead NUMERIC(10,2),
          cost_per_claim          NUMERIC(10,2),
          cost_per_appointment    NUMERIC(10,2),
          cost_per_acquisition    NUMERIC(10,2),
          revenue_per_lead        NUMERIC(10,2),
          revenue_per_claim       NUMERIC(10,2),
          gross_margin            NUMERIC(12,2),
          roas                    NUMERIC(8,4),
          roi_pct                 NUMERIC(8,4),
          avg_opportunity_score   NUMERIC(5,2),
          avg_grade_distribution  JSONB DEFAULT '{}',
          disputes_filed          INTEGER DEFAULT 0,
          refunds_issued          INTEGER DEFAULT 0,
          refund_rate             NUMERIC(5,4),
          avg_time_to_claim_hours NUMERIC(8,2),
          avg_time_to_close_days  NUMERIC(8,2),
          top_states              JSONB DEFAULT '[]',
          top_markets             JSONB DEFAULT '[]',
          computed_at             TIMESTAMPTZ DEFAULT NOW(),
          is_partial              BOOLEAN DEFAULT false,
          notes                   TEXT,
          created_at              TIMESTAMPTZ DEFAULT NOW(),
          updated_at              TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 052a: campaign_analytics table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 052a (campaign_analytics): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_campaign_analytics_period ON campaign_analytics(period_date DESC, period_type)`;
      results.push('✅ Migration 052b: idx_campaign_analytics_period — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 052b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_campaign_analytics_source ON campaign_analytics(source_type, platform)`;
      results.push('✅ Migration 052c: idx_campaign_analytics_source — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 052c: \${(e as Error).message}`);
    }

    // -- Migration 053: network_events (immutable event log) ------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS network_events (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_id              TEXT UNIQUE,
          event_type            TEXT NOT NULL,
          event_category        TEXT NOT NULL,
          opportunity_id        UUID REFERENCES network_opportunities(id) ON DELETE SET NULL,
          assignment_id         UUID REFERENCES opportunity_assignments(id) ON DELETE SET NULL,
          contractor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
          admin_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
          data                  JSONB NOT NULL DEFAULT '{}',
          from_status           TEXT,
          to_status             TEXT,
          score_at_event        NUMERIC(5,2),
          grade_at_event        TEXT,
          triggered_by          TEXT NOT NULL DEFAULT 'system',
          ip_address            INET,
          user_agent            TEXT,
          session_id            TEXT,
          is_error              BOOLEAN DEFAULT false,
          error_code            TEXT,
          error_message         TEXT,
          error_details         JSONB DEFAULT '{}',
          occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('✅ Migration 053a: network_events table — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 053a (network_events): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_network_events_opportunity_id ON network_events(opportunity_id) WHERE opportunity_id IS NOT NULL`;
      results.push('✅ Migration 053b: idx_network_events_opportunity_id — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 053b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_network_events_assignment_id ON network_events(assignment_id) WHERE assignment_id IS NOT NULL`;
      results.push('✅ Migration 053c: idx_network_events_assignment_id — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 053c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_network_events_contractor_id ON network_events(contractor_id) WHERE contractor_id IS NOT NULL`;
      results.push('✅ Migration 053d: idx_network_events_contractor_id — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 053d: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_network_events_event_type ON network_events(event_type)`;
      results.push('✅ Migration 053e: idx_network_events_event_type — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 053e: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_network_events_occurred_at ON network_events(occurred_at DESC)`;
      results.push('✅ Migration 053f: idx_network_events_occurred_at — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 053f: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_network_events_errors ON network_events(occurred_at DESC) WHERE is_error = true`;
      results.push('✅ Migration 053g: idx_network_events_errors — ready');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 053g: \${(e as Error).message}`);
    }



    // -- Migration 054_alter: Add intake columns to network_opportunities ------
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS first_name TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS last_name TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS email TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS phone TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS address_line1 TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS address_line2 TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS county TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS monthly_bill_amount NUMERIC(10,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS current_electricity_rate NUMERIC(8,4)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS home_ownership TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS roof_type TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS roof_shade TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS square_feet_living NUMERIC(10,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS source_system TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS source_channel TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS source_name TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS funnel_id UUID`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS campaign_id UUID`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_source TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_medium TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_campaign TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_content TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utm_term TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS gclid TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS fbclid TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS ttclid TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS fips_code TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS census_tract TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS parcel_id TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS year_built INTEGER`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS square_feet_lot NUMERIC(10,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS bedrooms INTEGER`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS bathrooms NUMERIC(4,1)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS owner_name TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS owner_occupied BOOLEAN`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS assessed_value NUMERIC(12,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS market_value NUMERIC(12,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS last_sale_date DATE`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS last_sale_price NUMERIC(12,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS property_enriched_at TIMESTAMPTZ`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS peak_sun_hours_daily NUMERIC(5,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS recommended_system_kw NUMERIC(6,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS annual_kwh_production NUMERIC(10,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS annual_savings_year1 NUMERIC(10,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS savings_25_year NUMERIC(12,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS estimated_system_cost_gross NUMERIC(12,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS federal_itc_amount NUMERIC(12,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS estimated_system_cost_net NUMERIC(12,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS payback_period_years NUMERIC(5,1)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS offset_percentage INTEGER`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS co2_offset_lbs_year NUMERIC(10,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS solar_enriched_at TIMESTAMPTZ`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utility_eiaid TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS electricity_rate_kwh NUMERIC(8,4)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS net_metering_available BOOLEAN`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS net_metering_policy TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS ahj_name TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS interconnection_complexity INTEGER`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS state_incentives_available BOOLEAN`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS srec_market_active BOOLEAN`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS utility_enriched_at TIMESTAMPTZ`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS is_duplicate_flagged BOOLEAN DEFAULT false`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS duplicate_score NUMERIC(4,2)`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS duplicate_of_id UUID`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT false`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    try { await sql`ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS notes TEXT`; } catch(e:unknown){if(!(e as Error).message.includes('already exists')) throw e;}
    results.push('\u2705 Migration 054_alter: network_opportunities intake columns \u2014 ready');

    // -- Migration 054: intake_events (immutable lifecycle event log) ----------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS intake_events (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_id              TEXT UNIQUE NOT NULL,
          opportunity_id        UUID REFERENCES network_opportunities(id) ON DELETE CASCADE,
          event_type            TEXT NOT NULL,
          event_source          TEXT NOT NULL DEFAULT 'system',
          source_system         TEXT,
          source_channel        TEXT,
          funnel_id             UUID,
          campaign_id           UUID,
          idempotency_key       TEXT,
          payload               JSONB NOT NULL DEFAULT '{}',
          validation_result     JSONB DEFAULT '{}',
          duplicate_result      JSONB DEFAULT '{}',
          pipeline_result       JSONB DEFAULT '{}',
          action                TEXT NOT NULL DEFAULT 'unknown',
          error_code            TEXT,
          error_message         TEXT,
          processing_duration_ms INTEGER,
          ip_address            INET,
          user_agent            TEXT,
          referer               TEXT,
          utm_source            TEXT,
          utm_medium            TEXT,
          utm_campaign          TEXT,
          utm_content           TEXT,
          utm_term              TEXT,
          gclid                 TEXT,
          fbclid                TEXT,
          is_replay             BOOLEAN DEFAULT false,
          original_event_id     TEXT,
          occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 054a: intake_events table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 054a (intake_events): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_intake_events_opportunity_id ON intake_events(opportunity_id) WHERE opportunity_id IS NOT NULL`;
      results.push('\u2705 Migration 054b: idx_intake_events_opportunity_id \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 054b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_intake_events_event_type ON intake_events(event_type)`;
      results.push('\u2705 Migration 054c: idx_intake_events_event_type \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 054c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_intake_events_idempotency_key ON intake_events(idempotency_key) WHERE idempotency_key IS NOT NULL`;
      results.push('\u2705 Migration 054d: idx_intake_events_idempotency_key \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 054d: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_intake_events_source_system ON intake_events(source_system) WHERE source_system IS NOT NULL`;
      results.push('\u2705 Migration 054e: idx_intake_events_source_system \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 054e: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_intake_events_action ON intake_events(action)`;
      results.push('\u2705 Migration 054f: idx_intake_events_action \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 054f: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_intake_events_occurred_at ON intake_events(occurred_at DESC)`;
      results.push('\u2705 Migration 054g: idx_intake_events_occurred_at \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 054g: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_intake_events_funnel_id ON intake_events(funnel_id) WHERE funnel_id IS NOT NULL`;
      results.push('\u2705 Migration 054h: idx_intake_events_funnel_id \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 054h: \${(e as Error).message}`);
    }

    // -- Migration 055: enrichment_queue (job queue with per-provider status) -
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS enrichment_queue (
          id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id            UUID UNIQUE NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
          status                    TEXT NOT NULL DEFAULT 'pending',
          priority                  INTEGER NOT NULL DEFAULT 5,
          attempt_count             INTEGER NOT NULL DEFAULT 0,
          max_attempts              INTEGER NOT NULL DEFAULT 3,
          providers_requested       TEXT[] DEFAULT ARRAY['property','solar','utility'],
          providers_completed       TEXT[] DEFAULT ARRAY[]::TEXT[],
          providers_failed          TEXT[] DEFAULT ARRAY[]::TEXT[],
          providers_skipped         TEXT[] DEFAULT ARRAY[]::TEXT[],
          property_status           TEXT DEFAULT 'pending',
          property_provider_used    TEXT,
          property_enriched_at      TIMESTAMPTZ,
          property_error            TEXT,
          solar_status              TEXT DEFAULT 'pending',
          solar_provider_used       TEXT,
          solar_enriched_at         TIMESTAMPTZ,
          solar_error               TEXT,
          utility_status            TEXT DEFAULT 'pending',
          utility_provider_used     TEXT,
          utility_enriched_at       TIMESTAMPTZ,
          utility_error             TEXT,
          ahj_status                TEXT DEFAULT 'pending',
          ahj_provider_used         TEXT,
          ahj_enriched_at           TIMESTAMPTZ,
          ahj_error                 TEXT,
          demographics_status       TEXT DEFAULT 'pending',
          demographics_provider_used TEXT,
          demographics_enriched_at  TIMESTAMPTZ,
          demographics_error        TEXT,
          satellite_status          TEXT DEFAULT 'pending',
          satellite_provider_used   TEXT,
          satellite_enriched_at     TIMESTAMPTZ,
          satellite_error           TEXT,
          started_at                TIMESTAMPTZ,
          completed_at              TIMESTAMPTZ,
          failed_at                 TIMESTAMPTZ,
          next_retry_at             TIMESTAMPTZ,
          last_error                TEXT,
          error_details             JSONB DEFAULT '{}',
          duration_ms               INTEGER,
          force_refresh             BOOLEAN DEFAULT false,
          dry_run                   BOOLEAN DEFAULT false,
          triggered_by              TEXT NOT NULL DEFAULT 'system',
          created_at                TIMESTAMPTZ DEFAULT NOW(),
          updated_at                TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 055a: enrichment_queue table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 055a (enrichment_queue): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status ON enrichment_queue(status)`;
      results.push('\u2705 Migration 055b: idx_enrichment_queue_status \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 055b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_enrichment_queue_next_retry ON enrichment_queue(next_retry_at) WHERE status = 'retry'`;
      results.push('\u2705 Migration 055c: idx_enrichment_queue_next_retry \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 055c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_enrichment_queue_priority ON enrichment_queue(priority DESC, created_at ASC) WHERE status = 'pending'`;
      results.push('\u2705 Migration 055d: idx_enrichment_queue_priority \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 055d: \${(e as Error).message}`);
    }

    // -- Migration 056: webhook_ingestion_log (immutable audit log) -----------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS webhook_ingestion_log (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          idempotency_key       TEXT UNIQUE NOT NULL,
          platform              TEXT NOT NULL,
          partner_id            TEXT,
          opportunity_id        UUID REFERENCES network_opportunities(id) ON DELETE SET NULL,
          http_method           TEXT NOT NULL DEFAULT 'POST',
          request_headers       JSONB DEFAULT '{}',
          raw_body              TEXT,
          parsed_payload        JSONB DEFAULT '{}',
          signature_header      TEXT,
          signature_verified    BOOLEAN DEFAULT false,
          verification_method   TEXT,
          status                TEXT NOT NULL DEFAULT 'received',
          action                TEXT,
          processing_error      TEXT,
          retry_count           INTEGER DEFAULT 0,
          is_replay             BOOLEAN DEFAULT false,
          original_log_id       UUID REFERENCES webhook_ingestion_log(id) ON DELETE SET NULL,
          leads_received        INTEGER DEFAULT 0,
          leads_created         INTEGER DEFAULT 0,
          leads_duplicate       INTEGER DEFAULT 0,
          leads_errored         INTEGER DEFAULT 0,
          processing_duration_ms INTEGER,
          ip_address            INET,
          user_agent            TEXT,
          received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          processed_at          TIMESTAMPTZ,
          created_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 056a: webhook_ingestion_log table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 056a (webhook_ingestion_log): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_webhook_log_platform ON webhook_ingestion_log(platform)`;
      results.push('\u2705 Migration 056b: idx_webhook_log_platform \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 056b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_webhook_log_status ON webhook_ingestion_log(status)`;
      results.push('\u2705 Migration 056c: idx_webhook_log_status \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 056c: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_webhook_log_received_at ON webhook_ingestion_log(received_at DESC)`;
      results.push('\u2705 Migration 056d: idx_webhook_log_received_at \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 056d: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_webhook_log_opportunity_id ON webhook_ingestion_log(opportunity_id) WHERE opportunity_id IS NOT NULL`;
      results.push('\u2705 Migration 056e: idx_webhook_log_opportunity_id \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 056e: \${(e as Error).message}`);
    }

    // -- Migration 057: intake_funnels (config + 4 seed funnels) --------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS intake_funnels (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug                  TEXT UNIQUE NOT NULL,
          name                  TEXT NOT NULL,
          description           TEXT,
          funnel_type           TEXT NOT NULL DEFAULT 'lead_gen',
          source_channel        TEXT NOT NULL DEFAULT 'web',
          is_active             BOOLEAN DEFAULT true,
          require_phone         BOOLEAN DEFAULT false,
          require_address       BOOLEAN DEFAULT false,
          require_monthly_bill  BOOLEAN DEFAULT false,
          require_roof_type     BOOLEAN DEFAULT false,
          campaign_id           UUID,
          thank_you_url         TEXT,
          webhook_notify_url    TEXT,
          custom_fields         JSONB DEFAULT '{}',
          validation_rules      JSONB DEFAULT '{}',
          intake_key            TEXT UNIQUE,
          rate_limit_per_hour   INTEGER DEFAULT 100,
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 057a: intake_funnels table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 057a (intake_funnels): \${(e as Error).message}`);
    }
    try {
      await sql`
        INSERT INTO intake_funnels (slug, name, description, funnel_type, source_channel, require_monthly_bill)
        VALUES
          ('solar-estimate',   'Solar Savings Estimate',  'Homeowner solar estimate request form',       'lead_gen',    'web',    false),
          ('bill-upload',      'Bill Upload Flow',        'Upload utility bill to get savings estimate', 'bill_upload', 'web',    true),
          ('battery-savings',  'Battery + Solar Savings', 'Battery storage + solar combo inquiry',       'lead_gen',    'web',    false),
          ('instant-quote',    'Instant Quote Tool',      'Instant price estimate based on address',     'instant_quote','web',   false)
        ON CONFLICT (slug) DO NOTHING
      `;
      results.push('\u2705 Migration 057b: intake_funnels seed data \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 057b (intake_funnels seed): \${(e as Error).message}`);
    }

    // -- Migration 058: acquisition_campaigns --------------------------------
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS acquisition_campaigns (
          id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name                    TEXT NOT NULL,
          description             TEXT,
          campaign_type           TEXT NOT NULL DEFAULT 'paid_search',
          status                  TEXT NOT NULL DEFAULT 'draft',
          platform                TEXT,
          funnel_id               UUID REFERENCES intake_funnels(id) ON DELETE SET NULL,
          daily_budget_cents      INTEGER,
          monthly_budget_cents    INTEGER,
          total_budget_cents      INTEGER,
          cost_per_lead_target_cents INTEGER,
          leads_target            INTEGER,
          leads_received          INTEGER DEFAULT 0,
          leads_qualified         INTEGER DEFAULT 0,
          leads_converted         INTEGER DEFAULT 0,
          total_spend_cents       INTEGER DEFAULT 0,
          utm_source              TEXT,
          utm_medium              TEXT,
          utm_campaign            TEXT,
          utm_content             TEXT,
          utm_term                TEXT,
          geo_targeting           JSONB DEFAULT '{}',
          audience_targeting      JSONB DEFAULT '{}',
          ad_creative_ids         TEXT[] DEFAULT ARRAY[]::TEXT[],
          start_date              DATE,
          end_date                DATE,
          created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
          notes                   TEXT,
          metadata                JSONB DEFAULT '{}',
          created_at              TIMESTAMPTZ DEFAULT NOW(),
          updated_at              TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      results.push('\u2705 Migration 058a: acquisition_campaigns table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 058a (acquisition_campaigns): \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_acquisition_campaigns_status ON acquisition_campaigns(status)`;
      results.push('\u2705 Migration 058b: idx_acquisition_campaigns_status \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 058b: \${(e as Error).message}`);
    }
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_acquisition_campaigns_funnel_id ON acquisition_campaigns(funnel_id) WHERE funnel_id IS NOT NULL`;
      results.push('\u2705 Migration 058c: idx_acquisition_campaigns_funnel_id \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 058c: \${(e as Error).message}`);
    }


    // ──────────────────────────────────────────────────────────────────────
    // Migration 077: Geometry Reconstruction artifacts tables
    // Stores segmentation masks, depth maps, SfM point clouds, plane/line
    // candidates. REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY.
    // ──────────────────────────────────────────────────────────────────────

    // 077a: Jobs table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS site_survey_geometry_reconstruction_jobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          survey_id UUID NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'queued',
          pipeline TEXT NOT NULL DEFAULT 'mock',
          input JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          completed_at TIMESTAMPTZ
        )
      `;
      results.push('\u2705 Migration 077a: site_survey_geometry_reconstruction_jobs table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 077a (geo_recon_jobs): \${(e as Error).message}`);
    }

    // 077b: Artifacts table
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS site_survey_geometry_reconstruction_artifacts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          job_id UUID NOT NULL REFERENCES site_survey_geometry_reconstruction_jobs(id) ON DELETE CASCADE,
          survey_id UUID NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,
          file_id TEXT,
          artifact_type TEXT NOT NULL,
          pipeline TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}',
          confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
          limitations TEXT[] NOT NULL DEFAULT '{}',
          authority JSONB NOT NULL DEFAULT '{"reviewOnly":true,"nonAuthoritative":true,"cadMutationAllowed":false,"permitGenerationAllowed":false,"bomMutationAllowed":false}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      results.push('\u2705 Migration 077b: site_survey_geometry_reconstruction_artifacts table \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 077b (geo_recon_artifacts): \${(e as Error).message}`);
    }

    // 077c: Indexes
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_geo_recon_artifacts_survey ON site_survey_geometry_reconstruction_artifacts (survey_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_geo_recon_artifacts_job ON site_survey_geometry_reconstruction_artifacts (job_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_geo_recon_jobs_survey ON site_survey_geometry_reconstruction_jobs (survey_id)`;
      results.push('\u2705 Migration 077c: geometry reconstruction indexes \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 077c (geo_recon_indexes): \${(e as Error).message}`);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Migration 078: Geometry Reconstruction heartbeat + stage tracking
    // Adds heartbeat, current_stage, worker_version to jobs;
    // stage_timings + worker_version to artifacts.
    // Enables detection of stuck/in-flight jobs and pipeline provenance.
    // ──────────────────────────────────────────────────────────────────────

    // 078a: Jobs - heartbeat + stage + worker_version
    try {
      await sql`ALTER TABLE site_survey_geometry_reconstruction_jobs ADD COLUMN IF NOT EXISTS current_stage TEXT NULL`;
      results.push('\u2705 Migration 078a: geo_recon_jobs.current_stage \u2014 ensured');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 078a (current_stage): \${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE site_survey_geometry_reconstruction_jobs ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NULL`;
      results.push('\u2705 Migration 078b: geo_recon_jobs.last_heartbeat_at \u2014 ensured');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 078b (last_heartbeat_at): \${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE site_survey_geometry_reconstruction_jobs ADD COLUMN IF NOT EXISTS worker_version TEXT NULL`;
      results.push('\u2705 Migration 078c: geo_recon_jobs.worker_version \u2014 ensured');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 078c (worker_version): \${(e as Error).message}`);
    }

    // 078d: Artifacts - stage_timings + worker_version
    try {
      await sql`ALTER TABLE site_survey_geometry_reconstruction_artifacts ADD COLUMN IF NOT EXISTS stage_timings JSONB NULL`;
      results.push('\u2705 Migration 078d: geo_recon_artifacts.stage_timings \u2014 ensured');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 078d (stage_timings): \${(e as Error).message}`);
    }
    try {
      await sql`ALTER TABLE site_survey_geometry_reconstruction_artifacts ADD COLUMN IF NOT EXISTS worker_version TEXT NULL`;
      results.push('\u2705 Migration 078e: geo_recon_artifacts.worker_version \u2014 ensured');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 078e (worker_version): \${(e as Error).message}`);
    }

    // 078f: Stuck-job index
    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_geo_recon_jobs_stuck
          ON site_survey_geometry_reconstruction_jobs (status, last_heartbeat_at)
          WHERE status = 'running'
      `;
      results.push('\u2705 Migration 078f: idx_geo_recon_jobs_stuck \u2014 ready');
    } catch (e: unknown) {
      results.push(`\u26a0\ufe0f Migration 078f (stuck index): \${(e as Error).message}`);
    }

    // ─── Migration 079: Unified Geometry — promotion records + unified artifacts ───

    // 079a: geometry_promotion_records table
    try {
      const tableExists = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'geometry_promotion_records'
      `;
      if (tableExists.length === 0) {
        await sql`
          CREATE TABLE geometry_promotion_records (
            id TEXT PRIMARY KEY,
            artifact_id TEXT NOT NULL,
            survey_id TEXT NOT NULL,
            from_state TEXT NOT NULL,
            to_state TEXT NOT NULL,
            promoted_by TEXT NOT NULL,
            promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            notes TEXT NULL,
            intelligence_validated BOOLEAN NOT NULL DEFAULT FALSE,
            intelligence_warnings TEXT[] NOT NULL DEFAULT '{}'
          )
        `;
        await sql`
          CREATE INDEX idx_promotion_records_artifact
            ON geometry_promotion_records (artifact_id)
        `;
        await sql`
          CREATE INDEX idx_promotion_records_survey
            ON geometry_promotion_records (survey_id)
        `;
        await sql`
          CREATE INDEX idx_promotion_records_promoted_by
            ON geometry_promotion_records (promoted_by)
        `;
        results.push('✅ Migration 079a: geometry_promotion_records — created');
      } else {
        results.push('⏭ Migration 079a: geometry_promotion_records — already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 079a (promotion records): ${(e as Error).message}`);
    }

    // 079b: unified_geometry_artifacts table
    try {
      const tableExists = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'unified_geometry_artifacts'
      `;
      if (tableExists.length === 0) {
        await sql`
          CREATE TABLE unified_geometry_artifacts (
            id TEXT PRIMARY KEY,
            survey_id TEXT NOT NULL,
            geometry_class TEXT NOT NULL,
            authority_state TEXT NOT NULL DEFAULT 'raw_evidence',
            authority JSONB NOT NULL,
            provenance JSONB NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            label TEXT NOT NULL DEFAULT '',
            limitations TEXT[] NOT NULL DEFAULT '{}',
            geometry_data JSONB NULL,
            review_state TEXT NOT NULL DEFAULT 'review_required',
            review_notes TEXT NULL,
            priority TEXT NOT NULL DEFAULT 'medium',
            mock_artifact BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;
        await sql`
          CREATE INDEX idx_unified_geo_artifacts_survey
            ON unified_geometry_artifacts (survey_id)
        `;
        await sql`
          CREATE INDEX idx_unified_geo_artifacts_class
            ON unified_geometry_artifacts (geometry_class)
        `;
        await sql`
          CREATE INDEX idx_unified_geo_artifacts_authority
            ON unified_geometry_artifacts (authority_state)
        `;
        await sql`
          CREATE INDEX idx_unified_geo_artifacts_review
            ON unified_geometry_artifacts (review_state)
        `;
        results.push('✅ Migration 079b: unified_geometry_artifacts — created');
      } else {
        results.push('⏭ Migration 079b: unified_geometry_artifacts — already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 079b (unified artifacts): ${(e as Error).message}`);
    }

    // ── Migration 080: Backfill unified_geometry_artifacts from source tables ──
    try {
      const ugaExists = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'unified_geometry_artifacts'
      `;
      if (ugaExists.length === 0) {
        results.push('⏭ Migration 080: skipped — unified_geometry_artifacts table does not exist yet (run 079 first)');
      } else {
        // Check if backfill has already been done
        const backfillMarker = await sql`
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'unified_geometry_artifacts'
        `;
        const existingCount = await sql`
          SELECT COUNT(*) as cnt FROM unified_geometry_artifacts
        `;
        const currentCount = Number(existingCount[0]?.cnt ?? 0);

        if (currentCount > 0) {
          results.push(`⏭ Migration 080: skipped — unified_geometry_artifacts already has ${currentCount} rows`);
        } else {
          let backfilledA = 0;
          let backfilledB = 0;

          // Backfill from Pipeline A: open_source_photo_vision_candidates
          try {
            const pipelineARows = await sql`
              SELECT * FROM open_source_photo_vision_candidates
              ORDER BY created_at ASC
            `;
            for (const row of pipelineARows) {
              try {
                // Pre-compute all values outside the tagged template to avoid
                // Neon array-serialization issues (JS arrays can't be sent as
                // PostgreSQL array parameters over the HTTP driver).
                const artifactId = `pv-${row.id}`;
                const authorityJson = JSON.stringify({
                  state: 'raw_evidence',
                  level: 0,
                  reviewOnly: true,
                  cadConsumable: false,
                  mockArtifact: false,
                });
                const provenanceJson = JSON.stringify({
                  sourcePipeline: 'photo_vision',
                  toolName: row.candidate_type ?? 'unknown',
                  toolVersion: '1.0.0',
                  runHash: row.id ?? 'unknown',
                  sourceFileIds: row.file_id ? [row.file_id] : [],
                  derivedFromArtifactIds: [],
                });
                const confidenceVal = Number(row.confidence ?? 0);
                const labelVal = String(row.candidate_type ?? 'unknown');
                const geometryDataJson = JSON.stringify({
                  originalCandidateId: row.id,
                  candidateType: row.candidate_type,
                  candidateCategory: row.candidate_category,
                });
                const createdAtVal = row.created_at ?? new Date().toISOString();

                await sql`
                  INSERT INTO unified_geometry_artifacts (
                    id, survey_id, geometry_class, authority_state, authority,
                    provenance, confidence, label, limitations, geometry_data,
                    review_state, priority, mock_artifact, created_at, updated_at
                  ) VALUES (
                    ${artifactId},
                    ${row.survey_id},
                    'obstruction',
                    'raw_evidence',
                    ${authorityJson}::jsonb,
                    ${provenanceJson}::jsonb,
                    ${confidenceVal},
                    ${labelVal},
                    '{}'::text[],
                    ${geometryDataJson}::jsonb,
                    'review_required',
                    'medium',
                    false,
                    ${createdAtVal}::timestamptz,
                    NOW()::timestamptz
                  )
                  ON CONFLICT (id) DO NOTHING
                `;
                backfilledA++;
              } catch (insertErr) {
                // Skip individual failures — log but continue
                console.warn(`[Migration 080] Failed to backfill Pipeline A row id=${row.id}:`, insertErr);
              }
            }
          } catch (aErr) {
            console.warn('[Migration 080] Pipeline A backfill error:', aErr);
          }

          // Backfill from Pipeline B: site_survey_geometry_reconstruction_artifacts
          try {
            const pipelineBRows = await sql`
              SELECT * FROM site_survey_geometry_reconstruction_artifacts
              ORDER BY created_at ASC
            `;
            for (const row of pipelineBRows) {
              try {
                const artifactType = row.artifact_type ?? 'unknown';
                // Map artifact type to geometry class
                const geometryClassMap: Record<string, string> = {
                  segmentation_mask: 'segmentation',
                  depth_map: 'depth',
                  sfm_point_cloud: 'point_cloud',
                  plane_candidate: 'roof_plane',
                  roof_plane_candidate: 'roof_plane',
                  wall_plane_candidate: 'wall_plane',
                  line_candidate: 'structural_line',
                  semantic_segmentation_mask: 'segmentation',
                  structural_line_candidate: 'structural_line',
                  vanishing_point: 'vanishing_point',
                  consensus_plane_candidate: 'consensus_plane',
                };

                // Pre-compute all values outside the tagged template to avoid
                // Neon array-serialization issues (JS arrays can't be sent as
                // PostgreSQL array parameters over the HTTP driver).
                const geometryClass = geometryClassMap[artifactType] ?? 'unknown';
                const authorityJson = JSON.stringify({
                  state: 'raw_evidence',
                  level: 0,
                  reviewOnly: true,
                  cadConsumable: false,
                  mockArtifact: artifactType === 'mock',
                });
                const provenanceJson = JSON.stringify({
                  sourcePipeline: 'geometry_reconstruction',
                  toolName: artifactType,
                  toolVersion: row.worker_version ?? '1.0.0',
                  runHash: row.job_id ?? row.id ?? 'unknown',
                  sourceFileIds: row.file_id ? [row.file_id] : [],
                  derivedFromArtifactIds: [],
                });
                const confidenceVal = Number(row.confidence ?? 0);
                // row.limitations is TEXT[] from PostgreSQL — comes back as JS array.
                // Neon HTTP driver (v0.10.4) cannot send JS arrays as PG array params.
                // Store limitations in geometry_data JSONB instead; use empty '{}'::text[]
                // for the limitations column (it has a DEFAULT '{}' anyway).
                const geometryDataJson = JSON.stringify({
                  originalArtifactId: row.id,
                  artifactType,
                  artifactData: row.payload,
                  limitations: row.limitations,  // preserve original limitations here
                });
                const mockArtifact = artifactType === 'mock';
                const createdAtVal = row.created_at ?? new Date().toISOString();

                await sql`
                  INSERT INTO unified_geometry_artifacts (
                    id, survey_id, geometry_class, authority_state, authority,
                    provenance, confidence, label, limitations, geometry_data,
                    review_state, priority, mock_artifact, created_at, updated_at
                  ) VALUES (
                    ${String(row.id)},
                    ${row.survey_id},
                    ${geometryClass},
                    'raw_evidence',
                    ${authorityJson}::jsonb,
                    ${provenanceJson}::jsonb,
                    ${confidenceVal},
                    ${artifactType},
                    '{}'::text[],
                    ${geometryDataJson}::jsonb,
                    'review_required',
                    'medium',
                    ${mockArtifact},
                    ${createdAtVal}::timestamptz,
                    NOW()::timestamptz
                  )
                  ON CONFLICT (id) DO NOTHING
                `;
                backfilledB++;
              } catch (insertErr) {
                console.warn(`[Migration 080] Failed to backfill Pipeline B row id=${row.id}:`, insertErr);
              }
            }
          } catch (bErr) {
            console.warn('[Migration 080] Pipeline B backfill error:', bErr);
          }

          results.push(`✅ Migration 080: backfilled unified_geometry_artifacts — Pipeline A: ${backfilledA}, Pipeline B: ${backfilledB}`);
        }
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 080 (backfill unified artifacts): ${(e as Error).message}`);
    }

    // ── Migration 081: Add obstruction_metadata column to unified_geometry_artifacts ──
    try {
      const columnExists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'unified_geometry_artifacts'
          AND column_name = 'obstruction_metadata'
      `;
      if (columnExists.length === 0) {
        await sql`
          ALTER TABLE unified_geometry_artifacts
          ADD COLUMN obstruction_metadata JSONB NULL
        `;
        results.push('✅ Migration 081: obstruction_metadata column — added');
      } else {
        results.push('⏭ Migration 081: obstruction_metadata column — already exists');
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 081 (obstruction_metadata column): ${(e as Error).message}`);
    }

    // ── Migration 082: Backfill obstruction_data → unified_geometry_artifacts ──
    // Reads existing obstruction_data JSONB from site_survey_files, parses each
    // obstruction record, and writes it as a unified geometry artifact with the
    // full ObstructionMetadata blob. This is a one-time migration that runs only
    // if the backfill hasn't been completed yet (tracked via a marker query).
    try {
      // Check if the obstruction_metadata column exists first
      const colCheck = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'unified_geometry_artifacts'
          AND column_name = 'obstruction_metadata'
      `;
      if (colCheck.length === 0) {
        results.push('⏭ Migration 082: obstruction_metadata column not yet created — skipping backfill');
      } else {
        // Check if we already have obstruction-class artifacts with obstruction_metadata
        const existingBackfill = await sql`
          SELECT COUNT(*) as cnt FROM unified_geometry_artifacts
          WHERE geometry_class = 'obstruction'
            AND obstruction_metadata IS NOT NULL
        `;
        const alreadyBackfilled = Number(existingBackfill[0]?.cnt ?? 0);

        if (alreadyBackfilled > 0) {
          results.push(`⏭ Migration 082: obstruction backfill — already completed (${alreadyBackfilled} rows)`);
        } else {
          // Read all obstruction_data from site_survey_files
          let backfilledCount = 0;
          let backfillErrors = 0;

          const obstructionRows = await sql`
            SELECT survey_id, obstruction_data
            FROM site_survey_files
            WHERE obstruction_data IS NOT NULL
              AND label = 'roof_plane'
            ORDER BY survey_id, filename
          `;

          for (const row of obstructionRows) {
            try {
              const obsData = row.obstruction_data as Record<string, unknown> | null;
              if (!obsData || typeof obsData !== 'object') continue;

              const obstructions = obsData.obstructions as Array<Record<string, unknown>> | undefined;
              if (!Array.isArray(obstructions) || obstructions.length === 0) continue;

              for (const obs of obstructions) {
                try {
                  // Build the ObstructionMetadata blob from the stored JSON
                  const region = obs.region as Record<string, unknown> | undefined;
                  const center = obs.center as Record<string, unknown> | undefined;
                  const obsId = String(obs.id ?? `backfill-${row.survey_id}-${backfilledCount}`);
                  const label = String(obs.obstructionType ?? obs.obstruction_type ?? 'unknown_obstruction');

                  const provenance = {
                    sourcePipeline: 'obstruction_registration',
                    toolName: 'roofObstructionRegistration',
                    toolVersion: '1.0.0',
                    runHash: String(obs.sourceFileId ?? 'unknown'),
                    sourceFileIds: obs.sourceFileId ? [String(obs.sourceFileId)] : [] as string[],
                    derivedFromArtifactIds: [] as string[],
                    createdAt: new Date().toISOString(),
                    synthetic: true,
                    disclaimer: 'Backfilled from site_survey_files.obstruction_data',
                    backfilledFrom: 'site_survey_files.obstruction_data',
                  };

                  const confidence01 = Math.min(1, Math.max(0, (Number(obs.confidence) ?? 0) / 100));
                  const reviewState = String(obs.reviewState ?? obs.review_state ?? 'review_required');
                  const priority = String(obs.priority ?? 'medium');

                  const geometryData = {
                    id: obsId,
                    surveyId: row.survey_id,
                    geometryClass: 'obstruction',
                    authority: {
                      state: 'derived_review_only',
                      level: 1,
                      reviewOnly: true,
                      nonAuthoritative: true,
                      cadMutationAllowed: false,
                      permitGenerationAllowed: false,
                      bomMutationAllowed: false,
                      canonicalMutationAllowed: false,
                      engineeringWorkflowMutationAllowed: false,
                      cadConsumable: false,
                      mockArtifact: false,
                    },
                    provenance,
                    confidence: confidence01,
                    label,
                    limitations: Array.isArray(obs.limitations) ? obs.limitations : [] as string[],
                    bbox: region ? {
                      x: Number(region.x ?? 0),
                      y: Number(region.y ?? 0),
                      width: Number(region.width ?? 0),
                      height: Number(region.height ?? 0),
                      coordinateSystem: 'normalized_image_0_1000',
                    } : null,
                    polygon: null,
                    lineSegment: null,
                    center: center ? {
                      x: Number(center.x ?? 0),
                      y: Number(center.y ?? 0),
                      coordinateSystem: 'normalized_image_0_1000',
                    } : null,
                    planeType: null,
                    pitchDegrees: null,
                    azimuthDegrees: null,
                    normalVector: null,
                    areaSqM: Number(obs.areaNormalized ?? obs.area_normalized ?? 0),
                    inlierCount: null,
                    totalPoints: null,
                    lineSubtype: null,
                    estimatedLengthM: null,
                    obstructionSubtype: String(obs.obstructionType ?? obs.obstruction_type ?? 'other'),
                    radiusM: null,
                    setbackM: null,
                    heightFt: null,
                    roofPlaneId: null,
                    cadImpact: {
                      canAffectPanelPlacement: Boolean(obs.canAffectPanelPlacement ?? false),
                      canAffectFirePathway: Boolean(obs.canAffectFirePathway ?? false),
                      canAffectConduitPath: Boolean(obs.canAffectConduitPath ?? false),
                      canAffectStructuralAttachment: Boolean(obs.canAffectStructuralAttachment ?? false),
                      layoutAvoidancePriority: priority,
                      cadBlockHint: String(obs.cadBlockHint ?? 'unknown'),
                      obstructionFootprintHint: String(obs.obstructionFootprintHint ?? 'unknown'),
                      clearanceRadiusHint: String(obs.clearanceRadiusHint ?? 'unknown'),
                    },
                    electricalSubtype: null,
                    story: null,
                    isPrimaryInterconnect: null,
                    depthResolution: null,
                    depthMetric: null,
                    consensusPhotoCount: null,
                    segmentationClass: null,
                    reviewState: reviewState === 'accepted' ? 'accepted'
                      : reviewState === 'rejected' ? 'rejected'
                      : 'review_required',
                    reviewNotes: null,
                    priority,
                    stageTimings: null,
                    isSynthetic: true,
                    obstructionMetadata: obs,  // Store the raw obstruction data as-is
                  };

                  // Pre-compute values to avoid Neon array-serialization issues.
                  // geometryData.limitations is a JS array — Neon HTTP driver (v0.10.4)
                  // cannot send JS arrays as PostgreSQL array parameters.
                  // Store limitations in geometry_data JSONB instead; use empty '{}'::text[]
                  // for the limitations column (it has a DEFAULT '{}' anyway).
                  const m082AuthorityJson = JSON.stringify(geometryData.authority);
                  const m082ProvenanceJson = JSON.stringify(provenance);
                  const m082GeometryDataJson = JSON.stringify(geometryData);
                  const m082ObsJson = JSON.stringify(obs);

                  await sql`
                    INSERT INTO unified_geometry_artifacts (
                      id, survey_id, geometry_class, authority_state, authority,
                      provenance, confidence, label, limitations, geometry_data,
                      obstruction_metadata,
                      review_state, priority, mock_artifact, created_at, updated_at
                    ) VALUES (
                      ${obsId},
                      ${row.survey_id},
                      'obstruction',
                      'derived_review_only',
                      ${m082AuthorityJson}::jsonb,
                      ${m082ProvenanceJson}::jsonb,
                      ${confidence01},
                      ${label},
                      '{}'::text[],
                      ${m082GeometryDataJson}::jsonb,
                      ${m082ObsJson}::jsonb,
                      ${reviewState},
                      ${priority},
                      FALSE,
                      NOW()::timestamptz,
                      NOW()::timestamptz
                    )
                    ON CONFLICT (id) DO NOTHING
                  `;
                  backfilledCount++;
                } catch (insertErr) {
                  backfillErrors++;
                  console.warn(`[Migration 082] Failed to backfill obstruction:`, insertErr);
                }
              }
            } catch (rowErr) {
              console.warn('[Migration 082] Failed to process obstruction_data row:', rowErr);
            }
          }

          results.push(`✅ Migration 082: obstruction backfill — ${backfilledCount} obstructions written${backfillErrors > 0 ? `, ${backfillErrors} errors` : ''}`);
        }
      }
    } catch (e: unknown) {
      results.push(`⚠️ Migration 082 (obstruction backfill): ${(e as Error).message}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Migration 083: project_physical_data engineering columns
    // Adds columns referenced by the permit route and fromPhysicalData.ts
    // bridge that were missing from the actual database schema.
    // These were the cause of the "phantom column" PostgreSQL errors
    // in the permit route's survey enrichment block.
    // ─────────────────────────────────────────────────────────────────────────

    try {
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS roof_pitch_degrees NUMERIC(6,2)`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS decking_thickness_in NUMERIC(6,3)`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS structural_notes TEXT`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS main_panel_rating_amps INTEGER`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS busbar_rating_amps INTEGER`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS breaker_spaces_available INTEGER`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS has_existing_solar BOOLEAN DEFAULT FALSE`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS total_roof_area_sqft NUMERIC(12,2)`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS usable_area_sqft NUMERIC(12,2)`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS site_address TEXT`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`;
      await sql`ALTER TABLE project_physical_data ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`;
      results.push('✅ Migration 083: project_physical_data engineering columns — 12 columns added');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 083 (physical_data engineering columns): ${(e as Error).message}`);
    }


    // ──────────────────────────────────────────────────────────────────
    // Migration 084: geometry reconstruction stage_durations
    // Adds stage_durations JSONB and failure_stage columns to track pipeline
    // execution timing and failure points.
    // ──────────────────────────────────────────────────────────────────

    try {
      await sql`ALTER TABLE site_survey_geometry_reconstruction_jobs ADD COLUMN IF NOT EXISTS stage_durations JSONB NULL`;
      await sql`ALTER TABLE site_survey_geometry_reconstruction_jobs ADD COLUMN IF NOT EXISTS failure_stage TEXT NULL`;
      results.push('✅ Migration 084: geometry reconstruction stage_durations — 2 columns added');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 084 (stage_durations): ${(e as Error).message}`);
    }

    // ──────────────────────────────────────────────────────────────────
    // Migration 085: geometry reconstruction worker ownership
    // Adds locked_by, locked_at columns for atomic job claiming by Render workers.
    // ──────────────────────────────────────────────────────────────────

    try {
      await sql`ALTER TABLE site_survey_geometry_reconstruction_jobs ADD COLUMN IF NOT EXISTS locked_by TEXT NULL`;
      await sql`ALTER TABLE site_survey_geometry_reconstruction_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL`;
      results.push('✅ Migration 085: worker ownership columns — 2 columns added');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 085 (worker ownership): ${(e as Error).message}`);
    }

    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_geom_recon_jobs_claimable
          ON site_survey_geometry_reconstruction_jobs (status, locked_by)
          WHERE status = 'queued' AND locked_by IS NULL
      `;
      results.push('✅ Migration 085: idx_geom_recon_jobs_claimable — index created');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 085 (claimable index): ${(e as Error).message}`);
    }

    // ── Migration 086: Depth contradiction reports table ──────────────────────
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS site_survey_depth_contradiction_reports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          job_id UUID NOT NULL REFERENCES site_survey_geometry_reconstruction_jobs(id) ON DELETE CASCADE,
          survey_id UUID NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,
          segmentation_class TEXT NOT NULL,
          mask_id TEXT NOT NULL,
          expected_range_min DOUBLE PRECISION NOT NULL,
          expected_range_max DOUBLE PRECISION NOT NULL,
          actual_depth DOUBLE PRECISION NOT NULL,
          deviation DOUBLE PRECISION NOT NULL,
          severity TEXT NOT NULL CHECK (severity IN ('none', 'minor', 'moderate', 'major')),
          confidence_penalty DOUBLE PRECISION NOT NULL DEFAULT 0,
          description TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_depth_contradiction_reports_survey
          ON site_survey_depth_contradiction_reports (survey_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_depth_contradiction_reports_job
          ON site_survey_depth_contradiction_reports (job_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_depth_contradiction_reports_blocking
          ON site_survey_depth_contradiction_reports (mask_id, severity)
          WHERE severity IN ('moderate', 'major')
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_depth_contradiction_reports_class
          ON site_survey_depth_contradiction_reports (segmentation_class)
      `;
      results.push('✅ Migration 086: site_survey_depth_contradiction_reports table + 4 indexes created');
    } catch (e: unknown) {
      results.push(`⚠️ Migration 086 (depth contradiction reports): ${(e as Error).message}`);
    }

    // ── Migration 100: Compliance schema — audit log, MFA, consent tracking ──
    // SOC 2 CC7.2 / ISO 27001 A.12.4 tamper-evident audit logging,
    // MFA columns on users, recovery codes table, consent tracking.
    // Idempotent: all CREATE/ALTER use IF NOT EXISTS.
    try {
      // Section A: audit_log table
      const auditLogExists = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'audit_log'
      `;
      if (auditLogExists.length === 0) {
        await sql`
          CREATE TABLE IF NOT EXISTS audit_log (
            id            BIGSERIAL PRIMARY KEY,
            timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            category      TEXT NOT NULL,
            action        TEXT NOT NULL,
            actor_id      TEXT,
            actor_email   TEXT,
            actor_role    TEXT,
            target_type   TEXT,
            target_id     TEXT,
            description   TEXT NOT NULL,
            metadata      JSONB DEFAULT '{}',
            ip_address    TEXT,
            user_agent    TEXT,
            request_path  TEXT,
            prev_hash     TEXT,
            entry_hash    TEXT NOT NULL
          )
        `;
        await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp DESC)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log (category)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log (actor_id)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_entry_hash ON audit_log (entry_hash)`;
        results.push('✅ Migration 100: audit_log table + 6 indexes created');
      } else {
        results.push('⏭ Migration 100: audit_log table already exists');
      }

      // Section B: MFA columns on users
      const mfaCols: Array<{ col: string; ddl: () => Promise<unknown> }> = [
        { col: 'mfa_enabled', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE` },
        { col: 'mfa_method', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method TEXT` },
        { col: 'mfa_secret_encrypted', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT` },
        { col: 'mfa_verified_at', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ` },
        { col: 'mfa_enrolled_at', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ` },
      ];
      let mfaAdded = 0;
      for (const { col, ddl } of mfaCols) {
        const exists = await sql`
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = ${col}
        `;
        if (exists.length === 0) { await ddl(); mfaAdded++; }
      }
      results.push(`✅ Migration 100: MFA columns on users — ${mfaAdded} added (5 total)`);

      // Section C: mfa_recovery_codes table
      // FK constraint added via guarded DO block (not inline) for idempotency
      const recoveryTableExists = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'mfa_recovery_codes'
      `;
      if (recoveryTableExists.length === 0) {
        await sql`
          CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
            id          BIGSERIAL PRIMARY KEY,
            user_id     UUID NOT NULL,
            code_hash   TEXT NOT NULL,
            used        BOOLEAN DEFAULT FALSE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            used_at     TIMESTAMPTZ
          )
        `;
        results.push('✅ Migration 100: mfa_recovery_codes table created');
      } else {
        results.push('⏭ Migration 100: mfa_recovery_codes table already exists');
      }

      // FK: mfa_recovery_codes.user_id → users(id) — guarded for idempotency
      const fkExists = await sql`
        SELECT 1 FROM pg_constraint WHERE conname = 'mfa_recovery_codes_user_id_fkey'
      `;
      if (fkExists.length === 0) {
        await sql`
          ALTER TABLE mfa_recovery_codes
            ADD CONSTRAINT mfa_recovery_codes_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        `;
        results.push('✅ Migration 100: mfa_recovery_codes FK constraint added');
      } else {
        results.push('⏭ Migration 100: mfa_recovery_codes FK constraint already exists');
      }

      // Indexes (idempotent)
      await sql`CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user ON mfa_recovery_codes (user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_unused ON mfa_recovery_codes (user_id, used) WHERE used = false`;
      results.push('✅ Migration 100: mfa_recovery_codes indexes ensured');

      // Section D: Consent tracking columns on users
      const consentCols: Array<{ col: string; ddl: () => Promise<unknown> }> = [
        { col: 'consent_privacy_at', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_privacy_at TIMESTAMPTZ` },
        { col: 'consent_terms_at', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_terms_at TIMESTAMPTZ` },
        { col: 'consent_cookie_at', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_cookie_at TIMESTAMPTZ` },
        { col: 'consent_marketing_at', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_marketing_at TIMESTAMPTZ` },
        { col: 'data_deletion_requested_at', ddl: () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS data_deletion_requested_at TIMESTAMPTZ` },
      ];
      let consentAdded = 0;
      for (const { col, ddl } of consentCols) {
        const exists = await sql`
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = ${col}
        `;
        if (exists.length === 0) { await ddl(); consentAdded++; }
      }
      results.push(`✅ Migration 100: Consent columns on users — ${consentAdded} added (5 total)`);
    } catch (e: unknown) {
      results.push(`⚠️ Migration 100 (compliance schema): ${(e as Error).message}`);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/migrate]', error);
  }
}