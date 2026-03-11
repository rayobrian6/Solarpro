import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET(req: NextRequest) {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 });

    const sql = neon(url);

    // Test basic connectivity
    const ping = await sql`SELECT 1 as ok`;

    // Test users table exists
    const userCount = await sql`SELECT COUNT(*) as cnt FROM users`;

    // Test raymond's account
    const raymond = await sql`
      SELECT id, name, email, role, 
             LEFT(password_hash, 10) as hash_prefix,
             LENGTH(password_hash) as hash_len
      FROM users 
      WHERE email = 'raymond.obrian@yahoo.com'
      LIMIT 1
    `;

    return NextResponse.json({
      ping: ping[0],
      userCount: userCount[0],
      raymond: raymond[0] || null,
      jwtSecret: process.env.JWT_SECRET ? `set (${process.env.JWT_SECRET.length} chars)` : 'MISSING',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack?.split('\n').slice(0,5) }, { status: 500 });
  }
}