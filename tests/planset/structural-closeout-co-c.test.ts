// ═══════════════════════════════════════════════════════════════════════════
// Closeout pass — CO-C (structural) gates §11 / §12 / §13 / §14.
//   §11 (Gate 11) RT-MINI always projects rail_paired — no name-based inference;
//        PV-3 says RAIL-PAIRED ROOF ATTACHMENT BASE, never DIRECT-ATTACH MOUNT.
//   §12 (Gate 12) ONE canonical fastener assembly projected IDENTICALLY onto
//        APP-A / PE-1 / SCHED; PE-1 prints PENDING VERIFIED FASTENER ASSEMBLY
//        while unverified and carries no generic lag/5-16/stainless text.
//   §13 (Gate 13) unverified framing renders NO capacity/utilization/adequate.
//   §14 (Gate 14) screening-envelope statement is complete (corner-zone, ASD,
//        area ratio, never exact tributary geometry).
// (Gate 10 — DS-4 omission — lives in equipment-document-authority-w5.test.ts.)
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { classifyMountTopology, getMountingSystemById } from '@/lib/mounting-hardware-db';
import { projectFastenerAssembly, projectStructuralFromInput } from '@/lib/permit/snapshot/structuralProjection';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function genWith(mountId?: string): { html: string; input: any } {
  const input = clone(roofProject) as any;
  if (mountId) input.project.mountingSystemId = mountId;
  const html = generatePermitHTML(input);
  return { html, input };
}

const cellOf = (html: string, field: string): string | null => {
  const m = html.match(new RegExp(`data-${field}-field="fastener"[^>]*>([^<]*)<`, 'i'));
  return m ? m[1] : null;
};

// ── §11 ─────────────────────────────────────────────────────────────────────
describe('§11 (Gate 11) — RT-MINI projects rail_paired, no name-based inference', () => {
  it('classifyMountTopology(rooftech-mini) === rail_paired (canonical, not the name)', () => {
    const rt = getMountingSystemById('rooftech-mini')!;
    expect(classifyMountTopology(rt).topology).toBe('rail_paired');
  });

  it('PV-3 attachment callout is RAIL-PAIRED ROOF ATTACHMENT BASE, never DIRECT-ATTACH MOUNT', () => {
    const { html } = genWith('rooftech-mini');
    expect(html).toContain('RAIL-PAIRED ROOF ATTACHMENT BASE');
    expect(html).not.toContain('DIRECT-ATTACH MOUNT');
  });

  it('a conventional railed mount (XR100) also projects the rail-paired base label', () => {
    const { html } = genWith('ironridge-xr100');
    expect(html).toContain('RAIL-PAIRED ROOF ATTACHMENT BASE');
    expect(html).not.toContain('DIRECT-ATTACH MOUNT');
  });
});

