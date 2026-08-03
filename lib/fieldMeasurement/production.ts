// lib/fieldMeasurement/production.ts
// WS-5 — THE PRODUCTION WIRING, plus the HTTP boundary.
//
// One place builds the real service, and one place turns a MeasurementError into
// a status code. Both exist so the four route handlers below them are thin: a
// handler that re-decides a status is a handler that can decide a different one
// from its neighbour, and a 403 that becomes a 500 in one endpoint is exactly
// the kind of drift a security review has to go looking for.

import { NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db/core';
import { randomUUID } from 'node:crypto';
import { writeAuditLog } from '@/lib/auditLog';
import { FieldMeasurementService, type ComplianceAuditSink, type InvalidationSink } from './service';
import { postgresFieldMeasurementRepository } from './postgresRepository';
import { productionAuthorizationSource } from './capabilities';
import { productionEvidenceSource } from './evidence';
import { productionRouteFactSource } from './permitAccess';
import { MEASUREMENT_ERROR_STATUS, MeasurementError } from './types';

/**
 * Write a snapshot_digest_invalidations row (migration 114) so the stored
 * planset stops being served as current after field authority changes.
 *
 * `digest: null` is the ledger's "all current, until rebuild" form — which is
 * the right claim here: the measurement does not know which digest is live, and
 * naming the wrong one would leave the live artifact uninvalidated.
 */
export const productionInvalidationSink: InvalidationSink = {
  async invalidate(rec) {
    const sql = await getDbReady();
    await sql`
      INSERT INTO snapshot_digest_invalidations (
        id, project_id, digest, snapshot_id, scope, engineering_approval_ref,
        reason, invalidated_by, invalidated_at
      ) VALUES (
        ${randomUUID()}, ${rec.projectId}, ${null}, ${null}, ${rec.scope}, ${null},
        ${rec.reason}, ${rec.invalidatedBy}, ${rec.atIso}::timestamptz
      )
    `;
  },
};

/**
 * Mirror into the tamper-evident compliance log (migration 100). BEST-EFFORT BY
 * DESIGN: `writeAuditLog` catches its own failure and falls back to a console
 * line, so this is a security-visibility mirror, not the durable domain record.
 * The durable record is the field_route_measurement_events row that committed
 * inside the transition's own transaction.
 */
export const productionComplianceSink: ComplianceAuditSink = {
  async mirror(rec) {
    await writeAuditLog({
      category: 'data',
      // The compliance vocabulary has no route-measurement verb; the closest
      // TRUE one is used and the domain action is carried in the metadata,
      // rather than inventing a value the audit-chain verifier does not know.
      action: 'data_update',
      description: rec.description,
      actor_id: rec.actorUserId,
      actor_email: null,
      actor_role: null,
      target_type: 'field_route_measurement',
      target_id: rec.measurementId,
      metadata: { domainAction: rec.action, ...rec.metadata },
      ip_address: null,
      user_agent: null,
      request_path: null,
      actor_organization_id: rec.organizationId,
      resource_owner_organization_id: rec.organizationId,
    });
  },
};

/** THE production service. Every API handler builds it through this function. */
export function productionMeasurementService(): FieldMeasurementService {
  return new FieldMeasurementService({
    repository: postgresFieldMeasurementRepository,
    authorization: productionAuthorizationSource,
    evidence: productionEvidenceSource,
    routes: productionRouteFactSource,
    invalidation: productionInvalidationSink,
    compliance: productionComplianceSink,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// THE HTTP BOUNDARY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map a thrown error to a stable response. Two rules worth stating:
 *
 *   1. CROSS_TENANT IS REPORTED AS 404, not 403. A 403 confirms the resource
 *      exists; a cross-tenant probe must not learn that. The service still
 *      records the exact CROSS_TENANT finding for the audit trail — the
 *      narrowing happens only on the way out.
 *
 *   2. An unrecognised error is a 503 naming the store, never a 200 with an
 *      empty result. A measurement surface that fails soft would show "no
 *      measurements" for a project that has them.
 */
export function measurementErrorResponse(routeLabel: string, err: unknown): NextResponse {
  if (err instanceof MeasurementError) {
    const status = err.code === 'CROSS_TENANT' ? 404 : MEASUREMENT_ERROR_STATUS[err.kind];
    // NO_PROJECT_ACCESS drops its details on the way out. `accessBasis` names
    // the project's OWNING ORGANISATION, which is exactly what a probe from
    // another tenant must not learn; it stays on the service's audit record.
    const body = err.code === 'CROSS_TENANT'
      ? { success: false, error: 'Not found.', code: 'NOT_FOUND' }
      : err.code === 'NO_PROJECT_ACCESS'
        ? { success: false, error: 'No access to this project.', code: err.code }
        : { success: false, error: err.message, code: err.code, details: err.details };
    if (err.kind === 'FORBIDDEN' || err.kind === 'NOT_FOUND') {
      console.warn(`${routeLabel} ${err.code}: ${err.message}`);
    }
    return NextResponse.json(body, { status });
  }
  const msg = err instanceof Error ? err.message : String(err);
  // 42P01 = undefined_table: migration 118 has not been run. Named explicitly so
  // an operator sees the exact step instead of a generic outage.
  const isTableAbsent = /relation .*field_route_measurement.* does not exist|42P01/i.test(msg);
  console.error(`${routeLabel} store error:`, msg);
  return NextResponse.json({
    success: false,
    error: isTableAbsent
      ? 'The field-measurement store is not deployed. Run migration 118 through the governed console (Admin → System Tools → Migrations).'
      : 'Service temporarily unavailable. Please try again in a moment.',
    code: isTableAbsent ? 'MEASUREMENT_STORE_NOT_DEPLOYED' : 'MEASUREMENT_STORE_UNAVAILABLE',
  }, { status: 503, headers: { 'Retry-After': '3' } });
}
