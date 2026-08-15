// ═══════════════════════════════════════════════════════════════════════════
// D12 — WHO MAY PIN A RAIL.
//
// This reuses the platform's existing tenant resolution (migration 105 org
// membership, or solo-owner) rather than inventing a second access model — the
// same source `resolveMeasurementActor` reads, so a project's tenant is decided
// in ONE place. What it does NOT do is borrow the route-measurement capability
// vocabulary: pinning a rail is not measuring a route, and a shared enum is how
// two unrelated acts come to share a grant nobody reviewed.
//
// THE BAR, and why. Pinning a rail CLOSES a release requirement — it is the act
// that turns "PENDING RACKING ASSEMBLY SELECTION" into a specified assembly that
// a permit set is printed from. That is the same kind of act as verifying a
// field measurement, so it takes the same `admin`-or-above bar. A `member`
// reads the shortlist; promoting one of its entries to the specified rail binds
// the organization.
// ═══════════════════════════════════════════════════════════════════════════

import { resolveProjectTenant, type AuthorizationSource } from '@/lib/fieldMeasurement/capabilities';
import type { TenantKey } from '@/lib/fieldMeasurement/types';

export const RAIL_SELECTION_CAPABILITIES = [
  'rail.selection.read',
  'rail.selection.pin',
  'rail.selection.unpin',
] as const;
export type RailSelectionCapability = (typeof RAIL_SELECTION_CAPABILITIES)[number];

/** THE grant, per organization role. One place, so a route handler never
 *  decides who may do what. */
export const RAIL_CAPABILITIES_BY_ORG_ROLE: Record<string, readonly RailSelectionCapability[]> = {
  owner: ['rail.selection.read', 'rail.selection.pin', 'rail.selection.unpin'],
  admin: ['rail.selection.read', 'rail.selection.pin', 'rail.selection.unpin'],
  member: ['rail.selection.read'],
  viewer: ['rail.selection.read'],
};

/** A solo owner holds every capability: there is no one else in their tenant to
 *  hold any. The constraint that still binds them is the SERVICE's — a pin must
 *  name a candidate the mount admits and state a reason, whoever makes it. */
export const RAIL_SOLO_OWNER_CAPABILITIES: readonly RailSelectionCapability[] = RAIL_SELECTION_CAPABILITIES;

export interface RailSelectionActor {
  userId: string;
  tenant: TenantKey;
  capabilities: ReadonlySet<RailSelectionCapability>;
  projectAccess: boolean;
  /** WHY this actor has (or does not have) access, in one sentence. */
  accessBasis: string;
  orgRole: string | null;
}

export function railActorCan(actor: RailSelectionActor | null, cap: RailSelectionCapability): boolean {
  return !!actor && actor.projectAccess && actor.capabilities.has(cap);
}

/** Resolve the actor for a project. Fail-closed at every branch: an unknown
 *  role, a non-member, or a non-owner of a solo project grants nothing. */
export async function resolveRailSelectionActor(
  userId: string,
  projectId: string,
  src: AuthorizationSource,
): Promise<RailSelectionActor> {
  const tenant = await resolveProjectTenant(projectId, src);
  const membership = await src.getOrgMembership(userId);

  const deny = (basis: string, orgRole: string | null): RailSelectionActor => ({
    userId, tenant, capabilities: new Set<RailSelectionCapability>(),
    projectAccess: false, accessBasis: basis, orgRole,
  });

  if (tenant.organizationId) {
    if (!membership || membership.organizationId !== tenant.organizationId) {
      return deny(
        `actor is not an active member of organization ${tenant.organizationId} (the project's tenant)`,
        membership?.role ?? null,
      );
    }
    const granted = RAIL_CAPABILITIES_BY_ORG_ROLE[membership.role];
    if (!granted) {
      return deny(`organization role '${membership.role}' is not a recognised role — no capability is granted`, membership.role);
    }
    return {
      userId, tenant, capabilities: new Set(granted), projectAccess: true,
      accessBasis: `active '${membership.role}' membership of organization ${tenant.organizationId}`,
      orgRole: membership.role,
    };
  }

  if (userId !== tenant.ownerUserId) {
    return deny('the project belongs to a solo owner and the actor is not that owner', membership?.role ?? null);
  }
  return {
    userId, tenant, capabilities: new Set(RAIL_SOLO_OWNER_CAPABILITIES), projectAccess: true,
    accessBasis: 'solo project owner', orgRole: null,
  };
}
