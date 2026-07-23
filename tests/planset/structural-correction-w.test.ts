// ═══════════════════════════════════════════════════════════════════════════
// Post-campaign structural correction (2026-07-22) — §8 / §9 / §10.
//   §8  attachment-reaction reconciliation + reaction schedule + blocking gate
//   §9  RT-MINI capacity gate (no PASS from the unverified 600 lb allowable)
//   §10 exact racking assembly (PENDING SELECTION rail, one fastener spec, no
//       'rail-less' for a rail-paired mount, no 'or equivalent'/'RAIL-COMPAT')
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { buildRackingAssembly } from '@/lib/permit/snapshot/rackingAssembly';
import { reconcileReactions } from '@/lib/permit/snapshot/structuralEngine';
import { projectStructuralFromInput } from '@/lib/permit/snapshot/structuralProjection';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import type { AttachmentObject, StructuralEnv, PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function genWith(mountId?: string): { html: string; input: any; snap: PermitDesignSnapshot } {
  const input = clone(roofProject) as any;
  if (mountId) input.project.mountingSystemId = mountId;
  const html = generatePermitHTML(input);
  return { html, input, snap: input._snapshot as PermitDesignSnapshot };
}

const att = (over: Partial<AttachmentObject>): AttachmentObject => ({
  attachmentId: 'att-1', railId: 'rail-1', roofPlaneId: 'plane-1', xy: { x: 0, y: 0 },
  roofZone: 'zone2', substrateMember: 'rafter', attachmentMethod: 'l_foot_lag',
  fastenerModel: null, fastenerCount: 2, embedmentIn: 2.5,
  // reactions physically consistent with env(): dead 0.9psf×10=9, snow 4psf×10=40,
  // uplift is a conservative envelope (>= applied ASD 0.6·20·10=120). The former
  // dead=20 was 2.2× the applied dead — an inconsistency the old loose 3.0 band
  // masked and the W7 duplicate-area guard now (correctly) flags.
  tributaryAreaFt2: 10, upliftReactionLbs: 200, downwardReactionLbs: 49,
  deadReactionLbs: 9, snowReactionLbs: 40, lateralReactionLbs: null,
  allowableCapacityLbs: 600, adjustmentFactors: {}, utilization: null, safetyFactor: 3,
  coord: {} as any, provenance: { source: 'test' }, ...over,
});
const env = (): StructuralEnv => ({
  ultimateWindSpeedMph: 110, windSpeedSource: 'test', exposureCategory: 'C', riskCategory: 'II',
  groundSnowPsf: 20, roofSnowPsf: 4, buildingHeightFt: 15, componentCladdingZones: [],
  upliftPressurePsf: 20, downforcePressurePsf: 10,
  codeAuthority: { asceEdition: 'ASCE 7-22', source: 'default' }, provenance: { source: 'test' },
});

// ── §8 reconcileReactions unit behaviour ──────────────────────────────────────
describe('§8 — reconcileReactions', () => {
  // 6 rail-based attachments, uniform 10 ft² tributary; array footprint 60 ft².
  const rail = Array.from({ length: 6 }, (_, i) => att({ attachmentId: `att-${i}`, railId: 'rail-1' }));

  it('reconciles a conservative envelope (Σ tributary ≥ array area within band)', () => {
    const r = reconcileReactions(rail, 60, env(), 6, 0.9, true);
    expect(r.present).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.attachmentCount).toBe(6);
    expect(r.tributarySumFt2).toBe(60);
    // count / tributary (split: lost-load floor + duplicate guard) / uplift / snow / dead
    expect(r.checks.map(c => c.name)).toContain('attachment-count-vs-reaction-model');
    expect(r.checks.map(c => c.name)).toContain('tributary-lost-load-floor');
    expect(r.checks.map(c => c.name)).toContain('tributary-duplicate-area-guard');
    expect(r.checks.map(c => c.name)).toContain('uplift-reactions-vs-applied');
  });

  it('BLOCKS an object-count mismatch (attachments ≠ engine reaction-model count)', () => {
    const r = reconcileReactions(rail, 60, env(), 30, 0.9, true); // model says 30, objects=6
    expect(r.ok).toBe(false);
    expect(r.checks.find(c => c.name === 'attachment-count-vs-reaction-model')!.ok).toBe(false);
  });

  it('BLOCKS lost load (Σ tributary below the array footprint)', () => {
    const r = reconcileReactions(rail, 200, env(), 6, 0.9, true); // 60 ft² tributary vs 200 ft² area
    expect(r.ok).toBe(false);
    expect(r.checks.find(c => c.name === 'tributary-lost-load-floor')!.ok).toBe(false);
  });

  it('scope mismatch (hybrid roof run) → area checks INFORMATIONAL, count stays hard', () => {
    const r = reconcileReactions(rail, 200, env(), 6, 0.9, false); // scopeMatched=false
    expect(r.ok).toBe(true); // area check does not block under a scope mismatch
    expect(r.checks.find(c => c.name === 'tributary-lost-load-floor')!.ok).toBe(true);
    // but a genuine count mismatch still blocks even under scope mismatch
    const r2 = reconcileReactions(rail, 200, env(), 30, 0.9, false);
    expect(r2.ok).toBe(false);
  });

  it('direct-mount count check is informational (geometry-derived, not rail-grid)', () => {
    // reactions consistent with env (uplift 0.6·20·5=60, snow 4·5=20, dead 0.9·5=4.5)
    const dm = Array.from({ length: 8 }, (_, i) =>
      att({ attachmentId: `att-dm-${i}`, railId: '', supportedModuleId: `mi-m${i % 2}`,
        tributaryAreaFt2: 5, upliftReactionLbs: 60, snowReactionLbs: 20, deadReactionLbs: 4.5 }));
    const r = reconcileReactions(dm, 40, env(), 4, 0.9, true); // engineMountCount 4 ≠ 8, but direct-mount
    expect(r.checks.find(c => c.name === 'attachment-count-vs-reaction-model')!.ok).toBe(true);
    expect(r.ok).toBe(true);
  });
});

