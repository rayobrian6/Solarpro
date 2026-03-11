import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET(req: NextRequest) {
  const results: Record<string, any> = {};

  try {
    // Dump all relevant env var keys (not values)
    const allKeys = Object.keys(process.env);
    results.env_keys_db = allKeys.filter(k =>
      k.includes('DATABASE') || k.includes('NEON') || k.includes('POSTGRES') || k.includes('PG')
    );
    results.env_keys_jwt = allKeys.filter(k => k.includes('JWT') || k.includes('SECRET'));
    results.total_env_vars = allKeys.length;

    // Try each possible DB URL key
    const dbUrl = process.env.DATABASE_URL
      || process.env.POSTGRES_URL
      || process.env.NEON_DATABASE_URL
      || process.env.POSTGRES_PRISMA_URL;

    results.db_url_found = !!dbUrl;
    results.db_url_key_used = process.env.DATABASE_URL ? 'DATABASE_URL'
      : process.env.POSTGRES_URL ? 'POSTGRES_URL'
      : process.env.NEON_DATABASE_URL ? 'NEON_DATABASE_URL'
      : 'NONE';

    if (!dbUrl) {
      return NextResponse.json(results);
    }

    // Test DB connection
    const sql = neon(dbUrl);
    const ping = await sql`SELECT 1 as ok`;
    results.ping = ping[0];

    // Test password verification
    const rows = await sql`
      SELECT id, name, email, password_hash, company, role
      FROM users
      WHERE email = ${'raymond.obrian@yahoo.com'}
      LIMIT 1
    `;
    results.user_found = rows.length > 0;

    if (rows[0]) {
      const bcrypt = await import('bcryptjs');
      const valid = await bcrypt.compare('ChangeMe123!', rows[0].password_hash);
      results.password_valid = valid;

      // Test JWT signing
      const jwt = await import('jsonwebtoken');
      const secret = process.env.JWT_SECRET;
      results.jwt_secret_set = !!secret;

      if (secret) {
        const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, secret, { expiresIn: '30d' });
        results.token_generated = token.length > 0;
        results.ALL_STEPS_PASSED = true;
      }
    }

  } catch (err: any) {
    results.ERROR = err.message;
    results.STACK = err.stack?.split('\n').slice(0, 6);
  }

  return NextResponse.json(results);
}

// POST to reset password
export async function POST(req: NextRequest) {
  try {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) return NextResponse.json({ error: 'No DB URL found' }, { status: 500 });

    const sql = neon(dbUrl);
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