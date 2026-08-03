// lib/fieldMeasurement/permitAccess.ts
// WS-5 — THE PERMIT PATH'S READ-ONLY VIEW OF FIELD MEASUREMENTS.
//
// THE ENGINE NEVER WRITES HERE. This module exposes exactly one operation —
// "read every measurement row for a project" — and nothing else. `record`,
// `verify`, `reject` and `supersede` live on the service, reachable only from
// the authenticated API. A permit build that could write a measurement would be
// a permit build that could manufacture its own field evidence.
//
// FAIL-CLOSED, AND SPECIFIC ABOUT WHY. Three different failures must not be
// collapsed into one silent "no measurement":
//   • migration 118 not run  ⇒ 42P01, RETRYABLE, names the exact console step;
//   • store unreachable       ⇒ RETRYABLE, names the error;
//   • store readable, empty   ⇒ NOT retryable — there genuinely is no field
//                               evidence, and the CAD source correctly stands.
// Only the third is "no measurement". The first two are "we do not know", which
// also closes nothing, but for a reason an operator can act on.

import { getDbReady } from '@/lib/db/core';
import { postgresFieldMeasurementRepository } from './postgresRepository';
import {
  buildFieldMeasurementAuthority, emptyFieldMeasurementAuthority,
  unavailableFieldMeasurementAuthority, type FieldRouteMeasurementAuthority,
} from './resolver';
import type { FieldRouteMeasurement, RouteApplicabilityFact } from './types';
import { organizationTenant, soloTenant } from './types';
import type { RouteFactSource } from './service';

export const FIELD_MEASUREMENT_STORE_SOURCE =
  'field_route_measurements + field_route_measurement_events (migration 118)';

export const FIELD_MEASUREMENT_MIGRATION_ACTION =
  'Run migration 118 through the governed console (Admin → System Tools → Migrations → Field route measurements), '
  + 'then record and verify route measurements from the project\'s Engineering tab.';

/**
 * Read every measurement in a project, resolving the project's tenant the same
 * way the service does. Tenant-scoped even here: a permit build for project P
 * reads only P's tenant's rows.
 *
 * Throws on DB failure — the caller wraps it in the lifecycle's `safeDbRead`,
 * which turns the throw into evidence rather than a crash.
 */
export async function readProjectMeasurements(projectId: string): Promise<FieldRouteMeasurement[]> {
  const sql = await getDbReady();
  const projRows = await sql`
    SELECT user_id FROM projects WHERE id = ${projectId} AND deleted_at IS NULL LIMIT 1
  `;
  const ownerUserId = (projRows as Array<{ user_id: string }>)[0]?.user_id;
  if (!ownerUserId) return [];

  const memberRows = await sql`
    SELECT organization_id FROM organization_members
    WHERE user_id = ${ownerUserId} AND status = 'active'
    ORDER BY
      CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT 1
  `;
  let organizationId = (memberRows as Array<{ organization_id: string }>)[0]?.organization_id ?? null;
  if (!organizationId) {
    const legacy = await sql`SELECT org_id FROM users WHERE id = ${ownerUserId} AND org_id IS NOT NULL LIMIT 1`;
    organizationId = (legacy as Array<{ org_id: string }>)[0]?.org_id ?? null;
  }
  const tenant = organizationId
    ? organizationTenant(String(organizationId), String(ownerUserId))
    : soloTenant(String(ownerUserId));

  return postgresFieldMeasurementRepository.listByProject(tenant.tenantId, projectId);
}

/**
 * The whole permit-path read, reduced to the authority bundle the snapshot
 * build consumes. `safeRead` is the lifecycle's guarded reader; passing it in
 * keeps the fail-soft discipline identical to every other authority resolver.
 */