// ── §8 on the real snapshot + rendered schedule ───────────────────────────────
describe('§8 — real snapshot reconciliation + reaction schedule', () => {
  const { html, snap } = genWith();

  it('the snapshot carries a present, reconciled reaction reconciliation', () => {
    const rr = snap.structural.reactionReconciliation;
    expect(rr.present).toBe(true);
    expect(rr.ok).toBe(true);
    expect(rr.arrayAreaFt2).toBeGreaterThan(0);
    expect(rr.tributarySumFt2).toBeGreaterThan(0);
    // no reaction-reconciliation blocker when it reconciles
    expect(snap.permitReadiness.blockers.map(b => b.code)).not.toContain('STRUCTURAL-REACTION-RECONCILIATION-FAILED');
  });

  it('PV-4C renders the attachment-ID reaction schedule + reconciliation footer', () => {
    expect(html).toContain('Attachment Reaction Schedule');
    expect(html).toContain('Reaction Reconciliation');
    expect(html).toContain('Uplift 0.6W');
  });

  it('a fabricated tributary FAILS reconciliation (would block)', () => {
    const atts = snap.structural.attachments.map((a, i) =>
      i === 0 ? { ...a, tributaryAreaFt2: (a.tributaryAreaFt2 ?? 0) * 0.01 } : a);
    const area = snap.structural.reactionReconciliation.arrayAreaFt2 ?? 100;
    const r = reconcileReactions(atts as any, area, snap.structural.env,
      snap.structural.reactionReconciliation.reactionModelCount, 1, true);
    // shrinking one tributary drops Σ below the footprint → lost load → blocks
    expect(r.ok).toBe(false);
  });
});

// ── §9 capacity gate ──────────────────────────────────────────────────────────
describe('§9 — RT-MINI capacity gate', () => {
  it('RT-MINI is capacity-gated; a same-manufacturer railed mount is not', () => {
    const rt = clone(roofProject) as any; rt.project.mountingSystemId = 'rooftech-mini';
    generatePermitHTML(rt);
    expect(projectStructuralFromInput(rt).capacityGated).toBe(true);

    const xr = clone(roofProject) as any; // default ironridge-xr100
    generatePermitHTML(xr);
    expect(projectStructuralFromInput(xr).capacityGated).toBe(false);
  });

  it('no capacity PASS is rendered from the unverified 600 lb allowable', () => {
    const { html, snap } = genWith('rooftech-mini');
    expect(snap.permitReadiness.blockers.map(b => b.code)).toContain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
    expect(html).toContain('UNVERIFIED / PENDING STRUCTURAL SOURCE');
    expect(html).toContain('PENDING — CAPACITY SOURCE UNVERIFIED');
    // demand-side numbers stay printed (canonical)
    expect(html).toMatch(/Uplift per Attachment/);
    // no affirmative attachment-capacity PASS phrasing while gated
    expect(html).not.toMatch(/safety factor of [\d.]+ meets the required minimum/i);
  });
});

