import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET(req: NextRequest) {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 });

    const sql = neon(url);

    // Test basic connectivity
    const ping = await sql`SELECT 1 as ok`;

    // Test raymond's account
    const raymond = await sql`
      SELECT id, name, email, role, 
             LEFT(password_hash, 10) as hash_prefix,
             LENGTH(password_hash) as hash_len
      FROM users 
      WHERE email = 'raymond.obrian@yahoo.com'
      LIMIT 1
    `;

    // Also test password verification inline
    const bcrypt = await import('bcryptjs');
    let passwordCheck = 'no user found';
    if (raymond[0]) {
      // Get full hash for verification
      const fullRow = await sql`
        SELECT password_hash FROM users WHERE email = 'raymond.obrian@yahoo.com' LIMIT 1
      `;
      const hash = fullRow[0]?.password_hash;
      const valid1 = await bcrypt.compare('ChangeMe123!', hash);
      const valid2 = await bcrypt.compare('changeme123!', hash);
      const valid3 = await bcrypt.compare('ChangeMe123', hash);
      passwordCheck = `ChangeMe123!=${valid1}, changeme123!=${valid2}, ChangeMe123=${valid3}`;
    }

    return NextResponse.json({
      ping: ping[0],
      raymond: raymond[0] || null,
      passwordCheck,
      jwtSecret: process.env.JWT_SECRET ? `set (${process.env.JWT_SECRET.length} chars)` : 'MISSING',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack?.split('\n').slice(0,5) }, { status: 500 });
  }
}

// Also allow POST to reset the password
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