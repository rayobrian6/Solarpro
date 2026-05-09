// ============================================================================
// POST /api/admin/repair-account?secret=<ADMIN_SECRET>
// Body: { email: string, password: string }
//
// Emergency account repair: sets a known password + clears is_free_pass.
// Does NOT require session auth — uses ADMIN_SECRET env var.
// Use this when a user is completely locked out and the normal reset flow fails.
// ============================================================================

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { hashPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  // Gate: require ADMIN_SECRET
  const secret      = req.nextUrl.searchParams.get('secret') || '';
  const adminSecret = process.env.ADMIN_SECRET || '';

  if (!adminSecret || !secret || secret !== adminSecret) {
    return NextResponse.json({ ok: false, error: 'Invalid secret' }, { status: 403 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
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

    // Check user exists
    const rows = await sql`SELECT id, email, is_free_pass, password_hash FROM users WHERE email = ${email} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: `No user found with email: ${email}` }, { status: 404 });
    }

    const user = rows[0] as { id: string; email: string; is_free_pass: boolean; password_hash: string };

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

    console.log(`[ACCOUNT_REPAIR] Repaired account for ${email} (userId=${user.id}): set bcrypt-12 hash, cleared is_free_pass`);

    return NextResponse.json({
      ok:      true,
      email:   user.email,
      message: `Account repaired. Password set (bcrypt cost=12). is_free_pass cleared. You can now log in with the new password.`,
      was_free_pass: user.is_free_pass,
      old_hash_prefix: user.password_hash ? user.password_hash.slice(0, 7) : 'null',
      new_hash_prefix: newHash.slice(0, 7),
    });

  } catch (err: unknown) {
    console.error('[ACCOUNT_REPAIR] Error:', (err as Error)?.message);
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message || 'DB error' },
      { status: 503 }
    );
  }
}
