// tests/fieldMeasurement/fixtures.ts
// WS-5 — THE CONTROLLED FIXTURE.
//
// Braidon is a REAL project with REAL unmeasured routes, and inserting an
// invented measurement into it would make the live truth-state a lie. So the
// reachability proof runs on a controlled tenant/project/route fixture built
// here, and Braidon is asserted separately to remain honestly pending.
//
// WHAT IS SUBSTITUTED, AND WHAT IS NOT. Only the STORAGE DRIVER and the three
// external reads (project ownership, org membership, attachment lookup, route
// facts) are fixtures. The service, the capability model, the verification
// policy, the evidence resolver, the repository CONTRACT, the API route
// handlers, the canonical selection rule and the snapshot build all run exactly
// as they do in production. There is no path in these fixtures that writes a
// resolved snapshot field or mutates a state directly.

import type { AuthorizationSource } from '@/lib/fieldMeasurement/capabilities';
import type { EvidenceAttachmentFact, EvidenceSource } from '@/lib/fieldMeasurement/evidence';
import type { InvalidationSink, ComplianceAuditSink, RouteFactSource } from '@/lib/fieldMeasurement/service';
import type { RouteApplicabilityFact } from '@/lib/fieldMeasurement/types';

// ── IDENTITIES ──────────────────────────────────────────────────────────────
// Two tenants, so cross-tenant isolation is testable rather than asserted.

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';

export const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** a project owned by a solo user with no organization. */
export const PROJECT_SOLO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export const USER_A_OWNER = 'a0000000-0000-4000-8000-000000000001';   // org A owner
export const USER_A_ADMIN = 'a0000000-0000-4000-8000-000000000002';   // org A admin — may verify
export const USER_A_MEMBER = 'a0000000-0000-4000-8000-000000000003';  // org A member — records, cannot verify
export const USER_A_VIEWER = 'a0000000-0000-4000-8000-000000000004';  // org A viewer — read only
export const USER_B_ADMIN = 'b0000000-0000-4000-8000-000000000001';   // org B admin — a different tenant
export const USER_SOLO = 'c0000000-0000-4000-8000-000000000001';      // solo owner

export const ATTACHMENT_A = 'aa000000-0000-4000-8000-00000000000a';
export const ATTACHMENT_B = 'bb000000-0000-4000-8000-00000000000b';   // belongs to project B

// ── ROUTES ──────────────────────────────────────────────────────────────────
// The same D1 shape the canonical snapshot produces: four project-owned runs
// that owe a measurement, one geometry-derived branch run, one utility-owned
// EXCLUDED run.

export const FIXTURE_ROUTES: RouteApplicabilityFact[] = [
  {
    segmentId: 'FEEDER_RUN', exists: true,
    routeOwnership: 'PROJECT_OWNED', routeAuthorityApplicability: 'REQUIRED',
    routeApplicabilityReason: null, electricalFunction: 'combiner/inverter feeder → disconnect',
    from: 'AC COMBINER', to: 'AC DISCONNECT',
    cadEstimatedLengthFt: 20, cadRoutedLengthFt: null,
    currentLengthSource: 'cad-derived-estimate', currentVerificationState: 'cad-derived-estimate',
  },
  {
    segmentId: 'DISCO_TO_TAP_RUN', exists: true,
    routeOwnership: 'PROJECT_OWNED', routeAuthorityApplicability: 'REQUIRED',
    routeApplicabilityReason: null, electricalFunction: 'disconnect → point of interconnection / tap',
    from: 'AC DISCONNECT', to: 'TAP', cadEstimatedLengthFt: 35, cadRoutedLengthFt: null,
    currentLengthSource: 'cad-derived-estimate', currentVerificationState: 'cad-derived-estimate',
  },
  {
    segmentId: 'BRANCH_RUN', exists: true,
    routeOwnership: 'PROJECT_OWNED', routeAuthorityApplicability: 'REQUIRED',
    routeApplicabilityReason: null, electricalFunction: 'micro AC branch (Q-Cable trunk, open air)',
    from: 'ARRAY', to: 'AC COMBINER', cadEstimatedLengthFt: null, cadRoutedLengthFt: 64,
    currentLengthSource: 'cad-route', currentVerificationState: 'geometry-derived',
  },
  {
    // D1 — the run the installer does not own. The ordinary project measurement
    // workflow must REFUSE this outright.
    segmentId: 'MSP_TO_UTILITY_RUN', exists: true,
    routeOwnership: 'UTILITY_OWNED', routeAuthorityApplicability: 'EXCLUDED',
    routeApplicabilityReason: 'Utility-owned service equipment — routed, owned and maintained by the serving utility.',
    electricalFunction: 'service equipment connection',
    from: 'MAIN PANEL', to: 'UTILITY METER', cadEstimatedLengthFt: 12, cadRoutedLengthFt: null,
    currentLengthSource: 'cad-derived-estimate', currentVerificationState: 'cad-derived-estimate',
  },
];

