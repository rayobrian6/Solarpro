// ============================================================================
// GET /api/admin/debug/user-audit?email=<email>
//
// Audits a single user record with SAFE FIELDS ONLY. No password hash, no PII
// beyond email-shape. Used to diagnose "my password keeps falling off"
// incidents by answering questions like:
//   - Does the user row exist in the CURRENT database?
//   - When was the row created?
//   - When was the row last updated?
//   - What algorithm+cost does the stored hash use?
//     (bcrypt $2a$ vs $2b$, cost 10/12/etc)
//   - Has the user logged in recently (if last_login_at column exists)?
//
// GATE: requireAdminApi() - session cookie + DB role admin/super_admin
//
// DELIBERATELY NOT RETURNED:
//   - the password hash itself
//   - any hash prefix beyond algo+cost
//   - profile fields (name, phone, company) beyond existence
//   - role (already known to the admin caller)
// ============================================================================

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady } from '@/lib/db-neon';

function parseBcryptMeta(hash: string | null | undefined): {
  algo: string | null;
  cost: number | null;
  length: number;
  prefix_matches_bcrypt: boolean;
} {
  if (!hash) return { algo: null, cost: null, length: 0, prefix_matches_bcrypt: false };
  // bcrypt format: $2a$COST$... or $2b$COST$... or $2y$COST$...
  const m = /^\$(2[aby])\$(\d{1,2})\$/.exec(hash);
  if (!m) {
    return {
      algo: null,
      cost: null,
      length: hash.length,
      prefix_matches_bcrypt: false,
    };
  }
  return {
    algo: `bcrypt-${m[1]}`,
    cost: parseInt(m[2], 10),
    length: hash.length,
    prefix_matches_bcrypt: true,
  };
}

function maskEmail(email: string): string {
  // ray@solarpro.solutions -> r***@s***.solutions (keep first char + tld chunk only)
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const parts = domain.split('.');
  const tld = parts.slice(-1)[0] || '';
  return `${local[0]}***@${domain[0]}***.${tld}`;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Admin authentication required' },
      { status: 401 }
    );
  }

  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase() || '';
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { ok: false, error: 'Valid ?email= query param required' },
      { status: 400 }
    );
  }

  try {
    const sql = await getDbReady();

    // Probe which optional columns exist so the query doesn't 500 if schema drifts.
    const colRows = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `;
    const cols = new Set<string>(
      (colRows as Array<{ column_name: string }>).map((r) => r.column_name)
    );
    const hasLastLogin = cols.has('last_login_at');

    // Use plain string interpolation of a column LIST, then bind email via param.
    // (We've already validated column names against information_schema.)
    const selectList = [
      'id',
      'created_at',
      'updated_at',
      'password_hash',
      'role',
      hasLastLogin ? 'last_login_at' : 'NULL::timestamptz AS last_login_at',
    ].join(', ');

    // Neon's tagged-template doesn't support dynamic identifier lists; use
    // sql.query for this one probe. Column names are hard-coded above.
    // Cast to any to access .query without breaking the tagged-template type.
    const rawSql = sql as unknown as {
      query: (q: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;
    };
    const rows = await rawSql.query(
      `SELECT ${selectList} FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        email_masked: maskEmail(email),
        exists: false,
      });
    }

    const r = rows[0] as {
      id: string;
      created_at: Date | string;
      updated_at: Date | string;
      password_hash: string | null;
      role: string | null;
      last_login_at: Date | string | null;
    };

    const toIso = (v: Date | string | null): string | null => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(v);
      return isNaN(d.getTime()) ? null : d.toISOString();
    };

    const hashMeta = parseBcryptMeta(r.password_hash);

    return NextResponse.json({
      ok: true,
      email_masked:     maskEmail(email),
      exists:           true,
      // Intentionally NOT returning user.id (PII-lite) or name
      created_at:       toIso(r.created_at),
      updated_at:       toIso(r.updated_at),
      last_login_at:    toIso(r.last_login_at),
      role_set:         !!r.role,
      password_hash: {
        algo:                  hashMeta.algo,
        cost:                  hashMeta.cost,
        length:                hashMeta.length,
        prefix_matches_bcrypt: hashMeta.prefix_matches_bcrypt,
        // NO prefix, NO suffix, NO partial digest
      },
      schema: {
        has_last_login_at_column: hasLastLogin,
      },
      caller_role: admin.role,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message || 'DB probe failed' },
      { status: 503 }
    );
  }
}