// ── §10 exact racking assembly ────────────────────────────────────────────────
describe('§10 — RT-MINI exact racking assembly', () => {
  it('pins PENDING SELECTION for the unpinned rail + one verified fastener spec', () => {
    const a = buildRackingAssembly(getMountingSystemById('rooftech-mini'))!;
    expect(a.railModel).toMatch(/PENDING RACKING ASSEMBLY SELECTION/);
    expect(a.railSku).toBeNull();
    expect(a.splice).toMatch(/PENDING RACKING ASSEMBLY SELECTION/);
    // one verified fastener product spec (2× 5/16" wood screw), its source recorded
    expect(a.screwLagModel).toMatch(/5\/16.*wood screw/i);
    expect(a.screwLagModel).not.toMatch(/3\/8/);
    // no 'or equivalent' / 'RAIL-COMPAT' anywhere on the assembly record
    const json = JSON.stringify(a);
    expect(json).not.toMatch(/or equivalent/i);
    expect(json).not.toContain('RAIL-COMPAT');
  });

  it('same-manufacturer railed mount still pins its exact rail SKU', () => {
    const a = buildRackingAssembly(getMountingSystemById('ironridge-xr100'))!;
    expect(a.railModel).toBeTruthy();
    expect(a.railModel).not.toMatch(/PENDING RACKING ASSEMBLY SELECTION/);
  });

  it('rendered RT-MINI package: no rail-less description, no RAIL-COMPAT, one fastener spec', () => {
    const { html } = genWith('rooftech-mini');
    // RT-MINI (rail_paired) is never described as rail-less anywhere
    expect(/rail-?less/i.test(html)).toBe(false);
    expect(html).not.toContain('RAIL-COMPAT');
    expect(html).not.toContain('Rail-less / direct-attach');
    // the ONE fastener spec (5/16" wood screw) — not a 3/8" lag, not a 4" SS lag
    expect(html).toMatch(/STRUCTURAL WOOD SCREW/);
    expect(html).not.toMatch(/3\/8&quot; diameter/);
    expect(html).not.toMatch(/4&quot; SS LAG/);
  });

  it('W6 — package-wide: ZERO "compatible rail" / "or equivalent" / "or compatible" on any sheet', () => {
    const { html } = genWith('rooftech-mini');
    const low = html.toLowerCase();
    const count = (t: string) => low.split(t).length - 1;
    // banned marketing / substitute rail phrasing must not render anywhere in the
    // package — the unpinned rail reads as the explicit PENDING RACKING ASSEMBLY
    // SELECTION state (mounting-hardware-db + equipment-db DATA strings sanitized).
    expect(count('compatible rail')).toBe(0);
    expect(count('or equivalent')).toBe(0);
    expect(count('or compatible')).toBe(0);
    expect(count('rail-pending-selection')).toBe(0);
    // the explicit pending state IS present
    expect(html).toContain('PENDING RACKING ASSEMBLY SELECTION');
  });

  it('W6 — an unpinned/unverified racking assembly emits PENDING-RACKING-ASSEMBLY-SELECTION + no "compatible rail" token', () => {
    const { snap } = genWith('rooftech-mini');
    const codes = snap.permitReadiness.blockers.map(b => b.code);
    expect(codes).toContain('PENDING-RACKING-ASSEMBLY-SELECTION');
    const a = buildRackingAssembly(getMountingSystemById('rooftech-mini'))! as any;
    // no "compatible rail" prose survives on the rendered-facing record fields
    expect(a.railModel).not.toMatch(/compatible rail/i);
    expect(a.splice).not.toMatch(/compatible rail/i);
    // completeness fields present with honest verification states
    expect(a.assemblyVerification.overall).toBe('pending');
    expect(a.assemblyVerification.railSku).toBe('pending');
  });
});

// ── W6/W7/W8 gate tests (this pass) ───────────────────────────────────────────
/** Slice the PE-1 "Letter of Structural Compliance" body (results table + cert
 *  statement), stopping before the sig block, so we scan only the pending page. */
function pe1Slice(html: string): string {
  const start = html.indexOf('LETTER OF STRUCTURAL COMPLIANCE');
  const end = html.indexOf('PROFESSIONAL ENGINEER OF RECORD', start);
  expect(start).toBeGreaterThan(-1);
  return end > start ? html.slice(start, end) : html.slice(start);
}

