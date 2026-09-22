// ═══════════════════════════════════════════════════════════════════════════
// A 6C JOB MUST NOT SHIP A METERING CLAIM IT DID NOT BUY.
//
// The IQ Combiner 6C integrates production metering and ships NO consumption
// CTs. Permit sheet PV-4A printed, on every job whose device integrated a
// gateway:
//
//   "The integrated gateway provides production/consumption metering and
//    monitoring per NEC 690.4."
//
// and no code path anywhere emitted a CT line item. The crew arrived with a
// combiner that cannot measure consumption and nothing to make it work — the
// same shape as 22 of 48 string inverters shipping TS4-A-F modules with zero
// driver hardware.
//
// These are the two artefacts that reach the field: the permit sheet and the
// BOM. Both assertions below fail against the pre-change code.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import type { CADModel } from '@/lib/cad/types';
import { roofProject } from '../test-fixtures/roofProject';
import { generatePermitHTML } from '@/lib/permit';
import { generateBOMForPermit, procurementAuthorityOf } from '@/lib/permit/utils/bomForPermit';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
import { generateBOMV4 } from '@/lib/bom-engine-v4';
import { bomMicroInput } from './goldens/wave0-fixtures';

vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'test-user' }, response: null })),
}));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => { throw new Error('no db in tests'); }),
  handleRouteDbError: (_tag: string, err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  },
}));

const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;

/** The fixture with the installer's recorded selection — the 6C, the device
 *  whose consumption CTs are a separate purchase. Selected explicitly so the
 *  test cannot be satisfied by a pairing or a fallback changing underneath it. */
function sixCJob() {
  const p = JSON.parse(JSON.stringify(roofProject));
  p.project.selectedCombinerId = 'enphase-iq-combiner-6c';
  return p;
}

/** The 5C ships two consumption clamp CTs — the control. */
function fiveCJob() {
  const p = JSON.parse(JSON.stringify(roofProject));
  p.project.selectedCombinerId = 'enphase-iq-combiner-5c';
  return p;
}

describe('control — the probe devices resolve as selected', () => {
  it('the 6C job really resolves the 6C, and it really integrates the gateway', () => {
    const plan = buildIntegratedEquipment(sixCJob(), cad);
    expect(plan.brains?.model).toBe('IQ Combiner 6C');
    expect(plan.hasIntegratedGateway).toBe(true);   // the condition that made the claim
    expect(plan.brains?.metering?.consumption.ctsIncluded).toBe(0);
  });
});

describe('PV-4A stops asserting consumption metering the design did not buy', () => {
  it('🚨 the unconditional production/consumption sentence is gone', () => {
    const html = generatePermitHTML(sixCJob());
    expect(html).not.toContain('production/consumption metering and monitoring');
  });

  it('the sheet states what is measured and what must still be done', () => {
    const html = generatePermitHTML(sixCJob());
    expect(html).toContain('METERING (NEC 690.4)');
    // production metering IS integral to the 6C — that part was always true
    expect(html).toMatch(/production metering is integral to IQ Combiner 6C/);
    // and the consumption CTs the 6C does not contain are called out as an action
    expect(html).toContain('REQUIRED ACTION');
    expect(html).toMatch(/ships\s*NO consumption CTs/);
  });

  it('the monitoring claim survives — that one was about comms and was true', () => {
    const html = generatePermitHTML(sixCJob());
    expect(html).toContain('The integrated gateway provides system monitoring and communications');
  });
});

describe('the BOM carries what the crew needs', () => {
  it('🚨 a 6C job BOM contains a consumption CT line — it contained none', () => {
    const bom = generateBOMForPermit(sixCJob(), cad);
    const cts = bom.filter(i => i.category === 'metering_ct');
    expect(cts.length, 'the BOM must carry a consumption CT line').toBeGreaterThan(0);
    const ct = cts[0];
    expect(ct.manufacturer).toBe('Enphase');
    expect(ct.partNumber).toBe('CT-200-SPLIT');
    expect(ct.quantity).toBe(2);                     // one per ungrounded conductor
    expect(String(ct.description)).toMatch(/ships NO consumption CTs/);
  });

  it('the CT is NOT presented as a verified orderable product', () => {
    const bom = generateBOMForPermit(sixCJob(), cad);
    const ct = bom.filter(i => i.category === 'metering_ct')[0];
    // The part number is recorded in this repo's research notes, not in a CT
    // data sheet, so it is a candidate — visible, blocking, never ordered blind.
    expect(ct.authorityStateHint).toBe('CANDIDATE_NON_ORDERABLE');
    expect(String(ct.authorityStateHintReason)).toMatch(/Confirm against Enphase ordering documentation/);
    // …and the CLASSIFIED state is what excludes it from the authoritative
    // total and from every export — i.e. what actually blocks release. The one
    // classifier decides it and may lower a hint, never raise it.
    const rec = procurementAuthorityOf(ct);
    expect(rec.authorityState).not.toBe('VERIFIED_ORDERABLE');
    expect(rec.orderable).toBe(false);
    expect(rec.exportable).toBe(false);
  });

  it('a 5C job buys no CTs — they are in the box', () => {
    const bom = generateBOMForPermit(fiveCJob(), cad);
    expect(bom.filter(i => i.category === 'metering_ct')).toHaveLength(0);
  });

  it('🚨 a newly reachable gate must not ship a part number nobody can order', () => {
    // Connecting the Production Meter control made `requiresProductionMeter`
    // reachable for the first time. Its row carried 'ITRON-PROD-1', which
    // exists in no data sheet, research record or distributor listing in this
    // repo — so wiring the toggle would otherwise have shipped a fabricated SKU
    // as an orderable product on every design with the control on (the UI
    // default). The row is emitted; the SELECTION is not claimed.
    const bom = generateBOMV4({ ...bomMicroInput(), requiresProductionMeter: true });
    const meter = bom.items.filter(i => i.category === 'meter');
    expect(meter.length, 'the toggle must reach the BOM at all').toBeGreaterThan(0);
    expect(meter[0].partNumber).toBe('ITRON-PROD-1');
    expect(meter[0].authorityStateHint).toBe('CANDIDATE_NON_ORDERABLE');
    expect(String(meter[0].authorityStateHintReason)).toMatch(/not a verifiable Itron ordering SKU/);
    // control: with the gate off, the row does not appear at all
    const off = generateBOMV4({ ...bomMicroInput(), requiresProductionMeter: false });
    expect(off.items.filter(i => i.category === 'meter')).toHaveLength(0);
  });

  it('the BOM and the sheet agree, because they read one resolution', () => {
    // The sheet asserts consumption metering exactly when the BOM bought it.
    const html = generatePermitHTML(fiveCJob());
    const bom = generateBOMForPermit(fiveCJob(), cad);
    expect(bom.filter(i => i.category === 'metering_ct')).toHaveLength(0);
    expect(html).toMatch(/consumption CTs are specified/);   // the 5C HAS them
  });
});
