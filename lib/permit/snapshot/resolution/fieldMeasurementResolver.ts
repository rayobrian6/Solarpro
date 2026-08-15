// lib/permit/snapshot/resolution/fieldMeasurementResolver.ts
// WS-5 — THE RESOLVER THAT MAKES ROUTE-LENGTH-ESTIMATE REACHABLE.
//
// ROUTE-LENGTH-ESTIMATE has always been AUTO_DERIVED with a FIELD_VERIFICATION
// residual: the geometry-derived runs resolve themselves, and the rest owe a
// real measurement. Until now the residual had no producer at all, so the
// requirement's residual mode named a workflow that did not exist. This resolver
// is the read half of that workflow.
//
// IT READS. IT NEVER WRITES. The measurement store is written only by the
// authenticated API, behind capabilities, a policy evaluation and an atomic
// audit. A resolver that could write would be an engine that manufactures its
// own field evidence.
//
// THREE DISTINCT OUTCOMES, reported as three distinct facts:
//   • store unreadable (migration 118 not run, DB down) ⇒ FAILED / RETRYABLE,
//     naming the exact console step. The CAD source stands.
//   • store readable, no rows ⇒ RESOLVED with an EMPTY authority. This is not a
//     failure: "there is no field evidence" is a true, complete answer, and the
//     requirement stays open on the strength of it.
//   • rows present ⇒ RESOLVED with the per-segment authority. Whether that
//     CLOSES anything is decided downstream by closesFieldVerification, not
//     here — a resolver that reports "resolved" is reporting that it got an
//     answer, not that the answer was yes.

import {
  FIELD_MEASUREMENT_MIGRATION_ACTION, FIELD_MEASUREMENT_STORE_SOURCE,
  resolveFieldMeasurementAuthority,
} from '@/lib/fieldMeasurement/permitAccess';
import { buildResolutionAuditRef } from './evidence';
import type { RequirementResolver, ResolverContext, ResolverOutcome } from './types';

export const fieldRouteMeasurementResolver: RequirementResolver = {
  id: 'field-route-measurement@v1',
  mode: 'AUTO_DERIVED',
  requirementCodes: ['ROUTE-LENGTH-ESTIMATE'],
  requiredInputs: [],
  produces: ['fieldRouteMeasurements'],
  description:
    'Reads the ACTIVE field route measurements (migration 118) for this project and reduces them to one authority '
    + 'per route segment. Read-only: recording and verification happen in the authenticated measurement API, never here.',

  async run(ctx: ResolverContext): Promise<ResolverOutcome> {
    const authority = await resolveFieldMeasurementAuthority(ctx.projectId, ctx.safeDbRead);

    const inputsRecorded: Record<string, string | number | boolean | null> = {
      projectId: ctx.projectId,
      storeReadable: !authority.storeUnavailable,
      verifiedSegments: authority.verifiedCount,
      reportedSegments: authority.reportedCount,
      segmentsWithOnlyRetiredRecords: authority.segmentsWithOnlyRetiredRecords.length,
      measuredSegmentIds: Object.keys(authority.bySegmentId).join(', ') || null,
    };

    // ── the store could not be read ─────────────────────────────────────────
    if (authority.storeUnavailable) {
      return {
        result: 'FAILED',
        clearance: {
          cleared: false,
          missing: [FIELD_MEASUREMENT_STORE_SOURCE],
          reasons: [
            'the field-measurement store could not be read, so no field length authority is asserted — '
            + 'every route keeps its CAD source and no field-verification requirement is closed',
          ],
        },
        patch: { fieldRouteMeasurements: authority },
        sourceQueried: FIELD_MEASUREMENT_STORE_SOURCE,
        retryability: 'RETRYABLE',
        failureReason: authority.storeError ?? 'field-measurement store unavailable',
        operatorAction: FIELD_MEASUREMENT_MIGRATION_ACTION,
        confidence: 0,
        auditRef: null,
        inputsRecorded,
      };
    }

    const measured = Object.keys(authority.bySegmentId);

    // ── readable, and genuinely empty ───────────────────────────────────────
    if (measured.length === 0) {
      return {
        // RESOLVED, not FAILED: the question was asked and completely answered.
        // The requirement stays open because the ANSWER is "no field evidence",
        // which is a different thing from "we could not find out".
        result: 'RESOLVED',
        clearance: {
          cleared: false,
          missing: ['a recorded and VERIFIED field route measurement for each applicable project-owned run'],
          reasons: [
            authority.segmentsWithOnlyRetiredRecords.length > 0
              ? `no ACTIVE field measurement stands on any route — ${authority.segmentsWithOnlyRetiredRecords.length} `
                + `segment(s) have only rejected or superseded history (${authority.segmentsWithOnlyRetiredRecords.join(', ')})`
              : 'the field-measurement store holds no measurement for this project',
          ],
        },
        patch: { fieldRouteMeasurements: authority },
        sourceQueried: FIELD_MEASUREMENT_STORE_SOURCE,
        // REQUIRES_INPUT, not RETRYABLE: retrying the read will not produce a
        // measurement. A person with a tape will.
        retryability: 'REQUIRES_INPUT',
        failureReason: null,
        operatorAction:
          'Record a field measurement for each applicable project-owned run in the project\'s Engineering tab, '
          + 'then have an authorised reviewer verify it. Recording alone supports provisional results only.',
        confidence: 0,
        auditRef: null,
        inputsRecorded,
      };
    }

    // ── rows present ────────────────────────────────────────────────────────
    const refs = measured.map(id => `authority:fieldRouteMeasurement#${authority.bySegmentId[id].measurementId}`);
    return {
      result: 'RESOLVED',
      clearance: {
        cleared: authority.reportedCount === 0 && authority.verifiedCount > 0,
        missing: authority.reportedCount > 0
          ? Object.values(authority.bySegmentId)
              .filter(a => !a.closesFieldVerification)
              .map(a => `verification of the field report on ${a.routeSegmentId} (${a.calculationLengthFt} ft, REPORTED_UNVERIFIED)`)
          : [],
        reasons: authority.reportedCount > 0
          ? [`${authority.reportedCount} route(s) carry an UNVERIFIED field report — a report supports provisional `
             + 'calculations and closes no field-verification requirement']
          : [],
      },
      patch: { fieldRouteMeasurements: authority },
      sourceQueried: FIELD_MEASUREMENT_STORE_SOURCE,
      sourceRefs: refs,
      retryability: authority.reportedCount > 0 ? 'REQUIRES_INPUT' : 'NON_RETRYABLE',
      failureReason: null,
      operatorAction: authority.reportedCount > 0
        ? 'Have an authorised reviewer verify the outstanding field report(s) — recording is not verification.'
        : null,
      confidence: 1,
      auditRef: buildResolutionAuditRef({ resolverId: 'field-route-measurement@v1', sourceRefs: refs, atIso: ctx.nowIso }),
      // A field-authority change invalidates every length-dependent conclusion.
      invalidations: [{
        scope: 'snapshot',
        target: 'electrical.routeSegments[].calculationLengthFt / voltage drop / procurement footage',
        reason: `${measured.length} route segment(s) carry field measurement authority `
          + `(${authority.verifiedCount} verified, ${authority.reportedCount} reported)`,
        invalidatedBy: 'field-route-measurement@v1',
        atIso: ctx.nowIso,
      }],
      inputsRecorded,
    };
  },
};
