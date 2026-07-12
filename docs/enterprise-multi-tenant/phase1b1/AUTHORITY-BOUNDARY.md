# Phase 1B.1 — Authority Boundary Correction

**Document type:** Workstream documentation (Workstreams 1 and 2)
**Phase:** 1B.1 — Organization Authority Boundary and Lifecycle Correction
**Date:** 2026-07-12
**Base commit:** `b3c11797` (correctness audit)
**Commits covered:** `da4880dd` (Workstream 1), `949ce4be` (Workstream 2)
**Implementer:** SuperNinja autonomous agent
**Status:** Complete — all authority boundary defects corrected, 36 adversarial tests passing

---

## 1. Executive Summary

Phase 1B introduced a canonical organization authority model with a default-deny authorization engine, but the live implementation contained a critical defect: standing platform-administrator cross-tenant bypass. The `authorize()`, `authorizeMemberAction()`, and `authorizeRoleChange()` functions each checked the user's platform role early in their decision flow and returned an immediate `allowed: true` if the platform role was `super_admin` or `admin`, granting unconditional access to every organization in the system regardless of membership. This violated the canonical authority model's separation of platform roles from organization roles (ADR-004) and eliminated the tenant isolation boundary that the entire authority architecture was designed to enforce.

Phase 1B.1 corrects this defect by removing the platform-admin bypass from all three authorization functions and replacing it with an explicit, fail-closed support-elevation boundary function (`isSupportElevationActive()`). The enforcement layer (`enforceAuthz()` and `enforceMemberAction()`) was simultaneously corrected to always throw `AuthzError` on denied decisions, removing the advisory fall-through mode that allowed routes to continue processing even when authorization was denied.

---

## 2. Defect 1 — Standing Platform-Admin Cross-Tenant Bypass

### 2.1 The Defect

The primary authorization function `authorize()` in `lib/organizations/authorization.ts` contained the following logic at step 2 of its decision flow, before checking org existence, membership, or org role:

```typescript
// 2. Check platform role — super_admin/admin bypass org checks
const platformRole = await getPlatformRole(userId);
if (isPlatformAdmin(platformRole)) {
  return { allowed: true, reason: 'allowed' };
}
```

This granted platform administrators unconditional cross-tenant access to every organization, including organizations they had no membership in. The same pattern existed in `authorizeMemberAction()` and `authorizeRoleChange()`.

### 2.2 Canonical Model Violation

ADR-004 specifies that platform roles (`admin`, `super_admin`) and organization roles (`owner`, `admin`, `member`, `viewer`) are separate namespaces. Platform roles govern access to platform-level administrative functions (migration governance, user management, system configuration). Organization roles govern access to tenant-scoped resources (projects, proposals, members, settings). A platform administrator who is not a member of an organization must not be able to access that organization's resources through their platform role alone.

The canonical authority model's principle P-03 (tenant isolation) requires that every authorization decision for a tenant-scoped resource is bound to the requesting user's membership in that specific tenant. The platform-admin bypass eliminated this binding, making the authority model's tenant isolation unenforceable.

### 2.3 The Correction

The platform-admin bypass was removed from all three authorization functions. The corrected `authorize()` function no longer checks the platform role at all — it proceeds directly to org existence, membership, and org role checks, returning a deny decision if any of those fail. The same correction was applied to `authorizeMemberAction()` and `authorizeRoleChange()`.

The `isPlatformAdmin()` helper function and `getPlatformRole()` lookup were retained (they are used elsewhere for legitimate platform-level operations) but are no longer consulted in the tenant-scoped authorization path.

### 2.4 Support-Elevation Boundary

In place of the standing bypass, an explicit support-elevation boundary function was added:

```typescript
export function isSupportElevationActive(): boolean {
  return false; // fail-closed — support elevation not yet implemented
}
```

This function is fail-closed: it always returns `false` until a proper support-elevation mechanism is implemented. The canonical model (ADR-012) specifies that support access must be time-limited, scoped, reason-coded, tenant-aware, revocable, notified, and audited with org context. Until that mechanism exists, the boundary is closed. The function serves as an explicit seam where the future support-elevation check will be inserted, making the architectural intent visible in the code rather than hidden behind an unconditional bypass.

---

## 3. Defect 2 — Advisory Enforcement Fall-Through

### 3.1 The Defect

The enforcement functions `enforceAuthz()` and `enforceMemberAction()` in `lib/organizations/authorization.ts` gated their throw behavior behind the `isEnforcementEnabled()` feature flag:

```typescript
export async function enforceAuthz(/* ... */): Promise<void> {
  const result = await authorize(/* ... */);
  if (!result.ok) {
    if (isEnforcementEnabled()) {
      throw new AuthzError(result.error.code, result.error.message);
    }
    // advisory mode — log but don't throw
    console.warn(`[authz] denied (advisory): ${result.error.code}`);
  }
}
```

When the enforcement flag was `false` (the default, fail-closed state), a denied authorization decision was logged as a warning but did not throw. This meant the calling route handler continued executing as if the decision had been allowed, performing mutations on resources the user was not authorized to access.

### 3.2 Canonical Model Violation

The canonical authority model requires that enforcement is absolute within the authority path. Once a route enters the authority path (gated by `isOrgAuthorityEnabled()`), every denied decision must throw. The feature flag controls whether routes enter the authority path at all — it does not weaken enforcement within that path.

