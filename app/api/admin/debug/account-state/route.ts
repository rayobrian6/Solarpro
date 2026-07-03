// ============================================================================
// POST /api/admin/debug/account-state
// Body: { email: string, secret: string }
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
//           Uses crypto.timingSafeEqual to prevent timing attacks.
//           Secret read from POST body (not URL query params).
// ============================================================================

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { productionGuard } from '@/lib/security';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  // SECURITY: Block in production — this returns sensitive account metadata
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  // SECURITY FIX: Read secret from body ONLY — never from query string
  // (URL params appear in CDN/proxy/load-balancer logs, browser history)
  let body: { email?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const secret      = body.secret || '';
  const adminSecret = process.env.ADMIN_SECRET || '';

  // SECURITY FIX: Use timingSafeEqual to prevent timing attacks on secret comparison
  if (!adminSecret || !secret) {
    return NextResponse.json({ ok: false, error: 'Invalid secret' }, { status: 403 });
  }

  const { timingSafeEqual } = await import('crypto');
  const expectedBuf = Buffer.from(adminSecret, 'utf8');
  const actualBuf   = Buffer.from(secret, 'utf8');
  const secretValid = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);

  if (!secretValid) {
    return NextResponse.json({ ok: false, error: 'Invalid secret' }, { status: 403 });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: 'email is required' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    // SECURITY FIX: Do not SELECT password_hash — it would exist in server memory
    // and could be logged by observability tools or crash reporters.
    // Instead, compute hash metadata in SQL and return only that.
    const rows = await sql`
      SELECT
        id,
        email,
        CASE
          WHEN password_hash IS NULL THEN 0
          ELSE length(password_hash)
        END AS hash_length,
        CASE
          WHEN password_hash IS NULL THEN 'null'
          WHEN password_hash = '__SOLARPRO_MUST_RESET__' THEN 'sentinel'
          WHEN password_hash LIKE '$2%' THEN 'bcrypt'
          WHEN password_hash ~ '^[0-9a-f]{32}:[0-9a-f]{128}$' THEN 'legacy_salt_sha512'
          ELSE 'unknown'
        END AS hash_type,
        CASE
          WHEN password_hash LIKE '$2%' THEN substring(password_hash from 1 for 7)
          WHEN password_hash IS NOT NULL AND password_hash != '__SOLARPRO_MUST_RESET__' THEN substring(password_hash from 1 for 4)
          ELSE NULL
        END AS hash_prefix,
        CASE
          WHEN password_hash LIKE '$2%' THEN substring(password_hash from 4 for 2)::integer
          ELSE NULL
        END AS bcrypt_cost,
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
      hash_length: number;
      hash_type: string;
      hash_prefix: string | null;
      bcrypt_cost: number | null;
      is_free_pass: boolean | null;
      role: string | null;
      subscription_status: string | null;
      created_at: Date | string | null;
      updated_at: Date | string | null;
    };

    // Build hashInfo from SQL-computed metadata (password_hash never left the DB)
    let hashInfo: Record<string, unknown>;
    if (u.hash_type === 'null') {
      hashInfo = { type: 'null_or_empty', length: 0 };
    } else if (u.hash_type === 'sentinel') {
      hashInfo = { type: 'sentinel', value: '__SOLARPRO_MUST_RESET__', requiresReset: true };
    } else if (u.hash_type === 'bcrypt') {
      hashInfo = {
        type:    'bcrypt',
        variant: u.hash_prefix?.slice(1, 4) ?? '2b',  // e.g. "2b" from "$2b$"
        cost:    u.bcrypt_cost,
        length:  u.hash_length,
        prefix:  u.hash_prefix,   // e.g. "$2b$12$" — safe, no secret bits
        requiresReset: u.bcrypt_cost === 4,  // cost=4 is sentinel
      };
    } else if (u.hash_type === 'legacy_salt_sha512') {
      hashInfo = { type: 'legacy_salt_sha512', length: u.hash_length, requiresReset: true };
    } else {
      hashInfo = { type: 'unknown', length: u.hash_length, prefix: u.hash_prefix, requiresReset: true };
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
