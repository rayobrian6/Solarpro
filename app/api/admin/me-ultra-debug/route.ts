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

  // Test A: base (works)
  try {
    const r = await sql`SELECT id, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.A_base = { role: r[0]?.role };
  } catch (e: any) { results.tests.A_base = { error: e.message }; }

  // Test B: add name
  try {
    const r = await sql`SELECT id, name, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.B_addName = { role: r[0]?.role };
  } catch (e: any) { results.tests.B_addName = { error: e.message }; }

  // Test C: add company
  try {
    const r = await sql`SELECT id, name, email, company, role FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.C_addCompany = { role: r[0]?.role };
  } catch (e: any) { results.tests.C_addCompany = { error: e.message }; }

  // Test D: add phone
  try {
    const r = await sql`SELECT id, name, email, company, phone, role FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.D_addPhone = { role: r[0]?.role };
  } catch (e: any) { results.tests.D_addPhone = { error: e.message }; }

  // Test E: add email_verified
  try {
    const r = await sql`SELECT id, name, email, company, phone, role, email_verified FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.E_addEmailVerified = { role: r[0]?.role };
  } catch (e: any) { results.tests.E_addEmailVerified = { error: e.message }; }

  // Test F: add created_at (full fallback query)
  try {
    const r = await sql`SELECT id, name, email, company, phone, role, email_verified, created_at FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.F_fullFallback = { role: r[0]?.role };
  } catch (e: any) { results.tests.F_fullFallback = { error: e.message }; }

  // Test G: just role column
  try {
    const r = await sql`SELECT role FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.G_justRole = { role: r[0]?.role };
  } catch (e: any) { results.tests.G_justRole = { error: e.message }; }

  // Test H: role with email_verified
  try {
    const r = await sql`SELECT role, email_verified FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.H_roleEmailVerified = { role: r[0]?.role, email_verified: r[0]?.email_verified };
  } catch (e: any) { results.tests.H_roleEmailVerified = { error: e.message }; }

  // Test I: role with created_at
  try {
    const r = await sql`SELECT role, created_at FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.I_roleCreatedAt = { role: r[0]?.role };
  } catch (e: any) { results.tests.I_roleCreatedAt = { error: e.message }; }

  // Test J: role with company
  try {
    const r = await sql`SELECT role, company FROM users WHERE id = ${id} LIMIT 1`;
    results.tests.J_roleCompany = { role: r[0]?.role };
  } catch (e: any) { results.tests.J_roleCompany = { error: e.message }; }

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}
