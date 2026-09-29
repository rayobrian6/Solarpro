/**
 * tests/adminCannotActOnEqualOrHigherRole.test.ts
 *
 * AN ADMIN ACTS ONLY ON ACCOUNTS IT OUTRANKS.
 *
 * requireAdminApi() proves the caller is an admin. Nothing asked whether the
 * TARGET was beneath them, so:
 *
 *   · a plain admin could PATCH /api/admin/users { action: 'reset_password' }
 *     on the owner (super_admin) — and the response handed back the new
 *     temporary password, i.e. a one-request account takeover;
 *   · the same admin could suspend the owner, rewrite their plan / free pass,
 *     or delete them by email through POST /api/admin/free-pass;
 *   · a super_admin could impersonate another super_admin;
 *   · company-wide actions rewrote every account in the company, the owner's
 *     included, whoever ran them.
 *
 * The rule (lib/adminRoleHierarchy.ts): strict rank — never a peer, never
 * higher, never yourself; an unknown target role is protected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/adminAuth', () => ({ requireAdminApi: vi.fn() }));
vi.mock('@/lib/db-neon', () => ({
  getDbReady:  vi.fn(),
  isValidUUID: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: vi.fn((_t: string, err: unknown) =>
    new Response(JSON.stringify({ success: false, error: String((err as Error)?.message ?? err) }),
      { status: 503, headers: { 'content-type': 'application/json' } })),
}));
vi.mock('@/lib/auth', () => ({
  getDbReady:  vi.fn(async () => currentSql),
  getUserFromRequest: vi.fn(() => null),
  hashPassword: vi.fn(async () => 'hashed'),
  signToken:    vi.fn(() => 'signed.jwt.token'),
}));
vi.mock('@/lib/adminActivityLog', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp:    vi.fn(() => '127.0.0.1'),
}));

import { NextRequest }     from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady }      from '@/lib/db-neon';
import { PATCH as USERS_PATCH, DELETE as USERS_DELETE } from '@/app/api/admin/users/route';
import { POST as FREE_PASS }      from '@/app/api/admin/free-pass/route';
import { POST as IMPERSONATE }    from '@/app/api/admin/impersonate/route';
import { PATCH as COMPANIES }     from '@/app/api/admin/companies/route';
import { canActOnAccount, rolesOutrankedBy } from '@/lib/adminRoleHierarchy';

// ── Accounts ────────────────────────────────────────────────────────────────

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const ACCOUNTS = {
  owner:  { id: U(1), email: 'owner@solarpro.test',  role: 'super_admin', company: 'Acme' },
  owner2: { id: U(2), email: 'owner2@solarpro.test', role: 'super_admin', company: 'Acme' },
  admin:  { id: U(3), email: 'admin@solarpro.test',  role: 'admin',       company: 'Acme' },
  admin2: { id: U(4), email: 'admin2@solarpro.test', role: 'admin',       company: 'Acme' },
  user:   { id: U(5), email: 'user@solarpro.test',   role: 'user',        company: 'Acme' },
  weird:  { id: U(6), email: 'weird@solarpro.test',  role: 'owner',       company: 'Acme' },
};
type Acct = typeof ACCOUNTS[keyof typeof ACCOUNTS];

interface Stmt { q: string; values: unknown[] }
let currentSql: ReturnType<typeof makeSql>;

function makeSql(tokenRow?: Record<string, unknown>) {
  const stmts: Stmt[] = [];
  const all = Object.values(ACCOUNTS);
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    stmts.push({ q, values });
    let out: unknown[] = [];
    if (/FROM admin_impersonation_tokens/i.test(q)) out = tokenRow ? [tokenRow] : [];
    else if (/^UPDATE admin_impersonation_tokens/i.test(q)) out = [{ id: 't1' }];
    else if (/^SELECT[\s\S]*FROM users WHERE id = \?/i.test(q)) out = all.filter(a => a.id === values[0]);
    else if (/^SELECT[\s\S]*FROM users WHERE email = \?/i.test(q)) out = all.filter(a => a.email === values[0]);
    else if (/^SELECT 1 FROM users WHERE id = \?/i.test(q)) out = all.filter(a => a.id === values[0]);
    return Promise.resolve(out);
  };
  const sql = Object.assign(tag, { stmts });
  currentSql = sql;
  return sql;
}

/** Statements that would change or remove the target's account row. */
function accountWrites(sql: { stmts: Stmt[] }, target: Acct) {
  return sql.stmts.filter(({ q, values }) =>
    /^(UPDATE|DELETE FROM) users/i.test(q) &&
    (values.includes(target.id) || values.includes(target.email)));
}

