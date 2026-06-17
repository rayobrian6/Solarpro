/**
 * lib/leadDeskAuth.ts
 *
 * Auth for the Lead Desk — the scoped, sales-only surface. Admins/super-admins
 * always have access; a sales rep gets in with role 'sales' (set on their user)
 * WITHOUT being granted the rest of the admin portal. Used by /desk (page) and
 * /api/lead-desk/* (api).
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";
import { getDbWithRetry } from "@/lib/db-ready";

export type DeskUser = { id: string; name: string; email: string; role: string };
const ALLOWED = new Set(["admin", "super_admin", "sales"]);
export function isDeskRole(role?: string | null): boolean {
  return !!role && ALLOWED.has(role);
}

async function lookup(userId: string): Promise<DeskUser | null> {
  const sql = await getDbWithRetry();
  const rows = await sql`SELECT id, name, email, role FROM users WHERE id = ${userId} LIMIT 1`;
  if (rows.length === 0) return null;
  return rows[0] as DeskUser;
}

/** API guard — returns the user if they may use the desk, else null. */
export async function requireDeskApi(req: NextRequest): Promise<DeskUser | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);
  if (!match) return null;
  const jwtUser = verifyToken(match[1]);
  if (!jwtUser?.id) return null;
  try {
    const user = await lookup(jwtUser.id);
    return user && isDeskRole(user.role) ? user : null;
  } catch {
    return null;
  }
}

/** Page guard — redirects to login/dashboard if not allowed. */
export async function requireDeskPage(): Promise<DeskUser> {
  const token = cookies().get("solarpro_session")?.value;
  if (!token) redirect("/auth/login?redirect=/desk");
  const jwtUser = verifyToken(token);
  if (!jwtUser?.id) redirect("/auth/login?redirect=/desk");
  let user: DeskUser | null = null;
  try { user = await lookup(jwtUser.id); } catch { /* */ }
  if (!user) redirect("/auth/login?redirect=/desk");
  if (!isDeskRole(user.role)) redirect("/dashboard");
  return user;
}
