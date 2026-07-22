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
  tributaryAreaFt2: 10, upliftReactionLbs: 200, downwardReactionLbs: 60,
  deadReactionLbs: 20, snowReactionLbs: 40, lateralReactionLbs: null,
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
    // count / tributary / uplift / snow / dead checks all present
    expect(r.checks.map(c => c.name)).toContain('attachment-count-vs-reaction-model');
    expect(r.checks.map(c => c.name)).toContain('tributary-sum-vs-array-area');
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
    expect(r.checks.find(c => c.name === 'tributary-sum-vs-array-area')!.ok).toBe(false);
  });

  it('scope mismatch (hybrid roof run) → area checks INFORMATIONAL, count stays hard', () => {
    const r = reconcileReactions(rail, 200, env(), 6, 0.9, false); // scopeMatched=false
    expect(r.ok).toBe(true); // area check does not block under a scope mismatch
    expect(r.checks.find(c => c.name === 'tributary-sum-vs-array-area')!.ok).toBe(true);
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
    expect(a.railModel).toMatch(/PENDING SELECTION/);
    expect(a.railSku).toBeNull();
    expect(a.splice).toMatch(/PENDING SELECTION/);
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
    expect(a.railModel).not.toMatch(/PENDING SELECTION/);
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
});
