/**
 * Project access authority — "may this signed-in caller act on this project?".
 *
 * Projects are tenant-scoped by `projects.user_id`. The permit GET and the
 * permit preview already enforced the rule inline — the owning installer, or a
 * platform admin/super_admin — but `POST /api/engineering/permit` and the
 * drawing routes that read the stored combiner selection (SLD, SLD PDF, BOM)
 * never asked. Any signed-in user who knew another tenant's project UUID could
 * generate that project's permit package: the route read the victim's project
 * name, engineering_config, design_electrical and canonical roof geometry into
 * the returned HTML, and wrote project_files rows against the victim's project.
 *
 * This module is that one rule, so the sealed-artefact routes and their
 * previews cannot drift apart again.
 *
 * No DB import: the caller hands in its own sql handle, so a test (or a
 * DB-less harness) that fakes the route's `getDbReady` fakes this too.
 */

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export interface ProjectAccess {
  ok:      boolean;
  via:     'owner' | 'platform-admin' | null;
  status:  403 | 404 | null;
  error:   string | null;
  /** The project's owning user id when the project exists. */
  ownerId: string | null;
}

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'super_admin']);

export async function authorizeProjectAccess(opts: {
  sql:       SqlTag;
  projectId: string;
  user:      { id: string };
}): Promise<ProjectAccess> {
  const { sql, projectId, user } = opts;
  const rows = (await sql`
    SELECT id, user_id FROM projects WHERE id = ${projectId} AND deleted_at IS NULL LIMIT 1
  `) as Array<{ id: string; user_id: string }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, via: null, status: 404, error: 'Project not found', ownerId: null };
  }
  const ownerId = rows[0].user_id;
  if (ownerId === user.id) {
    return { ok: true, via: 'owner', status: null, error: null, ownerId };
  }
  // Role is read from the DB, never from the session token (same as
  // lib/adminAuth.ts).
  const roleRows = (await sql`SELECT role FROM users WHERE id = ${user.id} LIMIT 1`) as Array<{ role?: string }>;
  const role = Array.isArray(roleRows) ? roleRows[0]?.role : undefined;
  if (typeof role === 'string' && PLATFORM_ADMIN_ROLES.has(role)) {
    return { ok: true, via: 'platform-admin', status: null, error: null, ownerId };
  }
  // 403 without saying whether the project exists would be tidier, but the
  // existing GET answers 404/403 distinctly and the UUID is not guessable;
  // matching it keeps one behaviour across the permit routes.
  return { ok: false, via: null, status: 403, error: 'Forbidden', ownerId: null };
}

export type ProjectAccessGate =
  /** Caller may act on the project. */
  | { kind: 'granted'; via: 'owner' | 'platform-admin'; ownerId: string }
  /** Caller may not — answer with `status`. */
  | { kind: 'denied'; status: 403 | 404; error: string }
  /** No database is configured at all (DB-less harnesses / e2e): there is no
   *  tenant data any read could reach, so nothing to protect. */
  | { kind: 'no-database' }
  /** The check itself could not run (database error). */
  | { kind: 'unavailable'; error: string };

/**
 * The route-level form: takes the route's own `getDbReady` so a test that
 * fakes that handle fakes this, and classifies a missing DATABASE_URL apart
 * from a real failure. What a route does with `unavailable` is its call — the
 * permit (the sealed package) refuses; a drawing preview skips its stored
 * reads rather than reading project data it could not authorize.
 */
export async function gateProjectAccess(
  getSql: () => Promise<SqlTag>,
  projectId: string,
  user: { id: string },
): Promise<ProjectAccessGate> {
  let sql: SqlTag;
  try {
    sql = await getSql();
  } catch (err: unknown) {
    const { DbConfigError } = await import('@/lib/db-ready');
    if (err instanceof DbConfigError) return { kind: 'no-database' };
    return { kind: 'unavailable', error: (err as Error)?.message ?? String(err) };
  }
  try {
    const access = await authorizeProjectAccess({ sql, projectId, user });
    if (access.ok) return { kind: 'granted', via: access.via!, ownerId: access.ownerId! };
    return { kind: 'denied', status: access.status!, error: access.error! };
  } catch (err: unknown) {
    return { kind: 'unavailable', error: (err as Error)?.message ?? String(err) };
  }
}
