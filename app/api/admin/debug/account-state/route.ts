// ============================================================================
// GET /api/admin/debug/account-state?email=<email>&secret=<ADMIN_SECRET>
//
// Does NOT require session auth — uses ADMIN_SECRET env var for access.
// This allows diagnosing a locked-out account.
//
// Returns exact DB state: hash algo, cost, length, is_free_pass, updated_at
// Runs the exact same logic as login route to diagnose which branch fires.
// Does NOT return the hash itself.
//
// SECURITY: productionGuard() blocks this entirely in production.
//           ADMIN_SECRET gate provides secondary validation in dev/preview.
// ============================================================================

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { productionGuard } from '@/lib/security';

export async function GET(req: NextRequest) {
  // SECURITY: Block in production — this returns sensitive account metadata
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  // Gate: require ADMIN_SECRET
  const secret       = req.nextUrl.searchParams.get('secret') || '';
  const adminSecret  = process.env.ADMIN_SECRET || '';

  if (!adminSecret || !secret || secret !== adminSecret) {
    return NextResponse.json({ ok: false, error: 'Invalid secret' }, { status: 403 });
  }

  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase() || '';
  if (!email) {
    return NextResponse.json({ ok: false, error: '?email= required' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        id,
        email,
        password_hash,
        is_free_pass,
        role,
        subscription_status,
        created_at,
        updated_at
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, exists: false, email });
    }

    const u = rows[0] as {
      id: string;
      email: string;
      password_hash: string | null;
      is_free_pass: boolean | null;
      role: string | null;
      subscription_status: string | null;
      created_at: Date | string | null;
      updated_at: Date | string | null;
    };

    const hash = u.password_hash || '';

    // Parse hash metadata without returning the hash
    let hashInfo: Record<string, unknown>;
    if (!hash) {
      hashInfo = { type: 'null_or_empty', length: 0 };
    } else if (hash === '__SOLARPRO_MUST_RESET__') {
      hashInfo = { type: 'sentinel', value: '__SOLARPRO_MUST_RESET__', requiresReset: true };
    } else {
      const m = /^\$(2[aby])\$(\d{1,2})\$/.exec(hash);
      if (m) {
        hashInfo = {
          type:    'bcrypt',
          variant: m[1],
          cost:    parseInt(m[2], 10),
          length:  hash.length,
          prefix:  hash.slice(0, 7),   // e.g. "$2b$12$" — safe, no secret bits here
          requiresReset: parseInt(m[2], 10) === 4, // cost=4 is sentinel
        };
      } else if (/^[0-9a-f]{32}:[0-9a-f]{128}$/i.test(hash)) {
        hashInfo = { type: 'legacy_salt_sha512', length: hash.length, requiresReset: true };
      } else {
        hashInfo = { type: 'unknown', length: hash.length, prefix: hash.slice(0, 4), requiresReset: true };
      }
    }

    const toIso = (v: Date | string | null) => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(String(v));
      return isNaN(d.getTime()) ? null : d.toISOString();
    };

    return NextResponse.json({
      ok:                  true,
      exists:              true,
      email:               u.email,
      is_free_pass:        u.is_free_pass,
      role:                u.role,
      subscription_status: u.subscription_status,
      created_at:          toIso(u.created_at),
      updated_at:          toIso(u.updated_at),
      hash:                hashInfo,

      // Pre-computed diagnosis
      diagnosis: {
        will_require_reset: hashInfo.requiresReset === true,
        should_login_work:
          hashInfo.type === 'bcrypt' &&
          !hashInfo.requiresReset &&
          u.is_free_pass === false,
        notes: [
          hashInfo.requiresReset
            ? '⚠️  Hash will trigger LEGACY_HASH_RESET_REQUIRED on login'
            : '✅ Hash format is valid bcrypt — login should work if password is correct',
          u.is_free_pass
            ? '⚠️  is_free_pass is still TRUE — Safety Net B may fire on wrong password'
            : '✅ is_free_pass is false — Safety Net B will not fire',
        ],
      },
    });

  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message || 'DB error' },
      { status: 503 }
    );
  }
}
