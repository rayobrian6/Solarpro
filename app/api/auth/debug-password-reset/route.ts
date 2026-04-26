export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDbReady } from '@/lib/db-neon';
import { productionGuard } from '@/lib/security';

export async function POST(req: NextRequest) {
  // SECURITY: Block debug routes in production
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  const steps: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    steps.push(`1. Email parsed: "${email}"`);

    const sql = await getDbReady();
    steps.push('2. DB connected');

    // Check table exists and get column names
    try {
      await sql`SELECT 1 FROM password_reset_tokens LIMIT 0`;
      steps.push('3. password_reset_tokens table EXISTS');
      // Get actual columns
      const cols = await sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'password_reset_tokens'
        ORDER BY ordinal_position
      `;
      steps.push(`3b. Columns: ${cols.map((c: any) => `${c.column_name}(${c.data_type},nullable=${c.is_nullable})`).join(', ')}`);
    } catch (e: unknown) {
      steps.push(`3. password_reset_tokens table ERROR: ${(e as Error)?.message}`);
      return NextResponse.json({ steps, error: (e as Error)?.message }, { status: 500 });
    }

    // Look up user
    const users = await sql`SELECT id, email, name FROM users WHERE email = ${email} LIMIT 1`;
    steps.push(`4. User lookup: found=${users.length > 0}, id=${users[0]?.id ?? 'none'}`);

    if (users.length === 0) {
      return NextResponse.json({ steps, result: 'user_not_found' });
    }

    const user = users[0];

    // Delete existing tokens
    await sql`DELETE FROM password_reset_tokens WHERE user_id = ${user.id}`;
    steps.push('5. Old tokens deleted');

    // Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    steps.push('6. Token generated');

    // Insert token
    await sql`
      INSERT INTO password_reset_tokens (user_id, token, token_hash, expires_at)
      VALUES (${user.id}, ${tokenHash}, ${tokenHash}, ${expiresAt.toISOString()})
    `;
    steps.push('7. Token stored in DB');

    // Check env vars
    const resendKey = process.env.RESEND_API_KEY;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
    steps.push(`8. RESEND_API_KEY present: ${!!resendKey}, starts: ${resendKey?.substring(0, 8) ?? 'none'}`);
    steps.push(`9. BASE_URL: ${baseUrl ?? 'undefined'}`);

    // Try sending email
    const { sendPasswordResetEmail } = await import('@/lib/email');
    steps.push('10. Email module imported');

    const emailResult = await sendPasswordResetEmail(user.email, rawToken);
    steps.push(`11. Email send result: success=${emailResult.success}, error=${emailResult.error ?? 'none'}`);

    return NextResponse.json({ steps, result: 'complete', emailResult });

  } catch (error: unknown) {
    return NextResponse.json({
      steps,
      error: (error as Error)?.message,
      stack: (error as Error)?.stack?.split('\n').slice(0, 10),
    }, { status: 500 });
  }
}