function mintedImpersonation(sql: { stmts: Stmt[] }) {
  return sql.stmts.filter(({ q }) => /^INSERT INTO admin_impersonation_tokens/i.test(q));
}

function as(actor: Acct) {
  vi.mocked(requireAdminApi).mockResolvedValue({ id: actor.id, name: actor.email, email: actor.email, role: actor.role } as never);
}

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

const USER_ACTIONS: Array<Record<string, unknown>> = [
  { action: 'reset_password' },
  { action: 'suspend' },
  { action: 'unsuspend' },
  { action: 'grant_free_pass' },
  { action: 'revoke_free_pass' },
  { action: 'reset_trial' },
  { action: 'set_plan', plan: 'starter' },
  { action: 'update', name: 'Renamed' },
];

beforeEach(() => {
  vi.clearAllMocks();
  const sql = makeSql();
  vi.mocked(getDbReady).mockResolvedValue(sql as never);
});

// ── The rule itself ─────────────────────────────────────────────────────────

describe('lib/adminRoleHierarchy — strict rank', () => {
  it('admin → user is allowed; admin → admin / super_admin / self is not', () => {
    const a = ACCOUNTS.admin;
    expect(canActOnAccount(a, ACCOUNTS.user).ok).toBe(true);
    expect(canActOnAccount(a, ACCOUNTS.admin2).ok).toBe(false);
    expect(canActOnAccount(a, ACCOUNTS.owner).ok).toBe(false);
    expect(canActOnAccount(a, a).ok).toBe(false);
  });
  it('super_admin → admin is allowed; super_admin → super_admin is not', () => {
    expect(canActOnAccount(ACCOUNTS.owner, ACCOUNTS.admin).ok).toBe(true);
    expect(canActOnAccount(ACCOUNTS.owner, ACCOUNTS.owner2).ok).toBe(false);
  });
  it('an unknown target role is protected; a missing target is 404', () => {
    expect(canActOnAccount(ACCOUNTS.owner, ACCOUNTS.weird).ok).toBe(false);
    expect(canActOnAccount(ACCOUNTS.owner, null).status).toBe(404);
  });
  it('bulk scoping lists only the roles beneath the actor', () => {
    expect(rolesOutrankedBy('admin').sort()).toEqual(['sales', 'staff', 'user']);
    expect(rolesOutrankedBy('super_admin')).not.toContain('super_admin');
    expect(rolesOutrankedBy('user')).toEqual([]);
  });
});

// ── /api/admin/users ────────────────────────────────────────────────────────

describe('🚨 a plain admin cannot touch the owner (super_admin)', () => {
  for (const body of USER_ACTIONS) {
    it(`PATCH ${body.action} on a super_admin is refused with no write`, async () => {
      as(ACCOUNTS.admin);
      const res = await USERS_PATCH(jsonReq('http://x/api/admin/users', 'PATCH', { id: ACCOUNTS.owner.id, ...body }));
      expect(res.status).toBe(403);
      expect(accountWrites(currentSql, ACCOUNTS.owner)).toHaveLength(0);
      const json = await res.json();
      expect(json.tempPassword).toBeUndefined();
    });
  }
});

