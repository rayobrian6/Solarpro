import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, any> = {
    timestamp: new Date().toISOString(),
    env: {
      DATABASE_URL:  !!process.env.DATABASE_URL,
      JWT_SECRET:    !!process.env.JWT_SECRET,
      NODE_ENV:      process.env.NODE_ENV,
    },
  };

  // Test DB connection
  try {
    const url = process.env.DATABASE_URL;
    if (!url) {
      checks.db = { ok: false, error: 'DATABASE_URL not set' };
    } else {
      const sql = neon(url);
      const rows = await sql`SELECT 1 AS ping, NOW() AS ts`;
      checks.db = { ok: true, ping: rows[0]?.ping, ts: rows[0]?.ts };
    }
  } catch (e: any) {
    checks.db = { ok: false, error: e.message };
  }

  const allOk = checks.db?.ok === true;
  return NextResponse.json(checks, { status: allOk ? 200 : 503 });
}