export function fixtureRouteFactSource(routes: RouteApplicabilityFact[] = FIXTURE_ROUTES): RouteFactSource {
  return { async listRouteFacts() { return routes.map(r => ({ ...r })); } };
}

// ── AUTHORIZATION ───────────────────────────────────────────────────────────

export interface FixtureAuthOptions {
  /** tenants that hold the explicit authorized-self-verification policy. */
  selfVerificationOrgs?: string[];
}

export function fixtureAuthorizationSource(opts: FixtureAuthOptions = {}): AuthorizationSource {
  const selfOrgs = new Set(opts.selfVerificationOrgs ?? []);
  const owners: Record<string, string> = {
    [PROJECT_A]: USER_A_OWNER,
    [PROJECT_B]: USER_B_ADMIN,
    [PROJECT_SOLO]: USER_SOLO,
  };
  const memberships: Record<string, { organizationId: string; role: string }> = {
    [USER_A_OWNER]: { organizationId: ORG_A, role: 'owner' },
    [USER_A_ADMIN]: { organizationId: ORG_A, role: 'admin' },
    [USER_A_MEMBER]: { organizationId: ORG_A, role: 'member' },
    [USER_A_VIEWER]: { organizationId: ORG_A, role: 'viewer' },
    [USER_B_ADMIN]: { organizationId: ORG_B, role: 'admin' },
    // USER_SOLO deliberately absent — a solo owner has no membership.
  };
  return {
    async getProjectOwner(projectId) {
      const o = owners[projectId];
      return o ? { ownerUserId: o } : null;
    },
    async getOrgMembership(userId) {
      return memberships[userId] ?? null;
    },
    async getSelfVerificationPolicy(organizationId) {
      return organizationId != null && selfOrgs.has(organizationId);
    },
  };
}

// ── EVIDENCE ────────────────────────────────────────────────────────────────

export function fixtureEvidenceSource(present: Record<string, string> = {
  [ATTACHMENT_A]: PROJECT_A,
  [ATTACHMENT_B]: PROJECT_B,
}): EvidenceSource {
  return {
    async lookup(projectId, ids): Promise<EvidenceAttachmentFact[]> {
      // Mirrors the production query's scoping EXACTLY: the join to the project
      // is the filter, so an attachment in another project simply does not come
      // back and lands in `invalid`.
      return ids
        .filter(id => present[id] === projectId)
        .map(id => ({ attachmentId: id, present: true, projectId, kind: 'photo', label: 'route photo' }));
    },
  };
}

// ── SINKS ───────────────────────────────────────────────────────────────────

export interface RecordingSinks {
  invalidation: InvalidationSink;
  compliance: ComplianceAuditSink;
  invalidations: Array<{ projectId: string; reason: string; scope: string; invalidatedBy: string }>;
  mirrored: Array<{ action: string; projectId: string; measurementId: string; organizationId: string | null }>;
}

export function recordingSinks(): RecordingSinks {
  const invalidations: RecordingSinks['invalidations'] = [];
  const mirrored: RecordingSinks['mirrored'] = [];
  return {
    invalidations, mirrored,
    invalidation: {
      async invalidate(rec) {
        invalidations.push({ projectId: rec.projectId, reason: rec.reason, scope: rec.scope, invalidatedBy: rec.invalidatedBy });
      },
    },
    compliance: {
      async mirror(rec) {
        mirrored.push({ action: rec.action, projectId: rec.projectId, measurementId: rec.measurementId, organizationId: rec.organizationId });
      },
    },
  };
}

/** A deterministic clock. Every fixture run produces the same timestamps, so a
 *  selection-order assertion is about the RULE and never about wall time. */
export function fixedClock(startIso = '2026-08-02T12:00:00.000Z'): () => string {
  let t = Date.parse(startIso);
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;                        // one second per call — strictly increasing
    return iso;
  };
}

export const MEASURED_AT = '2026-08-02T09:30:00.000Z';
