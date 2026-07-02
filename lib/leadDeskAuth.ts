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
import { verifyTokenWithMeta, isSessionStale } from "@/lib/auth";
import { getDbWithRetry } from "@/lib/db-ready";

export type DeskUser = { id: string; name: string; email: string; role: string };
type DeskRow = DeskUser & { password_changed_at: string | null };
const ALLOWED = new Set(["admin", "super_admin", "sales"]);
export function isDeskRole(role?: string | null): boolean {
  return !!role && ALLOWED.has(role);
}

async function lookup(userId: string): Promise<DeskRow | null> {
  const sql = await getDbWithRetry();
  // Best-effort password_changed_at (migration 094) — fall back without it so
  // the desk keeps working pre-migration.
  try {
    const rows = await sql`SELECT id, name, email, role, password_changed_at FROM users WHERE id = ${userId} LIMIT 1`;
    return (rows[0] as DeskRow) ?? null;
  } catch (e: unknown) {
    const msg = ((e as Error)?.message || "").toLowerCase();
    if (msg.includes("column") && msg.includes("does not exist")) {
      const rows = await sql`SELECT id, name, email, role FROM users WHERE id = ${userId} LIMIT 1`;
      const r = rows[0] as DeskUser | undefined;
      return r ? { ...r, password_changed_at: null } : null;
    }
    throw e;
  }
}

/** API guard — returns the user if they may use the desk, else null. */
export async function requireDeskApi(req: NextRequest): Promise<DeskUser | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);
  if (!match) return null;
  const jwtMeta = verifyTokenWithMeta(match[1]);
  if (!jwtMeta?.user?.id) return null;
  try {
    const user = await lookup(jwtMeta.user.id);
    if (!user) return null;
    if (isSessionStale(jwtMeta.iat, user.password_changed_at)) return null; // logged out by password reset
    return isDeskRole(user.role) ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
  } catch {
    return null;
  }
}

/** Page guard — redirects to login/dashboard if not allowed. */
export async function requireDeskPage(): Promise<DeskUser> {
  const token = cookies().get("solarpro_session")?.value;
  if (!token) redirect("/auth/login?redirect=/desk");
  const jwtMeta = verifyTokenWithMeta(token);
  if (!jwtMeta?.user?.id) redirect("/auth/login?redirect=/desk");
  let user: DeskRow | null = null;
  try { user = await lookup(jwtMeta.user.id); } catch { /* */ }
  if (!user) redirect("/auth/login?redirect=/desk");
  if (isSessionStale(jwtMeta.iat, user.password_changed_at)) redirect("/auth/login?redirect=/desk");
  if (!isDeskRole(user.role)) redirect("/dashboard");
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