describe('🚨 peers and self are refused too', () => {
  it('admin → another admin: reset_password refused', async () => {
    as(ACCOUNTS.admin);
    const res = await USERS_PATCH(jsonReq('http://x/api/admin/users', 'PATCH', { id: ACCOUNTS.admin2.id, action: 'reset_password' }));
    expect(res.status).toBe(403);
    expect(accountWrites(currentSql, ACCOUNTS.admin2)).toHaveLength(0);
  });
  it('admin → self: grant_free_pass refused', async () => {
    as(ACCOUNTS.admin);
    const res = await USERS_PATCH(jsonReq('http://x/api/admin/users', 'PATCH', { id: ACCOUNTS.admin.id, action: 'grant_free_pass' }));
    expect(res.status).toBe(403);
    expect(accountWrites(currentSql, ACCOUNTS.admin)).toHaveLength(0);
  });
  it('super_admin → another super_admin: reset_password / impersonate / set_role refused', async () => {
    as(ACCOUNTS.owner);
    for (const body of [{ action: 'reset_password' }, { action: 'impersonate' }, { action: 'set_role', role: 'user' }]) {
      makeSql(); vi.mocked(getDbReady).mockResolvedValue(currentSql as never);
      const res = await USERS_PATCH(jsonReq('http://x/api/admin/users', 'PATCH', { id: ACCOUNTS.owner2.id, ...body }));
      expect(res.status).toBe(403);
      expect(accountWrites(currentSql, ACCOUNTS.owner2)).toHaveLength(0);
      expect(mintedImpersonation(currentSql)).toHaveLength(0);
    }
  });
  it('super_admin → another super_admin: DELETE refused', async () => {
    as(ACCOUNTS.owner);
    const res = await USERS_DELETE(jsonReq(`http://x/api/admin/users?id=${ACCOUNTS.owner2.id}`, 'DELETE', {}));
    expect(res.status).toBe(403);
    expect(accountWrites(currentSql, ACCOUNTS.owner2)).toHaveLength(0);
  });
  it('an unknown target role is refused', async () => {
    as(ACCOUNTS.owner);
    const res = await USERS_PATCH(jsonReq('http://x/api/admin/users', 'PATCH', { id: ACCOUNTS.weird.id, action: 'suspend' }));
    expect(res.status).toBe(403);
    expect(accountWrites(currentSql, ACCOUNTS.weird)).toHaveLength(0);
  });
});

describe('legitimate administration still works', () => {
  it('admin → user: reset_password succeeds', async () => {
    as(ACCOUNTS.admin);
    const res = await USERS_PATCH(jsonReq('http://x/api/admin/users', 'PATCH', { id: ACCOUNTS.user.id, action: 'reset_password' }));
    expect(res.status).toBe(200);
    expect(accountWrites(currentSql, ACCOUNTS.user).length).toBeGreaterThan(0);
  });
  it('super_admin → admin: suspend succeeds', async () => {
    as(ACCOUNTS.owner);
    const res = await USERS_PATCH(jsonReq('http://x/api/admin/users', 'PATCH', { id: ACCOUNTS.admin.id, action: 'suspend' }));
    expect(res.status).toBe(200);
    expect(accountWrites(currentSql, ACCOUNTS.admin).length).toBeGreaterThan(0);
  });
  it('super_admin → user: impersonate mints a token', async () => {
    as(ACCOUNTS.owner);
    const res = await USERS_PATCH(jsonReq('http://x/api/admin/users', 'PATCH', { id: ACCOUNTS.user.id, action: 'impersonate' }));
    expect(res.status).toBe(200);
    expect(mintedImpersonation(currentSql)).toHaveLength(1);
  });
  it('super_admin → user: DELETE succeeds', async () => {
    as(ACCOUNTS.owner);
    const res = await USERS_DELETE(jsonReq(`http://x/api/admin/users?id=${ACCOUNTS.user.id}`, 'DELETE', {}));
    expect(res.status).toBe(200);
  });
});

// ── /api/admin/free-pass (by email) ─────────────────────────────────────────

