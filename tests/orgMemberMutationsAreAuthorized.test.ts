// ═══════════════════════════════════════════════════════════════════════════
// FOUR MEMBER MUTATIONS RAN WITH NO AUTHORIZATION AT ALL
//
// `app/api/organizations/[id]/members/[userId]/route.ts` is governed by two
// INDEPENDENT flags that govern different things:
//
//   ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED  — may these mutations run (501 if not)
//   ENTERPRISE_ORG_AUTHORITY_ENABLED         — is the authority engine in the path
//
// Every mutation wrapped its `enforceMemberAction` call in the SECOND flag. That is
// the documented architecture and it is correct — AUTHORITY-BOUNDARY.md says the flag
// "controls whether routes enter the authority path at all — it does not weaken
// enforcement within that path", and the route header scopes its fail-closed promise
// to "when the authority master switch is on".
//
// 🚨 THE DEFECT WAS WHAT SAT BEHIND IT: NOTHING. With WRITE=true and AUTHORITY unset
// — the natural order, since the 501 message names only the WRITE flag — role change,
// suspend, reactivate and remove executed with no caller check whatsoever.
// `changeMemberRole` and `removeMember` take no actor argument and check only that the
// TARGET is a member plus the last-owner rule; `lib/organizations/service.ts` states
// outright that "Authorization is NOT enforced here — callers must check authorize()".
//
// So any authenticated user knowing an org UUID and a member UUID could PATCH
// `{role:'owner'}` onto that member, or DELETE them. A viewer could promote THEMSELVES
// to owner. And `changeMemberRole` also writes `users.org_role` — the column the
// legacy path itself reads — so the escalation persisted into the source of truth that
// governs while the switch is off.
//
// The sibling route already had a legacy branch for this case, but its check is "is a
// member", which is right for a READ and insufficient for a MUTATION.
//
// 🚨 NOTE ON HOW THIS WAS ESTABLISHED. Of three independent verifiers, one REFUTED the
// finding — correctly pointing out that the flag-conditional is documented intent and
// that the original report MISQUOTED the route header. Both of those are true, and
// neither disposes of the hole: the conditional is fine, the empty `else` was not.
// The refutation improved the fix (keep the conditional, add the legacy branch)
// instead of killing it.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const ROUTE = join(ROOT, 'app', 'api', 'organizations', '[id]', 'members', '[userId]', 'route.ts');
const src = () => readFileSync(ROUTE, 'utf8');

/** Each mutation's authority call, and the text that follows it up to the next call. */
function branchAfter(action: string): string {
  const s = src();
  const at = s.indexOf(`enforceMemberAction(user.id, orgId, targetUserId, '${action}')`);
  expect(at, `the '${action}' authority call is gone — this guard is blind`).toBeGreaterThan(-1);
  // The whole if/else construct: from the `if (isOrgAuthorityEnabled())` that owns it
  // to the end of the else block.
  const ifAt = s.lastIndexOf('if (isOrgAuthorityEnabled())', at);
  expect(ifAt).toBeGreaterThan(-1);
  return s.slice(ifAt, at + 600);
}

const MUTATIONS = ['change_role', 'suspend', 'reactivate', 'remove'] as const;

describe('🚨 every member mutation is authorized on BOTH sides of the master switch', () => {
  it.each(MUTATIONS)('%s has a legacy guard when the authority engine is off', (action) => {
    const branch = branchAfter(action);
    expect(branch, `'${action}' still has an empty else — it runs with no caller check when the authority switch is off`)
      .toMatch(/else\s*\{/);
    expect(branch, `'${action}' does not consult the legacy guard`)
      .toMatch(/legacyMemberManagementGuard\(/);
    expect(branch, `'${action}' calls the legacy guard and ignores its answer`)
      .toMatch(/if \(denied\) return denied;/);
  });

  it.each(MUTATIONS)('%s still gates the authority engine on the master switch', (action) => {
    // The fix must not "solve" this by calling enforceMemberAction unconditionally.
    // That would put the authority engine in the path with the master switch OFF,
    // which AUTHORITY-BOUNDARY.md explicitly says the flag exists to prevent.
    //
    // 🚨 ANCHORED ON WHAT IMMEDIATELY PRECEDES THE CALL. A first version searched
    // backwards with `lastIndexOf` from the call, and a mutation replacing this
    // path's own `if (isOrgAuthorityEnabled())` with `if (true)` PASSED — the
    // backward search simply found a DIFFERENT mutation's conditional further up
    // the file. Each path must be checked against its own guard, not the nearest
    // one that happens to be above it.
    const s = src();
    const at = s.indexOf(`enforceMemberAction(user.id, orgId, targetUserId, '${action}')`);
    expect(at, `the '${action}' authority call is gone`).toBeGreaterThan(-1);
    const immediatelyBefore = s.slice(Math.max(0, at - 80), at);
    expect(immediatelyBefore, `'${action}' no longer gates the authority engine on the master switch`)
      .toMatch(/if \(isOrgAuthorityEnabled\(\)\)\s*\{\s*await\s*$/);
  });
});

describe('the legacy rule itself', () => {
  const guard = () => {
    const s = src();
    const at = s.indexOf('async function legacyMemberManagementGuard');
    expect(at, 'the legacy guard is gone').toBeGreaterThan(-1);
    return s.slice(at, s.indexOf('\n}', at));
  };

  it('🚨 requires a ROLE, not merely membership', () => {
    // The sibling route's legacy check is "is a member", which is right for a read.
    // For a mutation it would still let a viewer promote themselves — the exact
    // escalation this exists to stop.
    const g = guard();
    expect(g).toMatch(/org_role/);
    expect(g, 'any member can still manage members').toMatch(/'owner'/);
    expect(g).toMatch(/'admin'/);
  });

  it('🚨 only an owner may grant the owner role', () => {
    // An admin who could grant ownership could grant it to themselves.
    expect(guard()).toMatch(/grantingOwner/);
  });

  it('is applied with grantingOwner on the role-change path only', () => {
    const s = src();
    expect(s).toMatch(/legacyMemberManagementGuard\(user\.id, orgId, \{ grantingOwner: newRole === 'owner' \}\)/);
  });

  it('denies a non-member before it looks at any role', () => {
    const g = guard();
    const notMember = g.indexOf('not a member of this organization');
    const roleCheck = g.indexOf("callerRole !== 'owner'");
    expect(notMember, 'a non-member is no longer rejected').toBeGreaterThan(-1);
    expect(roleCheck).toBeGreaterThan(-1);
    expect(notMember, 'the role check runs before the membership check').toBeLessThan(roleCheck);
  });
});
