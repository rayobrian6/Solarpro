// lib/fieldMeasurement/capabilities.ts
// WS-5 — RBAC FOR FIELD ROUTE MEASUREMENTS.
//
// FIVE CAPABILITIES, NOT ONE ROLE. "Can this person verify a field measurement?"
// is a different question from "can they record one", and both are different
// from "may they see the history". Collapsing them into a job title — installer,
// manager, engineer — is what produces the failure this workstream exists to
// prevent: a privileged recorder whose own entry is treated as authority.
// Nothing here reads a job title. The inputs are the platform's OWN
// authorization facts: organization membership role (migration 105's
// owner/admin/member/viewer vocabulary) and project access.
//
// TWO INDEPENDENT GATES, BOTH REQUIRED. A capability without project access is
// refused, and project access without the capability is refused. They are
// separate fields on the actor and separate assertions in `requireCapability`,
// because a single boolean would let one be silently satisfied by the other.
//
// FAIL-CLOSED THROUGHOUT: an actor that cannot be resolved holds NO capabilities
// and NO project access. There is no "unknown ⇒ allow" branch in this file.

import { getDbReady } from '@/lib/db/core';
import {
  organizationTenant, soloTenant, sameTenant,
  MeasurementError, type TenantKey,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE CAPABILITIES
// ═══════════════════════════════════════════════════════════════════════════

export const ROUTE_MEASUREMENT_CAPABILITIES = [
  'route.measurement.read',
  'route.measurement.record',
  'route.measurement.verify',
  'route.measurement.reject',
  'route.measurement.supersede',
] as const;
export type RouteMeasurementCapability = (typeof ROUTE_MEASUREMENT_CAPABILITIES)[number];

/**
 * The capability grant per ORGANIZATION ROLE — the platform's existing tenant
 * authorization vocabulary (migration 105: owner | admin | member | viewer).
 *
 * WHY VERIFY SITS ABOVE MEMBER: verification is the act that converts an
 * operator's claim into permit-grade authority. A `member` records and may
 * supersede their own work; promoting a record to authority requires
 * `admin`-or-above, which is the same bar the platform already uses for actions
 * that bind the organization. `viewer` reads and nothing else.
 *
 * This map is the ONE place the grant lives. A route handler that wants to know
 * whether someone may verify asks the actor, never the role.
 */
export const CAPABILITIES_BY_ORG_ROLE: Record<string, readonly RouteMeasurementCapability[]> = {
  owner: [
    'route.measurement.read', 'route.measurement.record', 'route.measurement.verify',
    'route.measurement.reject', 'route.measurement.supersede',
  ],
  admin: [
    'route.measurement.read', 'route.measurement.record', 'route.measurement.verify',
    'route.measurement.reject', 'route.measurement.supersede',
  ],
  member: [
    'route.measurement.read', 'route.measurement.record', 'route.measurement.supersede',
  ],
  viewer: [
    'route.measurement.read',
  ],
};

/**
 * The grant for a SOLO project owner — a user with no organization, who owns the
 * project outright. They hold every capability because there is no one else in
 * their tenant to hold any; the separation that matters for them is not WHO may
 * verify but THAT verification is a distinct, evidenced, audited act, which the
 * verification policy still enforces (and which, without an explicit
 * self-verification policy, they cannot satisfy on their own report — see
 * verificationPolicy.ts).
 */
export const SOLO_OWNER_CAPABILITIES: readonly RouteMeasurementCapability[] = ROUTE_MEASUREMENT_CAPABILITIES;

// ═══════════════════════════════════════════════════════════════════════════
// §2 — THE ACTOR
// ═══════════════════════════════════════════════════════════════════════════

export interface MeasurementActor {
  userId: string;
  /** the tenant this actor is acting WITHIN (the project's tenant). */
  tenant: TenantKey;
  /** GATE 1 — the capabilities held in this tenant. */
  capabilities: ReadonlySet<RouteMeasurementCapability>;
  /** GATE 2 — access to THIS project. Independent of §1 by design. */
  projectAccess: boolean;
  /** why access was (or was not) granted — surfaced in audit + errors. */
  accessBasis: string;
  /** the org role that produced the grant, when there was one. */
  orgRole: string | null;
  /** the tenant's explicit self-verification policy (fail-closed false). */
  allowAuthorizedSelfVerification: boolean;
}

export function hasCapability(actor: MeasurementActor | null, cap: RouteMeasurementCapability): boolean {
  return !!actor && actor.projectAccess && actor.capabilities.has(cap);
}

/**
 * Assert BOTH gates and the tenant boundary. Throws a structured
 * MeasurementError so the HTTP layer maps a status rather than re-deciding one.
 *
 * The three refusals are DISTINCT on purpose — "wrong tenant", "no project
 * access" and "capability not held" are different security findings and an
 * operator (and an auditor) needs to be able to tell them apart.
 */
export function requireCapability(
  actor: MeasurementActor | null,
  cap: RouteMeasurementCapability,
  scope: { tenantId: string; projectId: string },
): asserts actor is MeasurementActor {
  if (!actor) {
    throw new MeasurementError('FORBIDDEN', 'NO_ACTOR', 'No authenticated actor for this operation.');
  }
  if (!sameTenant(actor.tenant.tenantId, scope.tenantId)) {
    // Deliberately NOT_FOUND-shaped in the API layer: a cross-tenant probe must
    // not learn that the resource exists. The service still records the exact
    // finding for the audit trail.
    throw new MeasurementError('FORBIDDEN', 'CROSS_TENANT',
      'This record belongs to a different tenant.',
      { actorTenant: actor.tenant.tenantId, resourceTenant: scope.tenantId });
  }
  if (!actor.projectAccess) {
    throw new MeasurementError('FORBIDDEN', 'NO_PROJECT_ACCESS',
      `No access to project ${scope.projectId}.`, { basis: actor.accessBasis });
  }
  if (!actor.capabilities.has(cap)) {
    throw new MeasurementError('FORBIDDEN', 'CAPABILITY_NOT_HELD',
      `Capability '${cap}' is required and is not held.`,
      { capability: cap, held: [...actor.capabilities], orgRole: actor.orgRole });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — RESOLUTION FROM THE PLATFORM'S OWN AUTHORIZATION FACTS
// ═══════════════════════════════════════════════════════════════════════════

/** The facts the resolver needs. Injectable so the service and its tests share
 *  ONE resolution path rather than the tests reimplementing the rules. */
export interface AuthorizationSource {
  /** the project's owner + existence. null ⇒ no such project. */
  getProjectOwner(projectId: string): Promise<{ ownerUserId: string } | null>;
  /** the ACTIVE org membership for a user, or null when they belong to none. */
  getOrgMembership(userId: string): Promise<{ organizationId: string; role: string } | null>;
  /** the tenant's explicit self-verification policy. Fail-closed false. */
  getSelfVerificationPolicy(organizationId: string | null): Promise<boolean>;
}

/**
 * Resolve the tenant of a project from its OWNER. This is the derivation
 * migration 118's header documents: projects carry no org column, so the tenant
 * is the owner's organization when they have one and the owner themself when
 * they do not.
 */
export async function resolveProjectTenant(
  projectId: string,
  src: AuthorizationSource,
): Promise<TenantKey> {
  const proj = await src.getProjectOwner(projectId);
  if (!proj) {
    throw new MeasurementError('NOT_FOUND', 'PROJECT_NOT_FOUND', `Project ${projectId} was not found.`);
  }
  const membership = await src.getOrgMembership(proj.ownerUserId);
  return membership
    ? organizationTenant(membership.organizationId, proj.ownerUserId)
    : soloTenant(proj.ownerUserId);
}

/**
 * Resolve the acting user's capabilities WITHIN a project's tenant.
 *
 * FAIL-CLOSED CASES, each returning an actor with no capabilities and no project
 * access rather than throwing, so the caller's `requireCapability` produces one
 * consistent refusal shape:
 *   • the acting user belongs to a DIFFERENT organization than the project's
 *     tenant — a cross-tenant actor holds nothing here, whatever they hold there;
 *   • the acting user has no org and does not own the project — a solo user's
 *     capabilities are over their OWN projects only;
 *   • the org role is unrecognised — an unknown role grants nothing.
 */
export async function resolveMeasurementActor(
  userId: string,
  projectId: string,
  src: AuthorizationSource,
): Promise<MeasurementActor> {
  const tenant = await resolveProjectTenant(projectId, src);
  const membership = await src.getOrgMembership(userId);
  const allowSelf = await src.getSelfVerificationPolicy(tenant.organizationId);

  const deny = (basis: string, orgRole: string | null): MeasurementActor => ({
    userId, tenant, capabilities: new Set<RouteMeasurementCapability>(), projectAccess: false,
    accessBasis: basis, orgRole, allowAuthorizedSelfVerification: allowSelf,
  });

  // ── ORG-SCOPED TENANT ────────────────────────────────────────────────────
  if (tenant.organizationId) {
    if (!membership || membership.organizationId !== tenant.organizationId) {
      return deny(
        `actor is not an active member of organization ${tenant.organizationId} (the project's tenant)`,
        membership?.role ?? null,
      );
    }
    const granted = CAPABILITIES_BY_ORG_ROLE[membership.role];
    if (!granted) {
      return deny(`organization role '${membership.role}' is not a recognised role — no capability is granted`, membership.role);
    }
    return {
      userId, tenant,
      capabilities: new Set(granted),
      projectAccess: true,
      accessBasis: `active '${membership.role}' membership of organization ${tenant.organizationId}`,
      orgRole: membership.role,
      allowAuthorizedSelfVerification: allowSelf,
    };
  }

  // ── SOLO-OWNER TENANT ────────────────────────────────────────────────────
  if (userId !== tenant.ownerUserId) {
    return deny('the project belongs to a solo owner and the actor is not that owner', membership?.role ?? null);
  }
  return {
    userId, tenant,
    capabilities: new Set(SOLO_OWNER_CAPABILITIES),
    projectAccess: true,
    accessBasis: 'solo project owner',
    orgRole: null,
    allowAuthorizedSelfVerification: allowSelf,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — THE PRODUCTION AUTHORIZATION SOURCE (Neon)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reads the platform's real tables. Membership resolution mirrors
 * lib/organizations/memberships.getOrgRole (organization_members, status
 * 'active') with the legacy users.org_id pointer as the fallback, so a tenant
 * resolved here matches the one every other org-aware surface resolves.
 *
 * Throws on DB failure — the caller decides whether that is a 503 (the API) or a
 * fail-closed "no authority" (the permit resolver). Swallowing it here would let
 * an unreadable membership table read as "no organization", which silently
 * reclassifies an org project as a solo one.
 */
export const productionAuthorizationSource: AuthorizationSource = {
  async getProjectOwner(projectId: string) {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT user_id FROM projects WHERE id = ${projectId} AND deleted_at IS NULL LIMIT 1
    `;
    const r = (rows as Array<{ user_id: string }>)[0];
    return r ? { ownerUserId: String(r.user_id) } : null;
  },

  async getOrgMembership(userId: string) {
    const sql = await getDbReady();
    // LA §5 — same preemption as the permit read: `organization_members`
    // (migration 105) is absent on production, so this threw 42P01 and the
    // legacy pointer below — which only ran on an EMPTY result — was
    // unreachable. Every WS-5 write endpoint resolves the actor through here,
    // so the whole record/verify workflow 503'd before touching its own table.
    let r: { organization_id: string; role: string } | undefined;
    try {
      const rows = await sql`
        SELECT organization_id, role
        FROM organization_members
        WHERE user_id = ${userId} AND status = 'active'
        ORDER BY
          CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
          created_at ASC
        LIMIT 1
      `;
      r = (rows as Array<{ organization_id: string; role: string }>)[0];
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== '42P01') throw e;
    }
    if (r) return { organizationId: String(r.organization_id), role: String(r.role) };

    // Legacy pointer (migration 016) — still authoritative for users who were
    // never mirrored into organization_members.
    const legacy = await sql`
      SELECT org_id, org_role FROM users WHERE id = ${userId} AND org_id IS NOT NULL LIMIT 1
    `;
    const l = (legacy as Array<{ org_id: string; org_role: string | null }>)[0];
    return l ? { organizationId: String(l.org_id), role: String(l.org_role ?? 'member') } : null;
  },

  async getSelfVerificationPolicy(organizationId: string | null) {
    // FAIL-CLOSED. Absent org, absent settings, absent key, or anything other
    // than a literal `true` ⇒ self-verification is NOT permitted. A tenant that
    // wants it must say so explicitly.
    if (!organizationId) return false;
    const sql = await getDbReady();
    // LA §5 — `organizations.settings` is added by the same unapplied migration
    // 105, so this raised 42703 and took the whole workflow down with it. Absent
    // settings is exactly the fail-closed case this function already documents:
    // no explicit opt-in ⇒ self-verification NOT permitted. Degrade, do not throw.
    let rows: unknown;
    try {
      rows = await sql`SELECT settings FROM organizations WHERE id = ${organizationId} LIMIT 1`;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== '42703' && code !== '42P01') throw e;
      return false;
    }
    const raw = (rows as Array<{ settings: unknown }>)[0]?.settings;
    const settings = (typeof raw === 'string' ? safeJson(raw) : raw) as Record<string, unknown> | null;
    const section = settings?.routeMeasurement as Record<string, unknown> | undefined;
    return section?.allowAuthorizedSelfVerification === true;
  },
};

function safeJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}
