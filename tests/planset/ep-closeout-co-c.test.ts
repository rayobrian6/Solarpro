// ═══════════════════════════════════════════════════════════════════════════
// EP CLOSEOUT — WS-C (§11–§14): racking candidate-vs-selected, document
// applicability, fastener registry, spacing authority. Pure/deterministic gates.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { evaluateDocumentApplicability, getManufacturerAsset } from '@/lib/manufacturer-assets-db';
import { SEVERITY_POLICY, classifyBlockerSeverity, validateSeverityPolicy } from '@/lib/permit/snapshot/severityPolicy';
import { runStructuralCalcV4 } from '@/lib/structural-engine-v4';

// ── §12 — product-version document applicability ─────────────────────────────
// ECD §8 — the binary `state: 'verified' | 'unverified'` was widened to the SEVEN
// document states (ARCHIVED / APPLICABLE / VERIFIED / AUTHORITATIVE / SUPERSEDED /
// NOT_APPLICABLE / PENDING_APPLICABILITY) because "held on file" is not
// "applicable to the selected product". The APPLICABILITY LOGIC these gates assert
// is unchanged: `applicabilityVerified` is bit-for-bit the old `state ===
// 'verified'`, so each expectation below is restated against it plus the exact new
// state it now resolves to.
describe('§12 document applicability (product-version gate)', () => {
  const rtMiniAsset = getManufacturerAsset('rooftech-mini', 'racking_detail');
  const xrAsset = getManufacturerAsset('ironridge-xr100', 'racking_detail');

  it('RT-MINI mount vs RT-MINI II manual ⇒ UNVERIFIED (version conflation)', () => {
    const a = evaluateDocumentApplicability('RT-MINI', rtMiniAsset);
    expect(a.applicabilityVerified).toBe(false);
    expect(a.state).toBe('PENDING_APPLICABILITY');
    expect(a.documentProduct).toMatch(/RT-MINI II/i);
  });

  it('IronRidge XR100 mount vs XR Flush Mount manual ⇒ VERIFIED (mere naming variance, not a version mismatch)', () => {
    const a = evaluateDocumentApplicability('IronRidge XR100', xrAsset);
    expect(a.applicabilityVerified).toBe(true);
    expect(a.state).toBe('APPLICABLE');
  });

  it('a verified alias evidence record clears the version mismatch (never fabricated)', () => {
    const a = evaluateDocumentApplicability('RT-MINI', rtMiniAsset, {
      selectedModel: 'RT-MINI', documentProduct: 'RT-MINI II', verified: true, evidenceRef: 'doc-registry:rt-alias-1',
    });
    expect(a.applicabilityVerified).toBe(true);
    // a VERIFIED alias evidence record is the 'VERIFIED' state (stronger than the
    // identity-match 'APPLICABLE'), and still NOT authoritative (no archived hash).
    expect(a.state).toBe('VERIFIED');
    expect(a.authoritative).toBe(false);
    expect(a.crossReferenceEvidence).toBe('doc-registry:rt-alias-1');
  });

  it('an UNVERIFIED alias does NOT clear it', () => {
    const a = evaluateDocumentApplicability('RT-MINI', rtMiniAsset, {
      selectedModel: 'RT-MINI', documentProduct: 'RT-MINI II', verified: false, evidenceRef: 'note',
    });
    expect(a.applicabilityVerified).toBe(false);
    expect(a.state).toBe('PENDING_APPLICABILITY');
  });
});

// ── §12/§13 — severity policy registration ───────────────────────────────────
describe('§12/§13 severity policy — new blockers registered blocking', () => {
  it('policy table is self-consistent', () => {
    expect(validateSeverityPolicy()).toEqual([]);
  });
  it('FASTENER-ASSEMBLY-UNVERIFIED is blocking', () => {
    expect(SEVERITY_POLICY['FASTENER-ASSEMBLY-UNVERIFIED']).toBeDefined();
    expect(classifyBlockerSeverity('FASTENER-ASSEMBLY-UNVERIFIED').severity).toBe('blocking');
  });
  it('EQUIPMENT-DOCUMENT-APPLICABILITY is blocking', () => {
    expect(SEVERITY_POLICY['EQUIPMENT-DOCUMENT-APPLICABILITY']).toBeDefined();
    expect(classifyBlockerSeverity('EQUIPMENT-DOCUMENT-APPLICABILITY').severity).toBe('blocking');
  });
});