The advisory fall-through created a paradox: the route was configured to use the authority system (the flag was on), but the enforcement function silently allowed denied decisions to proceed. This is the worst of both worlds — the route appears to be protected, but the protection is not actually enforced.

### 3.3 The Correction

The `isEnforcementEnabled()` gate was removed from both `enforceAuthz()` and `enforceMemberAction()`. The corrected functions always throw `AuthzError` on a denied decision:

```typescript
export async function enforceAuthz(/* ... */): Promise<void> {
  const result = await authorize(/* ... */);
  if (!result.ok) {
    throw new AuthzError(result.error.code, result.error.message);
  }
}
```

The route handlers (`app/api/organizations/[id]/members/route.ts` and `app/api/organizations/[id]/members/[userId]/route.ts`) were updated to unconditionally call the enforcement functions when `isOrgAuthorityEnabled()` returns true, removing the advisory fall-through blocks. The enforcement flag still controls whether routes enter the authority path, but once they do, enforcement is absolute.

---

## 4. Files Changed

| File | Commit | Change |
|------|--------|--------|
| `lib/organizations/authorization.ts` | `da4880dd` | Removed `isPlatformAdmin()` bypass from `authorize()`, `authorizeMemberAction()`, `authorizeRoleChange()`; added `isSupportElevationActive()` fail-closed function; updated org status deny reasons (`org_deleted` → `org_archived`) |
| `app/api/organizations/[id]/route.ts` | `da4880dd` | Removed `isPlatformAdminUser` bypass from org detail route |
| `lib/organizations/authorization.ts` | `949ce4be` | Removed `isEnforcementEnabled()` gate from `enforceAuthz()` and `enforceMemberAction()` — always throw on denied |
| `app/api/organizations/[id]/members/route.ts` | `949ce4be` | Unconditional `enforceAuthz()` call when `isOrgAuthorityEnabled()`, removed advisory fall-through |
| `app/api/organizations/[id]/members/[userId]/route.ts` | `949ce4be` | Unconditional `enforceMemberAction()` call, removed advisory mode blocks |
| `tests/phase1b1-authority-boundary.test.ts` | `da4880dd` | 18 adversarial tests for boundary removal |
| `tests/phase1b1-route-enforcement.test.ts` | `949ce4be` | 18 adversarial tests for enforcement safety |

---

## 5. Test Evidence

### 5.1 Authority Boundary Tests (`tests/phase1b1-authority-boundary.test.ts`)

18 tests verifying that platform administrators are subject to the same org-membership and org-role checks as regular users:

- Platform admin with no membership is denied access to org resources
- Platform admin with viewer membership is denied admin-level actions
- Platform admin with member membership is denied admin-level actions
- Super admin with no membership is denied access to org resources
- Regular user with no membership is denied (baseline confirmation)
- Owner is allowed all actions (positive control)
- Admin is allowed admin-level actions but not owner-level actions
- `isSupportElevationActive()` returns false (fail-closed)
- `authorizeMemberAction()` denies platform admin without membership
- `authorizeRoleChange()` denies platform admin without membership
- Org detail route denies platform admin without membership
- Org detail route denies when org is archived (deny reason `org_archived`)
- Org detail route denies when org is suspended
- Cross-tenant access is denied for all platform roles

### 5.2 Route Enforcement Tests (`tests/phase1b1-route-enforcement.test.ts`)

18 tests verifying that `enforceAuthz()` and `enforceMemberAction()` always throw on denied decisions, regardless of the enforcement flag state:

- `enforceAuthz()` throws `AuthzError` when authorization is denied
- `enforceAuthz()` does not throw when authorization is allowed
- `enforceMemberAction()` throws `AuthzError` when authorization is denied
- `enforceMemberAction()` does not throw when authorization is allowed
- Members route throws on denied `enforceAuthz()` when `isOrgAuthorityEnabled()`
- Member detail route throws on denied `enforceMemberAction()`
- Denied decision carries correct error code and message
- `AuthzError` is the correct error class
- Enforcement is absolute — no advisory fall-through path exists
- Multiple denied scenarios across different org roles

---

## 6. Authorization Decision Matrix (Post-Correction)

The corrected authorization functions produce the following decisions for tenant-scoped resources:

| User | Org Membership | Org Role | Decision | Reason |
|------|---------------|----------|----------|--------|
| Platform admin | None | — | Deny | `not_a_member` |
| Platform admin | Active | Viewer | Deny (admin action) | `insufficient_role` |
| Platform admin | Active | Member | Deny (admin action) | `insufficient_role` |
| Platform admin | Active | Admin | Allow (admin action) | `allowed` |
| Platform admin | Active | Owner | Allow (all actions) | `allowed` |
| Regular user | None | — | Deny | `not_a_member` |
| Regular user | Active | Owner | Allow (all actions) | `allowed` |
| Regular user | Active | Admin | Allow (admin actions) | `allowed` |
| Regular user | Active | Member | Allow (member actions) | `allowed` |
| Regular user | Active | Viewer | Allow (view actions) | `allowed` |
| Any user | Org archived | — | Deny | `org_archived` |
| Any user | Org suspended | — | Deny | `org_suspended` |

The platform role column is absent from this matrix because it is no longer consulted in the tenant-scoped authorization path. A platform admin's access to an organization is determined solely by their membership and org role in that organization, identical to a regular user.
