/** @vitest-environment jsdom */
/**
 * WS-5 §9 — THE OPERATOR SURFACE.
 *
 * The assertions that matter here are all about NOT OVERSTATING:
 *   • an unverified report never renders as verified;
 *   • measured-by and verified-by are shown separately;
 *   • a verify action does not appear for someone who cannot verify;
 *   • a utility-owned run is visibly excluded and offers no measurement form.
 *
 * The panel's opinion about permissions is a courtesy — every write is
 * re-authorised server-side — so these tests assert what the OPERATOR SEES, not
 * that the UI is the control.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import RouteMeasurementPanel from '@/components/project/RouteMeasurementPanel';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ROUTE = (over: Record<string, unknown> = {}) => ({
  segmentId: 'FEEDER_RUN', exists: true,
  routeOwnership: 'PROJECT_OWNED', routeAuthorityApplicability: 'REQUIRED',
  routeApplicabilityReason: null, electricalFunction: 'combiner feeder',
  from: 'AC COMBINER', to: 'AC DISCONNECT',
  cadEstimatedLengthFt: 20, cadRoutedLengthFt: null,
  currentLengthSource: 'cad-derived-estimate', currentVerificationState: 'cad-derived-estimate',
  ...over,
});

const MEASUREMENT = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  routeSegmentId: 'FEEDER_RUN', measuredLengthFt: 41, measurementMethod: 'LASER',
  measuredByUserId: 'a0000000-0000-4000-8000-000000000003',
  measuredAt: '2026-08-02T09:30:00.000Z', recordedAt: '2026-08-02T12:00:00.000Z',
  evidenceAttachmentIds: ['aa000000-0000-4000-8000-00000000000a'], notes: null,
  verificationState: 'REPORTED_UNVERIFIED', verificationMode: null,
  verifiedByUserId: null, verifiedAt: null, verificationNotes: null, evidenceExceptionReason: null,
  rejectedByUserId: null, rejectedAt: null, rejectionReason: null,
  supersedesMeasurementId: null, supersededByMeasurementId: null,
  ...over,
});

function mockRollUp(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, methods: ['TAPE', 'LASER', 'MEASURING_WHEEL', 'AS_BUILT_DRAWING', 'OTHER'], ...body }),
  })));
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('WS-5 §9 — operator UI', () => {
  it('24. the EMPTY state renders and explains where routes come from', async () => {
    mockRollUp({ routes: [], capabilities: ['route.measurement.read'], accessBasis: 'solo project owner', allowAuthorizedSelfVerification: false, currentUserId: 'u' });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('route-measurement-empty')).toBeTruthy());
    expect(screen.getByTestId('route-measurement-empty').textContent).toMatch(/routes come\s+from the canonical design/i);
  });

  it('25. a route with NO measurement shows NO FIELD MEASUREMENT and offers the report form', async () => {
    mockRollUp({
      routes: [{ route: ROUTE(), measurements: [], active: null, hasOnlyRetiredRecords: false }],
      capabilities: ['route.measurement.read', 'route.measurement.record'],
      accessBasis: 'active member', allowAuthorizedSelfVerification: false, currentUserId: 'u',
    });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('route-state-FEEDER_RUN')).toBeTruthy());
    expect(screen.getByTestId('route-state-FEEDER_RUN').textContent).toContain('NO FIELD MEASUREMENT');
    expect(screen.getByTestId('record-FEEDER_RUN')).toBeTruthy();
    expect(screen.getByTestId('route-impact-FEEDER_RUN').textContent).toMatch(/Holds ROUTE-LENGTH-ESTIMATE open/);
  });

  it('26. a FIELD REPORT is shown as AWAITING VERIFICATION — never as verified', async () => {
    mockRollUp({
      routes: [{ route: ROUTE(), measurements: [MEASUREMENT()], active: MEASUREMENT(), hasOnlyRetiredRecords: false }],
      capabilities: ['route.measurement.read'], accessBasis: 'viewer', allowAuthorizedSelfVerification: false, currentUserId: 'u',
    });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('route-state-FEEDER_RUN')).toBeTruthy());
    const badge = screen.getByTestId('route-state-FEEDER_RUN');
    expect(badge.textContent).toBe('FIELD REPORTED — AWAITING VERIFICATION');
    // The verified-only styling is absent…
    expect(badge.className).not.toMatch(/green/);
    expect(badge.className).toMatch(/amber/);
    // …and the impact line says what it does and does not support.
    expect(screen.getByTestId('route-impact-FEEDER_RUN').textContent).toMatch(/PROVISIONAL calculations only/);
    // …and the identities panel says NOT VERIFIED.
    expect(screen.getByTestId('route-identities-FEEDER_RUN').textContent).toMatch(/NOT VERIFIED/);
  });

  it('27+28. the VERIFY action appears only when the capability is held', async () => {
    const withVerify = {
      routes: [{ route: ROUTE(), measurements: [MEASUREMENT()], active: MEASUREMENT(), hasOnlyRetiredRecords: false }],
      accessBasis: 'admin', allowAuthorizedSelfVerification: false, currentUserId: 'u',
    };
    mockRollUp({ ...withVerify, capabilities: ['route.measurement.read', 'route.measurement.verify'] });
    const { unmount } = render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('verify-FEEDER_RUN')).toBeTruthy());
    unmount();
    cleanup();

    mockRollUp({ ...withVerify, capabilities: ['route.measurement.read'] });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('route-state-FEEDER_RUN')).toBeTruthy());
    expect(screen.queryByTestId('verify-FEEDER_RUN')).toBeNull();
  });

  it('29+30. HISTORY shows superseded and rejected records with their outcomes', async () => {
    const rejected = MEASUREMENT({
      id: 'r1', verificationState: 'REJECTED', rejectedByUserId: 'u2',
      rejectedAt: '2026-08-02T14:00:00.000Z', rejectionReason: 'the tape hooked the wrong stub-up',
    });
    const superseded = MEASUREMENT({
      id: 's1', verificationState: 'SUPERSEDED', supersededByMeasurementId: 'n1', measuredLengthFt: 39,
    });
    mockRollUp({
      routes: [{ route: ROUTE(), measurements: [rejected, superseded], active: null, hasOnlyRetiredRecords: true }],
      capabilities: ['route.measurement.read'], accessBasis: 'viewer', allowAuthorizedSelfVerification: false, currentUserId: 'u',
    });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('history-toggle-FEEDER_RUN')).toBeTruthy());
    // "only retired records" is a DIFFERENT state from "never measured".
    expect(screen.getByTestId('route-state-FEEDER_RUN').textContent).toBe('FIELD MEASUREMENT REJECTED');
    screen.getByTestId('history-toggle-FEEDER_RUN').click();
    await waitFor(() => expect(screen.getByTestId('history-FEEDER_RUN')).toBeTruthy());
    const table = screen.getByTestId('history-FEEDER_RUN').textContent ?? '';
    expect(table).toMatch(/REJECTED/);
    expect(table).toMatch(/wrong stub-up/);
    expect(table).toMatch(/SUPERSEDED/);
    expect(table).toMatch(/39 ft/);         // the superseded VALUE is retained on screen
  });

  it('31. a UTILITY-OWNED run is visibly excluded and offers no measurement action', async () => {
    mockRollUp({
      routes: [{
        route: ROUTE({
          segmentId: 'MSP_TO_UTILITY_RUN', routeOwnership: 'UTILITY_OWNED',
          routeAuthorityApplicability: 'EXCLUDED',
          routeApplicabilityReason: 'Utility-owned service equipment — routed, owned and maintained by the serving utility.',
        }),
        measurements: [], active: null, hasOnlyRetiredRecords: false,
      }],
      capabilities: ['route.measurement.read', 'route.measurement.record', 'route.measurement.verify'],
      accessBasis: 'owner', allowAuthorizedSelfVerification: false, currentUserId: 'u',
    });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('route-state-MSP_TO_UTILITY_RUN')).toBeTruthy());
    expect(screen.getByTestId('route-state-MSP_TO_UTILITY_RUN').textContent).toBe('UTILITY-OWNED — EXCLUDED');
    expect(screen.queryByTestId('record-MSP_TO_UTILITY_RUN')).toBeNull();
    expect(screen.getByTestId('route-impact-MSP_TO_UTILITY_RUN').textContent).toMatch(/no field measurement is owed/);
  });

  it('a VERIFIED route shows the verifier SEPARATELY from the measurer', async () => {
    const v = MEASUREMENT({
      verificationState: 'VERIFIED', verifiedByUserId: 'a0000000-0000-4000-8000-000000000002',
      verifiedAt: '2026-08-02T13:00:00.000Z', verificationMode: 'INDEPENDENT_REVIEW',
    });
    mockRollUp({
      routes: [{ route: ROUTE(), measurements: [v], active: v, hasOnlyRetiredRecords: false }],
      capabilities: ['route.measurement.read'], accessBasis: 'viewer', allowAuthorizedSelfVerification: false, currentUserId: 'u',
    });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('route-identities-FEEDER_RUN')).toBeTruthy());
    const text = screen.getByTestId('route-identities-FEEDER_RUN').textContent ?? '';
    expect(text).toMatch(/Measured by:.*a0000000/);
    expect(text).toMatch(/Verified by:.*a0000000/);
    // Two DIFFERENT people, shown as two separate facts.
    expect(text).toMatch(/INDEPENDENT_REVIEW/);
    expect(screen.getByTestId('route-state-FEEDER_RUN').textContent).toBe('FIELD VERIFIED');
  });

  it('the report form states, in the form itself, that submitting is not verifying', async () => {
    mockRollUp({
      routes: [{ route: ROUTE(), measurements: [], active: null, hasOnlyRetiredRecords: false }],
      capabilities: ['route.measurement.read', 'route.measurement.record'],
      accessBasis: 'member', allowAuthorizedSelfVerification: false, currentUserId: 'u',
    });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('record-FEEDER_RUN')).toBeTruthy());
    screen.getByTestId('record-FEEDER_RUN').click();
    await waitFor(() => expect(screen.getByTestId('measurement-form-FEEDER_RUN')).toBeTruthy());
    const form = screen.getByTestId('measurement-form-FEEDER_RUN').textContent ?? '';
    expect(form).toMatch(/FIELD REPORTED — UNVERIFIED/);
    expect(form).toMatch(/closes nothing until an authorised reviewer verifies it/);
  });

  it('the summary distinguishes verified routes from applicable routes', async () => {
    const v = MEASUREMENT({ verificationState: 'VERIFIED', verifiedByUserId: 'u2', verifiedAt: 'x', verificationMode: 'INDEPENDENT_REVIEW' });
    mockRollUp({
      routes: [
        { route: ROUTE(), measurements: [v], active: v, hasOnlyRetiredRecords: false },
        { route: ROUTE({ segmentId: 'DISCO_TO_TAP_RUN' }), measurements: [], active: null, hasOnlyRetiredRecords: false },
        { route: ROUTE({ segmentId: 'MSP_TO_UTILITY_RUN', routeAuthorityApplicability: 'EXCLUDED', routeOwnership: 'UTILITY_OWNED' }), measurements: [], active: null, hasOnlyRetiredRecords: false },
      ],
      capabilities: ['route.measurement.read'], accessBasis: 'viewer', allowAuthorizedSelfVerification: false, currentUserId: 'u',
    });
    render(<RouteMeasurementPanel projectId={PROJECT} />);
    await waitFor(() => expect(screen.getByTestId('route-measurement-summary')).toBeTruthy());
    // The excluded run is NOT counted in the denominator.
    expect(screen.getByTestId('route-measurement-summary').textContent)
      .toMatch(/1 of 2 applicable project-owned route\(s\) hold a FIELD-VERIFIED length/);
  });
});
