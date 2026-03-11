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

  // CONFIRMED: SELECT id, email, role → role="user" (WRONG)
  // CONFIRMED: SELECT id, email, role AS user_role → user_role="super_admin" (CORRECT, no "role" key)
  // CONFIRMED: SELECT id, name, email, role → role="super_admin" (CORRECT)
  // CONFIRMED: SELECT id, email, role, name, company → role="super_admin" (CORRECT)
  
  // NEW HYPOTHESIS: There's a SECOND "role" column somewhere, or a JOIN/view issue
  // When role is 3rd column, maybe it's getting a different "role" value from somewhere
  
  // Test A: What does password_hash look like? Is it "user"?
  try {
    const r = await sql`SELECT id, email, password_hash FROM users WHERE id = ${id} LIMIT 1`;
    results.A_passwordHash = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      password_hash_first30: r[0]?.password_hash?.substring(0, 30),
      password_hash_length: r[0]?.password_hash?.length,
    };
  } catch (e: any) { results.A_passwordHash = { error: e.message }; }

  // Test B: SELECT id, email, role - confirm it returns "user"
  try {
    const r = await sql`SELECT id, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.B_idEmailRole = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      role: r[0]?.role,
      roleLength: r[0]?.role?.length,
      roleIsUser: r[0]?.role === 'user',
    };
  } catch (e: any) { results.B_idEmailRole = { error: e.message }; }

  // Test C: SELECT id, email, password_hash, role - show both
  try {
    const r = await sql`SELECT id, email, password_hash, role FROM users WHERE id = ${id} LIMIT 1`;
    results.C_withPasswordHash = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      role: r[0]?.role,
      password_hash_first30: r[0]?.password_hash?.substring(0, 30),
    };
  } catch (e: any) { results.C_withPasswordHash = { error: e.message }; }

  // Test D: SELECT role, email, id (reversed) - if Neon maps by position, role would be "id" value
  try {
    const r = await sql`SELECT role, email, id FROM users WHERE id = ${id} LIMIT 1`;
    results.D_reversedOrder = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      role: r[0]?.role,
      id: r[0]?.id,
    };
  } catch (e: any) { results.D_reversedOrder = { error: e.message }; }

  // Test E: Check ALL columns of the users table to find if there's another "role" column
  try {
    const r = await sql`
      SELECT column_name, ordinal_position, data_type
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `;
    results.E_allColumns = r.map((row: any) => `${row.ordinal_position}:${row.column_name}(${row.data_type})`);
  } catch (e: any) { results.E_allColumns = { error: e.message }; }

  // Test F: SELECT * FROM users - what keys does the full row have?
  try {
    const r = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
    results.F_starQuery = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      role: r[0]?.role,
    };
  } catch (e: any) { results.F_starQuery = { error: e.message }; }

  // Test G: Use explicit cast to text to force the actual value
  try {
    const r = await sql`SELECT id, email, role::text AS role_text FROM users WHERE id = ${id} LIMIT 1`;
    results.G_roleCast = {
      allKeys: r[0] ? Object.keys(r[0]) : [],
      role_text: r[0]?.role_text,
    };
  } catch (e: any) { results.G_roleCast = { error: e.message }; }

  // Test H: Check if there's a DEFAULT value or constraint on role column
  try {
    const r = await sql`
      SELECT column_default, is_nullable, character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'role' AND table_schema = 'public'
    `;
    results.H_roleColumnInfo = r[0] || null;
  } catch (e: any) { results.H_roleColumnInfo = { error: e.message }; }

  // Test I: Direct raw value check - what is the ACTUAL stored value?
  try {
    const r = await sql`SELECT role FROM users WHERE id = ${id}`;
    results.I_directRole = {
      role: r[0]?.role,
      count: r.length,
    };
  } catch (e: any) { results.I_directRole = { error: e.message }; }

  // Test J: Check if there are multiple rows for this user
  try {
    const r = await sql`SELECT id, email, role FROM users WHERE email = 'raymond.obrian@yahoo.com'`;
    results.J_allRaymondRows = r.map((row: any) => ({ id: row.id?.substring(0, 8), email: row.email, role: row.role }));
  } catch (e: any) { results.J_allRaymondRows = { error: e.message }; }

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}