describe('🚨 /api/admin/free-pass cannot reach an equal-or-higher account by email', () => {
  for (const action of ['delete', 'grant', 'revoke']) {
    it(`admin ${action} on the owner's email is refused with no write`, async () => {
      as(ACCOUNTS.admin);
      const res = await FREE_PASS(jsonReq('http://x/api/admin/free-pass', 'POST', { email: ACCOUNTS.owner.email, action }));
      expect(res.status).toBe(403);
      expect(accountWrites(currentSql, ACCOUNTS.owner)).toHaveLength(0);
    });
  }
  it('admin grant on a user still works', async () => {
    as(ACCOUNTS.admin);
    const res = await FREE_PASS(jsonReq('http://x/api/admin/free-pass', 'POST', { email: ACCOUNTS.user.email, action: 'grant' }));
    expect(res.status).toBe(200);
    expect(accountWrites(currentSql, ACCOUNTS.user).length).toBeGreaterThan(0);
  });
});

// ── Impersonation consumption re-checks the boundary ────────────────────────

describe('🚨 an impersonation token cannot become a session on a protected account', () => {
  const TOKEN = 'a'.repeat(96);
  function tokenRow(minter: Acct, target: Acct) {
    return {
      id: 't1', admin_id: minter.id, target_id: target.id, used: false,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      uid: target.id, name: target.email, email: target.email, company: target.company, role: target.role,
    };
  }
  it('refuses a token whose target now outranks-or-equals its minter', async () => {
    as(ACCOUNTS.owner);
    const sql = makeSql(tokenRow(ACCOUNTS.owner, ACCOUNTS.owner2));
    vi.mocked(getDbReady).mockResolvedValue(sql as never);
    const res = await IMPERSONATE(jsonReq('http://x/api/admin/impersonate', 'POST', { token: TOKEN }));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/solarpro_session=signed/);
  });
  it('refuses a token presented by an admin other than its minter', async () => {
    as(ACCOUNTS.owner2);
    const sql = makeSql(tokenRow(ACCOUNTS.owner, ACCOUNTS.user));
    vi.mocked(getDbReady).mockResolvedValue(sql as never);
    const res = await IMPERSONATE(jsonReq('http://x/api/admin/impersonate', 'POST', { token: TOKEN }));
    expect(res.status).toBe(403);
  });
  it('honours a token its own minter presents for a user', async () => {
    as(ACCOUNTS.owner);
    const sql = makeSql(tokenRow(ACCOUNTS.owner, ACCOUNTS.user));
    vi.mocked(getDbReady).mockResolvedValue(sql as never);
    const res = await IMPERSONATE(jsonReq('http://x/api/admin/impersonate', 'POST', { token: TOKEN }));
    expect(res.status).toBe(200);
  });
});

// ── Company-wide actions only touch accounts beneath the actor ──────────────

describe('🚨 company-wide actions are scoped to accounts the actor outranks', () => {
  for (const body of [
    { action: 'grant_free_pass' }, { action: 'revoke_free_pass' },
    { action: 'change_plan', plan: 'starter' }, { action: 'enable_company' },
  ]) {
    it(`admin ${body.action}: every users write carries a role scope excluding admin/super_admin`, async () => {
      as(ACCOUNTS.admin);
      const res = await COMPANIES(jsonReq('http://x/api/admin/companies', 'PATCH', { company: 'Acme', ...body }));
      expect(res.status).toBe(200);
      const writes = currentSql.stmts.filter(s => /^UPDATE users/i.test(s.q));
      expect(writes.length).toBeGreaterThan(0);
      for (const w of writes) {
        expect(w.q).toMatch(/role/i);
        const scope = w.values.find(Array.isArray) as string[] | undefined;
        expect(scope, 'role scope bound as an array').toBeDefined();
        expect(scope).not.toContain('admin');
        expect(scope).not.toContain('super_admin');
      }
    });
  }
  it('super_admin disable_company does not suspend any super_admin', async () => {
    as(ACCOUNTS.owner);
    await COMPANIES(jsonReq('http://x/api/admin/companies', 'PATCH', { company: 'Acme', action: 'disable_company' }));
    const writes = currentSql.stmts.filter(s => /^UPDATE users/i.test(s.q));
    for (const w of writes) {
      const scope = w.values.find(Array.isArray) as string[] | undefined;
      expect(scope).toBeDefined();
      expect(scope).not.toContain('super_admin');
    }
  });
});
