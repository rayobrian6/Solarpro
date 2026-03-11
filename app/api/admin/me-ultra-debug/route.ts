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
  const results: any = { jwtId: id, tests: {} };

  // Check if there's a VIEW named users
  try {
    const r = await sql`
      SELECT table_name, table_type 
      FROM information_schema.tables 
      WHERE table_name = 'users' AND table_schema = 'public'
    `;
    results.usersTableType = r;
  } catch (e: any) { results.usersTableType = { error: e.message }; }

  // Check column order in users table
  try {
    const r = await sql`
      SELECT column_name, ordinal_position, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `;
    results.columns = r;
  } catch (e: any) { results.columns = { error: e.message }; }

  // Test: SELECT id, email, role - what does role actually contain?
  try {
    const r = await sql`SELECT id, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.tests = {
      idEmailRole: { role: r[0]?.role, id: r[0]?.id, email: r[0]?.email },
    };
  } catch (e: any) { results.tests = { error: e.message }; }

  // Test: SELECT * to see all columns
  try {
    const r = await sql`SELECT id, email, role, name FROM users WHERE id = ${id} LIMIT 1`;
    results.idEmailRoleName = { role: r[0]?.role, name: r[0]?.name };
  } catch (e: any) { results.idEmailRoleName = { error: e.message }; }

  // Check if there are multiple schemas
  try {
    const r = await sql`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE tablename = 'users'
    `;
    results.schemas = r;
  } catch (e: any) { results.schemas = { error: e.message }; }

  // Check for views
  try {
    const r = await sql`
      SELECT table_name, view_definition 
      FROM information_schema.views 
      WHERE table_name = 'users'
    `;
    results.views = r;
  } catch (e: any) { results.views = { error: e.message }; }

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}
