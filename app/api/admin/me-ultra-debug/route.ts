import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getUserFromRequest(req);
  if (!session?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sql = getDb();
  const id = session.id;
  const results: any = { jwtId: id };

  // Test: SELECT id, email, role - what are ALL the keys returned?
  try {
    const r = await sql`SELECT id, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.test1_idEmailRole = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      allValues: r[0] ? Object.entries(r[0]).map(([k,v]) => `${k}=${typeof v === 'string' ? v.substring(0,20) : v}`) : [],
      role: r[0]?.role,
    };
  } catch (e: any) { results.test1 = { error: e.message }; }

  // Test: SELECT id, name, email, role - what are ALL the keys returned?
  try {
    const r = await sql`SELECT id, name, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.test2_idNameEmailRole = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      role: r[0]?.role,
    };
  } catch (e: any) { results.test2 = { error: e.message }; }

  // Test: SELECT role - just role alone
  try {
    const r = await sql`SELECT role FROM users WHERE id = ${id} LIMIT 1`;
    results.test3_justRole = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      role: r[0]?.role,
    };
  } catch (e: any) { results.test3 = { error: e.message }; }

  // Test: SELECT id, email, role with explicit alias
  try {
    const r = await sql`SELECT id, email, role AS user_role FROM users WHERE id = ${id} LIMIT 1`;
    results.test4_withAlias = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      user_role: (r[0] as any)?.user_role,
      role: r[0]?.role,
    };
  } catch (e: any) { results.test4 = { error: e.message }; }

  // Test: SELECT * to see what all columns look like
  try {
    const r = await sql`SELECT id, email, role, name, company FROM users WHERE id = ${id} LIMIT 1`;
    results.test5_multipleColumns = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      role: r[0]?.role,
      name: r[0]?.name,
    };
  } catch (e: any) { results.test5 = { error: e.message }; }

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}
