/**
 * Admin role hierarchy — the single answer to "may this admin act on that
 * account?".
 *
 * requireAdminApi() answers "is the caller an admin?". It never asked the
 * second question, so every admin action reached every account: a plain admin
 * could reset a super_admin's password (and was handed the temporary password
 * in the response), suspend them, change their plan, delete them by email
 * through /api/admin/free-pass, or — as a super_admin — impersonate another
 * super_admin.
 *
 * The rule is strict rank: an actor may act only on an account it OUTRANKS.
 * That excludes peers and the actor's own account (self-service goes through
 * the account's own settings, not the admin console). An unknown role on the
 * TARGET is treated as the highest rank (fail closed — a role this table does
 * not know about is not something an admin may assume is beneath them); an
 * unknown role on the ACTOR carries no rank.
 *
 * Pure module — no Next.js or DB imports — so every route and test can use it.
 */

const ROLE_RANK: Readonly<Record<string, number>> = Object.freeze({
  user:        0,
  sales:       1,
  staff:       1,
  admin:       2,
  super_admin: 3,
});

const UNKNOWN_TARGET_RANK = Number.POSITIVE_INFINITY;

function normalize(role: unknown): string | null {
  if (typeof role !== 'string') return null;
  const r = role.trim().toLowerCase();
  return r === '' ? null : r;
}

/** Rank of the acting admin. Unknown/missing roles carry no authority. */
export function actorRank(role: unknown): number {
  const r = normalize(role);
  return r !== null && r in ROLE_RANK ? ROLE_RANK[r] : -1;
}

/** Rank of the account being acted on. Missing = 'user'; unknown = protected. */
export function targetRank(role: unknown): number {
  const r = normalize(role) ?? 'user';
  return r in ROLE_RANK ? ROLE_RANK[r] : UNKNOWN_TARGET_RANK;
}

/**
 * Every known role the actor strictly outranks. Used to scope bulk writes
 * (e.g. company-wide plan changes) to the rows the actor may touch. NULL roles
 * are treated as 'user' by callers via COALESCE(role, 'user').
 */
export function rolesOutrankedBy(role: unknown): string[] {
  const rank = actorRank(role);
  return Object.keys(ROLE_RANK).filter(r => ROLE_RANK[r] < rank);
}

export interface AdminTargetVerdict {
  ok:     boolean;
  status: 403 | 404 | null;
  error:  string | null;
  reason: 'target-not-found' | 'self' | 'equal-or-higher-role' | null;
}

export const OUTRANK_MESSAGE =
  'Admin actions can only target accounts with a lower role than yours.';

/**
 * May `actor` act on `target`? Callers pass the target row they already
 * loaded (id + role); a missing row is a 404, never a silent no-op write.
 */
export function canActOnAccount(
  actor:  { id: string; role: unknown },
  target: { id: string; role?: unknown } | null | undefined,
): AdminTargetVerdict {
  if (!target) {
    return { ok: false, status: 404, error: 'User not found.', reason: 'target-not-found' };
  }
  if (target.id === actor.id) {
    return {
      ok: false, status: 403, reason: 'self',
      error: 'Admin actions cannot target your own account — use your account settings.',
    };
  }
  if (actorRank(actor.role) <= targetRank(target.role)) {
    return { ok: false, status: 403, error: OUTRANK_MESSAGE, reason: 'equal-or-higher-role' };
  }
  return { ok: true, status: null, error: null, reason: null };
}
