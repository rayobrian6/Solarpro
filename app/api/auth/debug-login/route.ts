import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const results: Record<string, any> = {};

  // 1. Check env vars
  results.env = {
    DATABASE_URL_present: !!process.env.DATABASE_URL,
    DATABASE_URL_prefix:  process.env.DATABASE_URL?.substring(0, 30) + '...' || 'MISSING',
    JWT_SECRET_present:   !!process.env.JWT_SECRET,
    NODE_ENV:             process.env.NODE_ENV,
    VERCEL_ENV:           process.env.VERCEL_ENV,
    total_env_keys:       Object.keys(process.env).length,
    // Show all keys so we can spot the right DB var name
    all_keys:             Object.keys(process.env).sort(),
  };

  // 2. Try DB connection
  try {
    const { neon } = await import('@neondatabase/serverless');
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL is not set');
    const sql = neon(dbUrl);
    const ping = await sql`SELECT 1 AS ok`;
    results.db = { connected: true, ping: ping[0] };

    // 3. Try to find Raymond's user
    try {
      const rows = await sql`
        SELECT id, name, email, role, 
               LEFT(password_hash, 10) AS hash_prefix,
               LENGTH(password_hash) AS hash_len
        FROM users 
        WHERE email = 'raymond.obrian@yahoo.com'
        LIMIT 1
      `;
      if (rows.length === 0) {
        results.user = { found: false };
      } else {
        const u = rows[0];
        results.user = {
          found:       true,
          id:          u.id,
          name:        u.name,
          email:       u.email,
          role:        u.role,
          hash_prefix: u.hash_prefix,
          hash_len:    u.hash_len,
        };

        // 4. Test password verification
        try {
          const fullRows = await sql`
            SELECT password_hash FROM users WHERE email = 'raymond.obrian@yahoo.com' LIMIT 1
          `;
          const hash = fullRows[0]?.password_hash;
          const valid1 = await bcrypt.compare('ChangeMe123!', hash);
          results.password = {
            test_password: 'ChangeMe123!',
            valid: valid1,
            hash_present: !!hash,
          };
        } catch (e: any) {
          results.password = { error: e.message };
        }
      }
    } catch (e: any) {
      results.user = { error: e.message };
    }

  } catch (e: any) {
    results.db = { connected: false, error: e.message };
  }

  // 5. Test JWT
  try {
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET missing');
    const token = jwt.default.sign({ id: 'test', email: 'test@test.com' }, secret, { expiresIn: '1h' });
    const decoded = jwt.default.verify(token, secret) as any;
    results.jwt = { working: true, decoded_id: decoded.id };
  } catch (e: any) {
    results.jwt = { working: false, error: e.message };
  }

  return NextResponse.json(results, { status: 200 });
}

export async function POST(req: NextRequest) {
  // Emergency password reset for raymond
  try {
    const { neon } = await import('@neondatabase/serverless');
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return NextResponse.json({ error: 'DATABASE_URL missing' }, { status: 500 });
    const sql = neon(dbUrl);
    const newHash = await bcrypt.hash('ChangeMe123!', 12);
    await sql`UPDATE users SET password_hash = ${newHash} WHERE email = 'raymond.obrian@yahoo.com'`;
    return NextResponse.json({ success: true, message: 'Password reset to ChangeMe123!' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}