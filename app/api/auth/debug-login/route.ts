import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET(req: NextRequest) {
  const results: Record<string, any> = {};

  try {
    // Step 1: DB connection
    const url = process.env.DATABASE_URL;
    results.step1_db_url = url ? 'set' : 'MISSING';
    if (!url) return NextResponse.json(results);

    const sql = neon(url);
    const ping = await sql`SELECT 1 as ok`;
    results.step2_ping = ping[0];

    // Step 2: Fetch user (exactly as login route does)
    const rows = await sql`
      SELECT id, name, email, password_hash, company, phone, role
      FROM users
      WHERE email = ${'raymond.obrian@yahoo.com'}
      LIMIT 1
    `;
    results.step3_user_found = rows.length > 0;
    results.step3_hash_len = rows[0]?.password_hash?.length;

    // Step 3: Verify password
    const bcrypt = await import('bcryptjs');
    const valid = await bcrypt.compare('ChangeMe123!', rows[0]?.password_hash || '');
    results.step4_password_valid = valid;

    // Step 4: Sign JWT (exactly as login route does)
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET;
    results.step5_jwt_secret = secret ? `set (${secret.length} chars)` : 'MISSING';

    if (!secret) return NextResponse.json(results);

    const payload = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
    const token = jwt.sign(payload, secret, { expiresIn: '30d' });
    results.step6_token_len = token.length;
    results.step6_token_prefix = token.substring(0, 20);

    // Step 5: Make cookie
    const expires = new Date(Date.now() + 60 * 60 * 24 * 30 * 1000).toUTCString();
    const cookie = `solarpro_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
    results.step7_cookie_len = cookie.length;

    results.ALL_STEPS_PASSED = true;

  } catch (err: any) {
    results.ERROR = err.message;
    results.STACK = err.stack?.split('\n').slice(0, 8);
  }

  return NextResponse.json(results);
}

// POST to reset password
export async function POST(req: NextRequest) {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 });

    const sql = neon(url);
    const bcrypt = await import('bcryptjs');
    const newHash = await bcrypt.hash('ChangeMe123!', 10);

    const result = await sql`
      UPDATE users 
      SET password_hash = ${newHash}, role = 'super_admin', updated_at = NOW()
      WHERE email = 'raymond.obrian@yahoo.com'
      RETURNING id, email, role
    `;

    return NextResponse.json({
      success: true,
      message: 'Password reset to ChangeMe123!',
      user: result[0] || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}