// ── §11 — assembly-dependent racking rows are non-orderable when rail unpinned ─
describe('§11 racking BOM — assembly-dependent rows gated while rail unpinned', () => {
  const structInput: any = {
    installationType: 'roof_mount', windSpeed: 110, windExposure: 'C', groundSnowLoad: 20,
    meanRoofHeight: 15, roofPitch: 26, framingType: 'rafter', rafterSize: '2x6', rafterSpanFt: 12,
    rafterSpacingIn: 24, woodSpecies: 'df_larch', panelCount: 31, panelLengthIn: 66.9,
    panelWidthIn: 40.9, panelWeightLbs: 46, panelOrientation: 'portrait', mountingSystemId: 'rooftech-mini',
  };

  it('RT-MINI (rail unpinned): rails/splice/clamps/T-bolt/L-foot/bonding are PENDING + non-orderable (null SKU), qty preserved', () => {
    const sr: any = runStructuralCalcV4(structInput);
    const rb = sr.rackingBOM;
    for (const k of ['rails', 'railSplices', 'lFeet', 'midClamps', 'endClamps', 'mountingBolts', 'bondingClips'] as const) {
      const row = rb[k];
      expect(row.pending, `${k}.pending`).toBe(true);
      expect(row.orderable, `${k}.orderable`).toBe(false);
      expect(row.partNumber, `${k}.partNumber`).toBeNull();
      expect(row.description, `${k}.description`).toMatch(/PENDING RACKING ASSEMBLY SELECTION/);
      expect(row.qty, `${k}.qty > 0 (geometry preserved)`).toBeGreaterThan(0);
    }
    // PPC §5 SUPERSEDES the original CO-C carve-out for the MOUNT BASE: Ray now
    // requires the mount-base line gated too, because the canonical racking record
    // itself carries `mountSku: null` while the BOM printed a registry id
    // ('RT-MINI-01') as though a part had been selected. The mount QUANTITY (one per
    // attachment) is real and preserved; its SKU/manufacturer display is not.
    expect(rb.mounts.pending).toBe(true);
    expect(rb.mounts.orderable).toBe(false);
    expect(rb.mounts.procurementClass).toBe('B');
    expect(rb.mounts.skuDisplayAllowed).toBe(false);
    expect(rb.mounts.manufacturerDisplayAllowed).toBe(false);
    expect(rb.mounts.qty).toBeGreaterThan(0);
    // Mount-base parts that do NOT depend on the rail selection keep their
    // engine-level orderability (the authority layer downgrades the fastener row
    // separately while FASTENER-ASSEMBLY-UNVERIFIED is active).
    expect(rb.lagBolts.pending).not.toBe(true);
    expect(rb.groundLugs.pending).not.toBe(true);
    // PPC §5 — every row carries a procurement classification, and the gated ones
    // carry Ray's exact class-B label.
    for (const k of ['rails', 'railSplices', 'lFeet', 'midClamps', 'endClamps', 'mountingBolts', 'bondingClips'] as const) {
      expect(rb[k].procurementClass, `${k}.procurementClass`).toBe('B');
      expect(rb[k].manufacturerDisplayAllowed, `${k}.mfrDisplay`).toBe(false);
      expect(rb[k].skuDisplayAllowed, `${k}.skuDisplay`).toBe(false);
      expect(rb[k].description).toContain('DESIGN QUANTITY — NON-ORDERABLE / PENDING RACKING ASSEMBLY SELECTION');
    }
  });
});