describe('W8 — PE-1 projects the SAME gated state as PV-4C', () => {
  const { html } = genWith('rooftech-mini');
  const pe1 = pe1Slice(html);

  it('PE-1 is present for a roof RT-MINI project', () => {
    expect(html).toContain('LETTER OF STRUCTURAL COMPLIANCE');
  });

  it('no 600 lb allowable / safety factor / PASS on the capacity-gated PE-1 results table', () => {
    expect(pe1).toContain('CAPACITY SOURCE UNVERIFIED');
    expect(pe1).toContain('NO PASS/FAIL CONCLUSION ISSUED');
    // the unverified 600 lb allowable and the SF row are gone
    expect(pe1).not.toMatch(/600\s*lbs/);
    expect(pe1).not.toContain('Lag Bolt Capacity');
    expect(pe1).not.toContain('Safety Factor');
  });

  it('framing renders INDETERMINATE (no utilization %, no PASS) when framing authority is unverified', () => {
    expect(pe1).toContain('ENGINEERING REVIEW REQUIRED');
    expect(pe1).toMatch(/Framing Authority/);
    expect(pe1).toMatch(/UNVERIFIED/);
    // no fabricated 45-psf / 69% framing utilization printed
    expect(pe1).not.toMatch(/Load Utilization/);
    expect(pe1).not.toMatch(/Truss Capacity/);
  });

  it('gate 12 — no affirmative-conclusion tokens on the pending PE-1 page', () => {
    // Narrow labeled-placeholder exceptions: the honest gate prints "NO PASS/FAIL
    // CONCLUSION ISSUED" — strip that placeholder before scanning for an affirmative
    // bare PASS. No affirmative adequate / confirmed / certified / safety factor /
    // allowable-capacity conclusions may render on the pending page.
    const scan = pe1
      .replace(/NO (?:FRAMING )?PASS\/FAIL CONCLUSION ISSUED/g, '')
      .replace(/PASS\/FAIL/g, '');
    expect(/\(PASS\)/.test(scan)).toBe(false);
    expect(/\bPASS\b/.test(scan)).toBe(false);
    expect(/\badequate\b/i.test(pe1)).toBe(false);
    expect(/\bconfirmed\b/i.test(pe1)).toBe(false);
    expect(/allowable capacity/i.test(pe1)).toBe(false);
    expect(/safety factor/i.test(pe1)).toBe(false);
  });
});

describe('W7 — one stated load basis + labeled screening envelope', () => {
  const { snap } = genWith();   // default ironridge-xr100 (not capacity-gated)

  it('every attachment-uplift check states an ASD load basis (never ASD-vs-strength)', () => {
    const chk = snap.structural.checks.find(c => c.limitState === 'attachment-uplift')!;
    expect(chk.loadBasis).toBeTruthy();
    expect(chk.loadBasis!.designMethod).toBe('ASD');
    expect(chk.loadBasis!.loadCombination).toBe('0.6D + 0.6W (uplift)');
    expect(chk.loadBasis!.tributaryModel).toMatch(/SCREENING ENVELOPE/i);
    expect(chk.loadBasis!.capacityBasis).toMatch(/allowable/i);
  });

  it('attachment artifacts carry zone pressure + basis + honest zone-model label', () => {
    const a = snap.structural.attachments[0] as any;
    expect(a.loadBasis).toBe('ASD');
    expect(a.zoneModel).toMatch(/SCREENING ENVELOPE/i);
    expect(typeof a.zonePressurePsf === 'number' || a.zonePressurePsf === null).toBe(true);
  });

  it('reconciliation is labeled a conservative screening envelope, never "geometric reconciliation"', () => {
    const rr = snap.structural.reactionReconciliation;
    expect(rr.note).toMatch(/CONSERVATIVE SCREENING ENVELOPE/);
    expect(rr.note).not.toMatch(/geometric reconciliation/i);
    // separate validations replace the flat 3.0 band
    const names = rr.checks.map(c => c.name);
    expect(names).toContain('tributary-lost-load-floor');
    expect(names).toContain('tributary-duplicate-area-guard');
  });

  it('duplicate-area guard blocks a ~2x doubled tributary (former 3.0 band would pass it)', () => {
    // 6 attachments each 30 ft² tributary = 180 ft² over a 60 ft² footprint = 3.0×
    const dup = Array.from({ length: 6 }, (_, i) =>
      att({ attachmentId: `att-${i}`, railId: 'rail-1', tributaryAreaFt2: 30 }));
    const r = reconcileReactions(dup, 60, env(), 6, 0.9, true);
    expect(r.checks.find(c => c.name === 'tributary-duplicate-area-guard')!.ok).toBe(false);
    expect(r.ok).toBe(false);
  });
});
