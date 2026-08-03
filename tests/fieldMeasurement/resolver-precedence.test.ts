/**
 * WS-5 §10 — CANONICAL SELECTION AND PRECEDENCE.
 *
 * The two questions this file keeps apart:
 *   WHICH length does the calculation use?  → selection precedence
 *   WHICH length closes the requirement?    → release authority
 * A field REPORT wins the first and loses the second, and every case below is
 * about not letting those collapse into one.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFieldMeasurementAuthority, selectActiveMeasurement, toLengthAuthority,
  sourceClosesRouteLengthRequirement, ROUTE_LENGTH_CLOSURE_POLICY,
  unavailableFieldMeasurementAuthority, emptyFieldMeasurementAuthority,
} from '@/lib/fieldMeasurement/resolver';
import {
  measurementAuthorityPair, measurementAuthorityPairsAreLegal, newMeasurementState,
  type FieldRouteMeasurement, type MeasurementVerificationState,
} from '@/lib/fieldMeasurement/types';
import { isValidRouteLengthAuthority, closesFieldVerification } from '@/lib/permit/snapshot/types';

function m(over: Partial<FieldRouteMeasurement> & { id: string }): FieldRouteMeasurement {
  return {
    tenantId: 'org:t', tenantOrganizationId: 't', projectId: 'p', routeSegmentId: 'FEEDER_RUN',
    measuredLengthFt: 41, measurementMethod: 'LASER', measuredByUserId: 'u1',
    measuredAt: '2026-08-02T09:00:00.000Z', recordedAt: '2026-08-02T10:00:00.000Z',
    evidenceAttachmentIds: [], notes: null,
    verificationState: 'REPORTED_UNVERIFIED', verificationMode: null,
    verifiedByUserId: null, verifiedAt: null, verificationNotes: null, evidenceExceptionReason: null,
    rejectedByUserId: null, rejectedAt: null, rejectionReason: null,
    supersedesMeasurementId: null, supersededByMeasurementId: null,
    createdAt: '2026-08-02T10:00:00.000Z', updatedAt: '2026-08-02T10:00:00.000Z',
    ...over,
  };
}

const verified = (id: string, ft: number, at: string) =>
  m({ id, measuredLengthFt: ft, verificationState: 'VERIFIED', verifiedByUserId: 'u2', verifiedAt: at, verificationMode: 'INDEPENDENT_REVIEW' });

describe('WS-5 §10 — deterministic active selection', () => {
  it('a new record is REPORTED_UNVERIFIED and nothing else', () => {
    expect(newMeasurementState()).toBe('REPORTED_UNVERIFIED');
  });

  it('VERIFIED outranks REPORTED_UNVERIFIED regardless of recency', () => {
    const rows = [
      m({ id: 'b', recordedAt: '2026-08-03T10:00:00.000Z', measuredLengthFt: 50 }),   // newer REPORT
      verified('a', 41, '2026-08-02T11:00:00.000Z'),                                  // older VERIFIED
    ];
    expect(selectActiveMeasurement(rows)?.id).toBe('a');
  });

  it('among VERIFIED records the LATEST verifiedAt wins', () => {
    const rows = [
      verified('a', 41, '2026-08-02T11:00:00.000Z'),
      verified('b', 47, '2026-08-04T11:00:00.000Z'),
      verified('c', 44, '2026-08-03T11:00:00.000Z'),
    ];
    expect(selectActiveMeasurement(rows)?.id).toBe('b');
  });

  it('an exact tie breaks on the DESCENDING id — stable, never database row order', () => {
    const rows = [
      verified('aaa', 41, '2026-08-04T11:00:00.000Z'),
      verified('zzz', 47, '2026-08-04T11:00:00.000Z'),
    ];
    // The same rows in either input order select the same record.
    expect(selectActiveMeasurement(rows)?.id).toBe('zzz');
    expect(selectActiveMeasurement([...rows].reverse())?.id).toBe('zzz');
  });

  it('a REJECTED record is never selected', () => {
    const rows = [m({ id: 'r', verificationState: 'REJECTED', rejectionReason: 'wrong stub-up', rejectedAt: 'x', rejectedByUserId: 'u2' })];
    expect(selectActiveMeasurement(rows)).toBeNull();
  });

  it('a SUPERSEDED record is never selected, even when it was verified', () => {
    const rows = [
      { ...verified('old', 41, '2026-08-02T11:00:00.000Z'), verificationState: 'SUPERSEDED' as MeasurementVerificationState, supersededByMeasurementId: 'new' },
    ];
    expect(selectActiveMeasurement(rows)).toBeNull();
  });

  it('a record with a superseded-by pointer is excluded even if its state lags', () => {
    // Defence in depth: selection excludes on the POINTER as well as the state.
    const rows = [{ ...verified('old', 41, '2026-08-02T11:00:00.000Z'), supersededByMeasurementId: 'new' }];
    expect(selectActiveMeasurement(rows)).toBeNull();
  });
});

describe('WS-5 §10 — authority projection', () => {
  it('every projectable pair is LEGAL under the WS-5 part-1 pairing table', () => {
    expect(measurementAuthorityPairsAreLegal()).toBe(true);
    expect(isValidRouteLengthAuthority('field-verified', 'field-verified')).toBe(true);
    expect(isValidRouteLengthAuthority('field-reported', 'field-reported')).toBe(true);
    // …and the dangerous one is not expressible.
    expect(isValidRouteLengthAuthority('field-reported', 'field-verified')).toBe(false);
  });

  it('REJECTED and SUPERSEDED project NO authority at all', () => {
    expect(measurementAuthorityPair('REJECTED')).toBeNull();
    expect(measurementAuthorityPair('SUPERSEDED')).toBeNull();
  });

  it('a field REPORT is DESIGN_REVIEW_ONLY and closes nothing', () => {
    const a = toLengthAuthority(m({ id: 'x' }))!;
    expect(a.lengthSource).toBe('field-reported');
    expect(a.verificationState).toBe('field-reported');
    expect(a.releaseSufficiency).toBe('DESIGN_REVIEW_ONLY');
    expect(a.closesFieldVerification).toBe(false);
    expect(closesFieldVerification(a.verificationState)).toBe(false);
    expect(a.provenance).toMatch(/NOT VERIFIED/);
  });

  it('a VERIFIED measurement is FINAL_RELEASE_READY and carries its provenance', () => {
    const a = toLengthAuthority(verified('x', 41, '2026-08-02T11:00:00.000Z'))!;
    expect(a.lengthSource).toBe('field-verified');
    expect(a.releaseSufficiency).toBe('FINAL_RELEASE_READY');
    expect(a.closesFieldVerification).toBe(true);
    expect(a.provenance).toMatch(/FIELD-VERIFIED/);
    expect(a.measuredByUserId).toBe('u1');
    expect(a.verifiedByUserId).toBe('u2');
  });

  it('the bundle counts verified vs reported and names retired-only segments', () => {
    const bundle = buildFieldMeasurementAuthority([
      verified('v', 41, '2026-08-02T11:00:00.000Z'),
      m({ id: 'r', routeSegmentId: 'DISCO_TO_TAP_RUN' }),
      m({ id: 'x', routeSegmentId: 'ROOF_RUN', verificationState: 'REJECTED', rejectedAt: 'x', rejectedByUserId: 'u', rejectionReason: 'bad' }),
    ]);
    expect(bundle.verifiedCount).toBe(1);
    expect(bundle.reportedCount).toBe(1);
    expect(bundle.segmentsWithOnlyRetiredRecords).toEqual(['ROOF_RUN']);
    expect(Object.keys(bundle.bySegmentId).sort()).toEqual(['DISCO_TO_TAP_RUN', 'FEEDER_RUN']);
  });

  it('an UNAVAILABLE store is a different fact from an EMPTY one, and neither closes anything', () => {
    const un = unavailableFieldMeasurementAuthority('42P01 relation does not exist');
    expect(un.storeUnavailable).toBe(true);
    expect(un.verifiedCount).toBe(0);
    expect(un.basis).toMatch(/could not be read/);
    const empty = emptyFieldMeasurementAuthority('readable and empty');
    expect(empty.storeUnavailable).toBe(false);
    expect(empty.verifiedCount).toBe(0);
  });
});

describe('WS-5 §14 — the explicit closure policy', () => {
  it('CAD geometry closes ROUTE-LENGTH-ESTIMATE by an EXPLICIT, named policy', () => {
    expect(ROUTE_LENGTH_CLOSURE_POLICY.requirementCode).toBe('ROUTE-LENGTH-ESTIMATE');
    expect(sourceClosesRouteLengthRequirement('cad-route')).toBe(true);
    expect(ROUTE_LENGTH_CLOSURE_POLICY.basis).toMatch(/AAC §2.13 SPLIT/);
  });

  it('a bare estimate and an UNVERIFIED field report both fail to close it', () => {
    expect(sourceClosesRouteLengthRequirement('cad-derived-estimate')).toBe(false);
    // 'operator-entry' is the segment lengthSource an unverified report produces.
    expect(sourceClosesRouteLengthRequirement('operator-entry')).toBe(false);
    expect(sourceClosesRouteLengthRequirement('field-reported')).toBe(false);
  });

  it('a field-verified measurement closes it', () => {
    expect(sourceClosesRouteLengthRequirement('field-measurement')).toBe(true);
    expect(sourceClosesRouteLengthRequirement('field-verified')).toBe(true);
  });

  it('an unknown source is FAIL-CLOSED', () => {
    expect(sourceClosesRouteLengthRequirement(null)).toBe(false);
    expect(sourceClosesRouteLengthRequirement(undefined)).toBe(false);
    expect(sourceClosesRouteLengthRequirement('something-new')).toBe(false);
  });
});
