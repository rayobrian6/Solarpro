/**
 * Proposal read authority — the single gate for "may this caller see this proposal?".
 *
 * A proposal row carries pricing, the client's name and the site address, so
 * every endpoint that returns one must pass through here. There are exactly two
 * ways in:
 *
 *   1. owner       — an authenticated installer whose project owns the proposal
 *   2. share-token — an unauthenticated homeowner holding a live share token
 *
 * Nothing else. Knowing the proposal UUID is not access.
 *
 * Expiry follows the convention the rest of the app already uses
 * (app/api/portal/dashboard/route.ts):
 *     share_expires_at IS NULL OR share_expires_at > NOW()
 * A NULL expiry means "never expires" — proposals get a share_token at creation
 * (app/api/proposals/route.ts) and only receive the 30-day share_expires_at when
 * they are explicitly shared (app/api/proposals/[id]/share/route.ts).
 */

import { timingSafeEqual } from 'crypto';

/** Structural sql type — mirrors SqlExecutorLike in lib/auditLog.ts. */
export type ProposalSqlExecutor = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown[]>;

/**
 * Constant-time string comparison, so a wrong token cannot be recovered one
 * character at a time by timing the response.
 *
 * Length is not a secret (Buffer lengths must match before timingSafeEqual will
 * run at all), and a null/empty side is always a refusal — a proposal with no
 * share_token was never shared, so no token can unlock it.
 */
export function safeStrEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Has the share link passed its expiry?
 *
 * NULL / undefined / '' -> false (no expiry was ever set; see the header note).
 * An unparseable value is reported as not-expired but warned about: the token
 * check still gates access, and silently locking every homeowner out of a live
 * link because of a timestamp format surprise would be the worse failure.
 */
export function isShareLinkExpired(expiresAt: unknown, now: number = Date.now()): boolean {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return false;
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt));
  if (Number.isNaN(ms)) {
    console.warn('[proposalAccess] unparseable share_expires_at, treating as no expiry:', expiresAt);
    return false;
  }
  return ms <= now;
}

/**
 * One flat shape rather than a discriminated union: this repo compiles with
 * `strict: false`, where an `ok: true | false` union does not narrow, so every
 * field has to exist on the single type.
 */
export interface ProposalReadAccess {
  /** Granted? Nothing else on this object matters until you have checked it. */
  ok:     boolean;
  /** How access was granted — null when refused. */
  via:    'owner' | 'share-token' | null;
  /** HTTP status to return on a refusal — null when granted. */
  status: 403 | null;
  /** Client-facing refusal message — null when granted. */
  error:  string | null;
  /** Server-side refusal reason, for logs. Never send this to the client. */
  reason: string | null;
}

/** Single client-facing refusal message — it must not distinguish the reasons. */
const DENIED = 'This proposal link is invalid or has expired.';

const grant = (via: 'owner' | 'share-token'): ProposalReadAccess =>
  ({ ok: true, via, status: null, error: null, reason: null });

const deny = (reason: string): ProposalReadAccess =>
  ({ ok: false, via: null, status: 403, error: DENIED, reason });

/**
 * Decide whether `user` and/or `token` may read proposal `row`.
 *
 * The caller has already loaded the row (a missing row is its own 404). This
 * performs at most one extra query: the ownership JOIN, and only when a session
 * is present.
 */
export async function authorizeProposalRead(opts: {
  sql:        ProposalSqlExecutor;
  proposalId: string;
  row:        Record<string, unknown>;
  user:       { id: string } | null | undefined;
  token:      string | null | undefined;
  now?:       number;
}): Promise<ProposalReadAccess> {
  const { sql, proposalId, row, user, token, now = Date.now() } = opts;

  // ── 1. Owner path ────────────────────────────────────────────────────────
  // An installer reading their own proposal needs no token. Ownership is the
  // same projects JOIN the PUT/PATCH/DELETE handlers in this route already use.
  if (user?.id) {
    const owned = await sql`
      SELECT p.id
      FROM proposals p
      JOIN projects proj ON proj.id = p.project_id
      WHERE p.id = ${proposalId}
        AND proj.user_id = ${user.id}
      LIMIT 1
    `;
    if (owned.length > 0) return grant('owner');
    // Not the owner — fall through. A logged-in visitor holding a valid share
    // link (a colleague, or the installer opening a client's link) still gets in
    // on the token, and gets nothing without one.
  }

  // ── 2. Share-token path ──────────────────────────────────────────────────
  const shareToken = row.share_token as string | null | undefined;
  if (!token)                           return deny('no_token');
  if (!shareToken)                      return deny('proposal_never_shared');
  if (!safeStrEqual(shareToken, token)) return deny('token_mismatch');
  if (isShareLinkExpired(row.share_expires_at, now)) return deny('token_expired');

  return grant('share-token');
}
