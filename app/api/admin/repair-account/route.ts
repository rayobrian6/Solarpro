// ============================================================================
// POST /api/admin/repair-account
// Body: { email: string, password: string, secret: string }
//
// Emergency account repair: sets a known password + clears is_free_pass.
// Does NOT require session auth — uses ADMIN_SECRET env var.
// Use this when a user is completely locked out and the normal reset flow fails.
//
// SECURITY: Uses crypto.timingSafeEqual for secret comparison.
//           Secret read from POST body (not URL query params).
//           Actions are logged via logAdminAction() for audit trail.
// ============================================================================

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { hashPassword } from '@/lib/auth';
import { logAdminAction } from '@/lib/adminActivityLog';
import { productionGuard } from '@/lib/security';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  // SECURITY: Block in production — this is an emergency-only tool
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  // Parse body — secret is now in body, not URL query params
  let body: { email?: string; password?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // SECURITY FIX: Read secret from body ONLY — never from query string
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

  const email    = (body.email || '').trim().toLowerCase();
  const password = (body.password || '').trim();

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'email and password are required' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ ok: false, error: 'password must be at least 8 characters' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    // Check user exists (do not fetch password_hash — only need metadata)
    const rows = await sql`SELECT id, email, is_free_pass FROM users WHERE email = ${email} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: `No user found with email: ${email}` }, { status: 404 });
    }

    const user = rows[0] as { id: string; email: string; is_free_pass: boolean };

    // Hash with cost 12 (same as hashPassword in lib/auth.ts)
    const newHash = await hashPassword(password);

    // Update: set new hash, clear is_free_pass, update timestamp
    await sql`
      UPDATE users
      SET password_hash = ${newHash},
          is_free_pass  = false,
          updated_at    = NOW()
      WHERE id = ${user.id}
    `;

    // SECURITY FIX: Log admin action for audit trail
    await logAdminAction({
      adminId: 'admin_secret',
      action: 'repair_account',
      targetUserId: user.id,
      metadata: {
        targetEmail: email,
        note: 'Emergency password reset via repair-account endpoint (ADMIN_SECRET auth)',
        was_free_pass: user.is_free_pass,
      },
    });

    console.log(`[ACCOUNT_REPAIR] Repaired account for ${email} (userId=${user.id}): set bcrypt-12 hash, cleared is_free_pass`);

    return NextResponse.json({
      ok:      true,
      email:   user.email,
      message: `Account repaired. Password set (bcrypt cost=12). is_free_pass cleared. You can now log in with the new password.`,
      was_free_pass: user.is_free_pass,
    });

  } catch (err: unknown) {
    console.error('[ACCOUNT_REPAIR] Error:', (err as Error)?.message);
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message || 'DB error' },
      { status: 503 }
    );
  }
}