// ── §12 ─────────────────────────────────────────────────────────────────────
describe('§12 (Gate 12) — one fastener assembly, identical projection across sheets', () => {
  const { html, input } = genWith('rooftech-mini');
  const fa = projectFastenerAssembly(input);

  it('the fastener projection is populated from canonical mount/racking data', () => {
    expect(fa.present).toBe(true);
    expect(fa.diameterLabel).toBe('5/16');
    expect(fa.fastenerType).toBe('structural wood screw');
    expect(fa.pilotHoleRequired).toBe(false);
    expect(fa.embedmentIn).toBe(2.5);
    // Post-AAC (WS-8 alignment): the fastener ELEMENT is verified (model + count
    // + embedment + ICC-ES source) INDEPENDENT of the rail-capacity document —
    // the `capacityGated` echo is dead on this surface exactly as WS-8 killed it
    // on the FASTENER-ASSEMBLY-UNVERIFIED blocker emission. The rail-capacity
    // question stays with the RACKING-CAPACITY-* codes.
    expect(fa.verification).toBe('verified');
    expect(fa.certLabel).toBe('VERIFIED FASTENER ASSEMBLY');
  });

  it('APP-A, PE-1 and SCHED render the SAME canonical fastener line', () => {
    const appA = cellOf(html, 'app-a');
    const pe1  = cellOf(html, 'pe');
    const sched = cellOf(html, 'sched');
    expect(appA).toBeTruthy();
    expect(pe1).toBeTruthy();
    expect(sched).toBeTruthy();
    expect(appA).toBe(pe1);
    expect(pe1).toBe(sched);
    // WS-8 alignment: the VERIFIED element renders the full descriptive line —
    // identically on every sheet (the §12 identity invariant is unchanged).
    expect(appA).toContain('5/16');
    expect(appA).toContain('structural wood screw');
  });

  it('BAR §6 — an UNVERIFIED element is NON-ORDERABLE and dimensionless (invariant intact)', () => {
    // the ONLY gate on the descriptive line is `verification === 'verified'`:
    // doctor the snapshot's fastener element to unverified and the same
    // projection withholds every dimension (nothing else changes).
    const unv: any = clone(input);
    unv._snapshot = clone((input as any)._snapshot);
    unv._snapshot.structural.rackingAssembly.assemblyVerification =
      { ...(unv._snapshot.structural.rackingAssembly.assemblyVerification ?? {}), fastener: 'unverified' };
    const faU = projectFastenerAssembly(unv);
    expect(faU.verification).toBe('unverified');
    expect(faU.nonOrderable).toBe(true);
    expect(faU.line).not.toContain('5/16');
    expect(faU.line).not.toContain('structural wood screw');
    expect(faU.certLabel).toBe('PENDING VERIFIED FASTENER ASSEMBLY');
    // the verified fixture regenerates the full line from the SAME retained fields.
    expect(fa.line).toContain('5/16');
    expect(fa.line).toContain('structural wood screw');
    expect(fa.line).toContain('2.5" min embedment');
  });

  it('PE-1 prints VERIFIED FASTENER ASSEMBLY and drops generic lag/stainless text', () => {
    expect(html).toContain('VERIFIED FASTENER ASSEMBLY');
    expect(html).not.toContain('PENDING VERIFIED FASTENER ASSEMBLY');
    // the specific generic triplet §12 named must be gone
    expect(html).not.toContain('Lag bolt w/ flashing');
    expect(html).not.toContain('>Stainless Steel<');
  });

  it('PV-3 cross-section carries the same fastener diameter + embedment tokens', () => {
    expect(html).toContain('5/16');
    expect(html).toContain('2.5');
  });
});

// ── §13 ─────────────────────────────────────────────────────────────────────
describe('§13 (Gate 13) — unverified framing renders no capacity/adequacy', () => {
  const { html, input } = genWith('rooftech-mini');
  const proj = projectStructuralFromInput(input);
  const reviewRequired = proj.engine?.engineeringReviewRequired === true;

  it('the fixture framing is unverified (engineering review required)', () => {
    expect(reviewRequired).toBe(true);
  });

  it('PV-4C DEAD LOAD INTERPRETATION states NOT VERIFIED and asserts no adequacy', () => {
    expect(html).toContain('EXISTING FRAMING CAPACITY NOT VERIFIED');
    // no path prints an adequacy/utilization verdict for the unverified framing
    expect(html).not.toContain('confirms the existing framing has adequate capacity');
  });

  it('the FRAMING-AUTHORITY-UNVERIFIED blocker covers the framing authority gap', () => {
    const snap: any = input._snapshot;
    const codes = (snap?.permitReadiness?.registry ?? snap?.permitReadiness?.blockers ?? [])
      .map((b: any) => b.code);
    expect(codes).toContain('FRAMING-AUTHORITY-UNVERIFIED');
  });
});

// ── §14 ─────────────────────────────────────────────────────────────────────
describe('§14 (Gate 14) — screening-envelope statement is complete + honest', () => {
  const { html } = genWith('rooftech-mini');

  it('states conservative corner-zone pressure, ASD basis and the area ratio', () => {
    expect(html).toContain('CONSERVATIVE SCREENING ENVELOPE');
    expect(html).toContain('GOVERNING corner');
    expect(html).toContain('ASD basis');
    // explicit area ratio (Σ tributary ÷ array area), printed as N.NNN×
    expect(html).toMatch(/\d\.\d{3}×/);
  });

  it('never claims an exact per-position tributary geometry', () => {
    expect(html).toContain('NOT an exact per-position zone or tributary geometry');
    expect(html).not.toContain('exact tributary geometry.');
  });
});