export async function resolveFieldMeasurementAuthority(
  projectId: string | null,
  safeRead: <T>(label: string, read: () => Promise<T>, failSoftTo: T) => Promise<{ value: T; ok: boolean; error: string | null }>,
): Promise<FieldRouteMeasurementAuthority> {
  if (!projectId) {
    return emptyFieldMeasurementAuthority(
      'no projectId on the permit input — the field-measurement store cannot be scoped, so no field authority is asserted',
    );
  }
  const read = await safeRead('readProjectMeasurements', () => readProjectMeasurements(projectId), null as FieldRouteMeasurement[] | null);
  if (!read.ok || read.value == null) {
    return unavailableFieldMeasurementAuthority(read.error ?? 'field-measurement store unavailable');
  }
  if (read.value.length === 0) {
    return emptyFieldMeasurementAuthority(
      'the field-measurement store is readable and holds NO measurement for this project — every route keeps its '
      + 'CAD length source and no field-verification requirement is closed',
    );
  }
  return buildFieldMeasurementAuthority(read.value);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE ROUTE-FACT SOURCE
// ───────────────────────────────────────────────────────────────────────────
// "Does this route exist, and is it the project's to measure?" has exactly ONE
// derivation in this codebase — buildPermitDesignSnapshot's D1 mapping of
// `run.isUtilityOwned` onto routeOwnership / routeAuthorityApplicability. This
// source PROJECTS that build rather than re-deriving it, because a second
// derivation is precisely how D1 came to be needed: the engine knew a run was
// utility-owned and a mapper dropped the fact.
//
// It reads the project's saved `permit_input.json` (the enriched input the
// permit POST stores) and runs the CAD + snapshot build over it. That is real
// work, and it is the correct work: the alternative is a hand-written second
// opinion about ownership, which is the bug.
// ═══════════════════════════════════════════════════════════════════════════

export const productionRouteFactSource: RouteFactSource = {
  async listRouteFacts(projectId: string): Promise<RouteApplicabilityFact[]> {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT file_data FROM project_files
      WHERE project_id = ${projectId} AND file_name = 'permit_input.json'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const raw = (rows as Array<{ file_data: unknown }>)[0]?.file_data;
    if (!raw) return [];
    const json = raw instanceof Buffer ? raw.toString('utf8') : String(raw);
    let input: unknown;
    try { input = JSON.parse(json); } catch { return []; }

    // Imported lazily: the permit engine is a large module graph and the API
    // routes that only READ measurements must not pay for it.
    const [{ generateCADLayout }, { buildPermitDesignSnapshot }] = await Promise.all([
      import('@/lib/cad/cadEngine'),
      import('@/lib/permit/snapshot/build'),
    ]);
    const typed = input as import('@/lib/permit').PermitInput;
    const cad = generateCADLayout(typed as never);
    const snapshot = buildPermitDesignSnapshot(typed, cad, { projectId });
    return routeFactsFromSnapshot(snapshot);
  },
};

/** Project a built snapshot's route segments onto the applicability facts the
 *  measurement service needs. Pure — exported so tests and the operator API
 *  share ONE projection. */
export function routeFactsFromSnapshot(
  snapshot: { electrical?: { routeSegments?: readonly unknown[] } } | null | undefined,
): RouteApplicabilityFact[] {
  const segs = (snapshot?.electrical?.routeSegments ?? []) as Array<Record<string, unknown>>;
  return segs.map(s => ({
    segmentId: String(s.segmentId ?? ''),
    exists: true,
    // FAIL-CLOSED exactly as every other D1 consumer: an unpopulated record is
    // the installer's responsibility, never silently excused.
    routeOwnership: (s.routeOwnership as 'PROJECT_OWNED' | 'UTILITY_OWNED') ?? 'PROJECT_OWNED',
    routeAuthorityApplicability: (s.routeAuthorityApplicability as 'REQUIRED' | 'EXCLUDED' | 'NOT_APPLICABLE') ?? 'REQUIRED',
    routeApplicabilityReason: (s.routeApplicabilityReason as string | null) ?? null,
    electricalFunction: (s.electricalFunction as string | null) ?? null,
    from: (s.from as string | null) ?? null,
    to: (s.to as string | null) ?? null,
    cadEstimatedLengthFt: (s.estimatedFieldLengthFt as number | null) ?? (s.oneWayFt as number | null) ?? null,
    cadRoutedLengthFt: (s.geometricDesignLengthFt as number | null) ?? null,
    currentLengthSource: (s.lengthSource as string | null) ?? null,
    currentVerificationState: (s.verificationState as string | null) ?? (s.verificationStatus as string | null) ?? null,
  }));
}
