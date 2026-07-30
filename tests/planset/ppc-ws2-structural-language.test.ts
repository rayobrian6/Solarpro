// ═══════════════════════════════════════════════════════════════════════════
// Projection / Procurement Corrective pass — WS-2 gates.
//   §3  (gate 4)   no unsupported MAX/MAXIMUM/allowable/approved SPACING language;
//                  PV-1 + PV-3 render ONE canonical spacing line with its status.
//   §4  (gates 5/6) a PENDING fastener assembly cannot render exact diameter /
//                  length / embedment / torque / pilot / coating / sealant /
//                  screw-count / manufacturer instructions, and an UNVERIFIED
//                  RT-MINI II document cannot authorize RT-MINI instructions.
//                  Exact instructions return ONLY on the five verified conditions.
//   §5  (gate 7)   racking rows classify A/B/C/D; nothing pending is orderable and
//                  no pending row may display a manufacturer / exact SKU; a
//                  verified selection auto-regenerates class A.
//   §6  (gates 8/9) the branch result column is AMPACITY / DEVICE-RATING RESULT,
//                  a pass reads "PASS — ELECTRICAL RATING ONLY", the companion
//                  branch matrix states route / grounding / procurement / OVERALL
//                  RELEASE, and a supply-side design renders no load-side-only
//                  NEC 705.12 citation.
//   §10 (gate 14)  pending issue state cannot render approved-design language;
//                  PV-5 prints the design-review-snapshot basis instead.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  projectAttachmentInstallationAuthority, projectFastenerAssembly,
  REFERENCE_DETAIL_BANNER,
} from '@/lib/permit/snapshot/structuralProjection';
import {
  classifyStructuralBomRows, STRUCTURAL_PROCUREMENT_CLASS_LABEL,
  type StructuralBomRowDraft,
} from '@/lib/permit/snapshot/structuralBom';
import { projectIssueStateLanguage } from '@/lib/permit/snapshot/projectAuthorityProjection';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(): { html: string; input: any; snap: PermitDesignSnapshot } {
  const input = clone(braidonOriginalAuditFixture) as any;
  const html = generatePermitHTML(input);
  return { html, input, snap: input._snapshot as PermitDesignSnapshot };
}

const PKG = gen();

/** Strip tags AND decode the entities the sheets emit, so prose assertions are
 *  not defeated by inline markup or by `&mdash;` standing in for an em dash. */
const text = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&times;/g, '×').replace(/&deg;/g, '°')
    .replace(/&Sigma;/g, 'Σ').replace(/&bull;/g, '•')
    .replace(/&check;/g, '✓').replace(/&middot;/g, '·').replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** The rendered sheets, split on the page wrapper. */
const sheets = (html: string): string[] => html.split(/<div class="page"/).slice(1);
const sheetWith = (html: string, marker: string): string =>
  sheets(html).find(p => p.includes(marker)) ?? '';

// ── §3 — spacing language ───────────────────────────────────────────────────
describe('PPC §3 (gate 4) — no unsupported maximum-spacing language', () => {
  it('the package contains ZERO "O.C. MAX" spacing strings', () => {
    expect(PKG.html).not.toMatch(/O\.C\.\s*MAX/i);
    expect(PKG.html).not.toMatch(/\bATTACH(?:MENT)?\.?\s+SPACING[^<]{0,40}\bMAX/i);
  });

  it('MAXIMUM / MAXIMUM ALLOWED spacing language appears only with verified authority', () => {
    // The canonical statusLabel is the ONLY sanctioned producer of the phrase, and
    // it emits it exclusively when verificationState === 'verified'.
    const spc = projectAttachmentInstallationAuthority(PKG.snap, 'rooftech-mini').spacing;
    if (spc.verificationState !== 'verified') {
      expect(text(PKG.html)).not.toMatch(/MAXIMUM ALLOWED/i);
      expect(text(PKG.html)).not.toMatch(/allowable spacing|approved spacing/i);
    }
  });

  it('PV-1 and PV-3 both render the ONE canonical spacing line', () => {
    const line = 'DESIGN ATTACHMENT SPACING: 48 IN. O.C.';
    const pv1 = sheetWith(PKG.html, 'SITE &amp; ROOF PLAN') || sheetWith(PKG.html, 'SITE & ROOF PLAN');
    const pv3 = sheetWith(PKG.html, 'ATTACHMENT DETAIL');
    expect(pv1).not.toBe('');
    expect(pv3).not.toBe('');
    for (const [name, sheet] of [['PV-1', pv1], ['PV-3', pv3]] as const) {
      expect(text(sheet), name).toContain(line);
      expect(text(sheet), name).toContain('PENDING STRUCTURAL VERIFICATION');
      expect(text(sheet), name).not.toMatch(/O\.C\.\s*MAX/i);
    }
  });

  it('PV-3 states the spacing in ONE unit (inches) — no 4\'-0" vs 48" split', () => {
    const pv3 = text(sheetWith(PKG.html, 'ATTACHMENT DETAIL'));
    expect(pv3).not.toMatch(/4'-0"\s*ATTACH/i);
  });
});

// ── §4 — fastener / document authority ──────────────────────────────────────
describe('PPC §4 (gates 5/6) — pending fastener assembly renders no exact instruction', () => {
  const pv3 = () => text(sheetWith(PKG.html, 'ATTACHMENT DETAIL'));

  it('exact instructions stay GATED — and the fastener itself is honestly UNVERIFIED (TAC WS-4)', () => {
    const fa = projectFastenerAssembly(PKG.input);
    // TAC WS-4 — the fastener is NOT verified: the only cited source is a
    // flashing/water-resistance evaluation report and the RT-MINI II document is
    // not verified applicable to the selected RT-MINI. Every gating condition
    // that is false must READ false — none may be assumed true.
    expect(fa.verification).toBe('unverified');
    const att = projectAttachmentInstallationAuthority(PKG.snap, 'rooftech-mini',
      { model: 'RT-MINI', docTitle: 'Roof Tech RT-MINI II Installation Manual (Jun 2025)' },
      { state: 'PENDING_APPLICABILITY', applicabilityVerified: false, documentProduct: 'RT-MINI II' });
    expect(att.exactInstructionsAllowed).toBe(false);
    expect(att.conditions.exactSkuSelected).toBe(false);
    expect(att.conditions.documentApplicabilityVerified).toBe(false);
    expect(att.conditions.fastenerAssemblyVerified).toBe(false);
  });

  it('PV-3 renders the state-derived PENDING block (fastener + instructions both pending)', () => {
    const t = pv3();
    expect(t).toContain('FASTENER ASSEMBLY: PENDING VERIFIED SELECTION');
    expect(t).not.toContain('FASTENER ASSEMBLY: VERIFIED');
    expect(t).toContain('INSTALLATION DETAILS: NOT ESTABLISHED');
    expect(t).toContain('DOCUMENT APPLICABILITY: RT-MINI II MANUAL NOT VERIFIED FOR SELECTED RT-MINI');
    expect(t).toContain(REFERENCE_DETAIL_BANNER);
  });

  it('PV-3 prints NO exact diameter / length / torque / pilot / coating / sealant instruction', () => {
    const t = pv3();
    expect(t).not.toMatch(/5\/16|3\/8"\s*DIA|\bDIA\s*×/i);
    expect(t).not.toMatch(/FT-LBS|ft-lbs?/i);          // the fabricated torque
    expect(t).not.toMatch(/PILOT HOLE/i);              // the fabricated pilot diameter
    expect(t).not.toMatch(/7\/32/);
    expect(t).not.toMatch(/316\s*S\.?S\.?/i);          // coating (material is an honest null)
    expect(t).not.toMatch(/SEALANT AT EVERY/i);
    expect(t).not.toMatch(/\d+(\.\d+)?"\s*MIN\.?\s*(THREAD\s*)?EMBED/i);
    expect(t).not.toMatch(/ALPHASEAL/i);               // hardcoded product name
  });

  it('the fabricated diameter-keyed torque + pilot derivations are DELETED from the source', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('lib/drafting/templates/roof.ts', 'utf8'));
    // the two DECLARATIONS that invented authority from the fastener diameter
    // (the historical expressions survive only inside the explanatory comment).
    expect(src).not.toMatch(/const\s+_torque\s*=/);
    expect(src).not.toMatch(/const\s+_pilot\s*=/);
  });

  it('the detail still RENDERS (geometry kept) — it is bannered, not deleted', () => {
    const pv3sheet = sheetWith(PKG.html, 'ATTACHMENT DETAIL');
    expect(pv3sheet).toMatch(/<svg/);
    expect(text(pv3sheet)).toContain('NON-AUTHORITATIVE');
  });

  it('exact instructions return ONLY when all five conditions are verified (synthetic)', () => {
    const s = clone(PKG.snap) as any;
    const ra = s.structural.rackingAssembly;
    ra.mountSku = 'RT-MINI-EXACT-SKU';
    ra.railSku = 'XR100-168';
    ra.railModel = 'XR100';
    ra.assemblyVerification = { ...(ra.assemblyVerification ?? {}), fastener: 'verified', overall: 'verified' };
    // TAC WS-4 — the cited source must be an INSTALLATION/STRUCTURAL document.
    // This synthetic previously cited 'ESR-XXXX', a flashing / water-resistance
    // evaluation report, which the one fastener predicate now (correctly) refuses
    // as installation authority — so the "all five verified" case needs a real
    // installation manual, which is what a verified assembly would actually cite.
    ra.datasheetSource = 'Roof Tech RT-MINI Installation Manual (archived)';
    ra.structuralAuthorityGaps = [];
    ra.capacityProvenance = {
      ...(ra.capacityProvenance ?? {}),
      sourceDocument: { identity: 'PE letter', revisionOrDate: '2026', issuingEntity: 'PE',
        documentHash: 'a'.repeat(64), archivedInRepo: true, hashNote: 'archived', url: null },
    };
    s.permitReadiness.blockers = [];
    const att = projectAttachmentInstallationAuthority(s as PermitDesignSnapshot, 'rooftech-mini',
      { model: 'RT-MINI', docTitle: 'Roof Tech RT-MINI Installation Manual' },
      { state: 'APPLICABLE', applicabilityVerified: true, documentProduct: 'RT-MINI' });
    expect(att.conditions).toEqual({
      exactSkuSelected: true,
      documentApplicabilityVerified: true,
      documentArchivedHashBound: true,
      fastenerAssemblyVerified: true,
      selectionBoundToCurrentDigest: true,
    });
    expect(att.exactInstructionsAllowed).toBe(true);
    expect(att.pendingLines).toEqual([]);
    expect(att.referenceDetailBanner).toBeNull();
  });
});

// ── §5 — racking procurement classification ─────────────────────────────────
describe('PPC §5 (gate 7) — pending racking components are non-orderable', () => {
  const rows = () => (PKG.snap.structural.bom ?? []) as unknown as Array<{
    key: string; qty: number; partNumber: string | null;
    procurementClass: string; orderable: boolean;
    manufacturerDisplayAllowed: boolean; skuDisplayAllowed: boolean;
  }>;

  it('every canonical structural BOM row carries a classification', () => {
    expect(rows().length).toBeGreaterThan(0);
    for (const r of rows()) expect(['A', 'B', 'C', 'D']).toContain(r.procurementClass);
  });

  it('NO row is orderable while the racking assembly is unselected', () => {
    for (const r of rows()) {
      expect(r.procurementClass, r.key).not.toBe('A');
      expect(r.orderable, r.key).toBe(false);
    }
  });

  it('no pending row may display a manufacturer or an exact SKU', () => {
    for (const r of rows()) {
      expect(r.manufacturerDisplayAllowed, r.key).toBe(false);
      expect(r.skuDisplayAllowed, r.key).toBe(false);
    }
  });

  it('assembly-dependent components + the mount base + the fastener are class B', () => {
    const byKey = new Map(rows().map(r => [r.key, r]));
    for (const k of ['rails', 'railSplices', 'mounts', 'midClamps', 'endClamps',
      'mountingBolts', 'bondingClips', 'lagBolts']) {
      expect(byKey.get(k)?.procurementClass, k).toBe('B');
    }
  });

  it('the class-B label is Ray\'s exact wording and reaches the rendered schedule', () => {
    expect(STRUCTURAL_PROCUREMENT_CLASS_LABEL.B)
      .toBe('DESIGN QUANTITY — NON-ORDERABLE / PENDING RACKING ASSEMBLY SELECTION');
    expect(text(PKG.html)).toContain('DESIGN QUANTITY — NON-ORDERABLE / PENDING RACKING ASSEMBLY SELECTION');
  });

  it('RT-MINI-01 never renders as an authoritative selected SKU', () => {
    for (const r of rows()) {
      if (r.skuDisplayAllowed) expect(r.partNumber).not.toMatch(/RT-MINI-01/i);
    }
  });

  it('a VERIFIED selection auto-regenerates orderable class-A rows (synthetic)', () => {
    const drafts: StructuralBomRowDraft[] = [
      { key: 'rails', category: 'rail', item: 'XR100', qty: 20, unit: 'ea', partNumber: 'XR100-168',
        derivedFrom: 'test', provenance: { source: 'test', note: 'test' } },
      { key: 'mounts', category: 'mount', item: 'RT-MINI', qty: 64, unit: 'ea', partNumber: 'RT-MINI-SKU',
        derivedFrom: 'test', provenance: { source: 'test', note: 'test' } },
      { key: 'lagBolts', category: 'lag_bolt', item: 'screw', qty: 128, unit: 'ea', partNumber: 'SCREW-1',
        derivedFrom: 'test', provenance: { source: 'test', note: 'test' } },
    ];
    const verified = classifyStructuralBomRows(drafts, {
      rails: [], attachments: [], moduleInstances: [],
      rackingAssembly: {
        railSku: 'XR100-168', railModel: 'XR100', mountSku: 'RT-MINI-SKU',
        datasheetSource: 'Roof Tech RT-MINI Installation Manual (archived)',
        assemblyVerification: { railSku: 'verified', capacitySource: 'verified', spanSource: 'verified', fastener: 'verified', overall: 'verified' },
        structuralAuthorityGaps: [],
      } as never,
      // TAC WS-4 — the classifier no longer re-derives the fastener verdict; the
      // ONE predicate's result is passed in by the caller (buildStructuralAuthority
      // in production). A verified assembly supplies true.
      fastenerVerified: true,
    });
    for (const r of verified) {
      expect(r.procurementClass, r.key).toBe('A');
      expect(r.orderable, r.key).toBe(true);
      expect(r.manufacturerDisplayAllowed, r.key).toBe(true);
      expect(r.skuDisplayAllowed, r.key).toBe(true);
      expect(r.nonOrderableReason, r.key).toBeNull();
    }
    // …and the SAME classifier still refuses when the rail SKU is unpinned.
    const pending = classifyStructuralBomRows(drafts, {
      rails: [], attachments: [], moduleInstances: [],
      rackingAssembly: {
        railSku: null, railModel: 'RAIL / SPLICE SKU PENDING SELECTION', mountSku: null,
        assemblyVerification: { railSku: 'pending', capacitySource: 'pending', spanSource: 'pending', fastener: 'pending', overall: 'pending' },
        structuralAuthorityGaps: [],
      } as never,
    });
    for (const r of pending) expect(r.procurementClass, r.key).toBe('B');
  });
});

// ── §6 — branch status semantics + topology-driven citations ─────────────────
describe('PPC §6 (gate 8) — generic PASS cannot hide branch blockers', () => {
  const sched = () => sheets(PKG.html).find(p => p.includes('AC Branch Circuit Schedule')) ?? '';

  it('the branch result column is AMPACITY / DEVICE-RATING RESULT', () => {
    const t = text(sched());
    expect(t).toContain('AMPACITY / DEVICE-RATING RESULT');
  });

  it('a passing branch reads "PASS — ELECTRICAL RATING ONLY", never a bare PASS', () => {
    const t = text(sched());
    expect(t).toContain('PASS — ELECTRICAL RATING ONLY');
    // no bare "✓ PASS" badge survives in the branch schedule
    expect(t).not.toMatch(/✓\s*PASS/);
  });

  it('every branch carries route / grounding / procurement / OVERALL RELEASE status', () => {
    const t = text(sched());
    expect(t).toContain('BRANCH RELEASE STATUS');
    for (const b of ['B1', 'B2', 'B3']) expect(t).toContain(b);
    expect(t).toContain('PENDING MANUFACTURER AUTHORITY');       // grounding authority
    expect(t).toMatch(/ROUTE AUTHORITY:/);
    expect(t).toMatch(/PENDING — CAD-DERIVED ESTIMATE/);          // route authority
    expect(t).toMatch(/OVERALL RELEASE: BLOCKED/);
  });

  it('the Q-Cable deficit is never apportioned per branch', () => {
    const t = text(sched());
    expect(t).not.toMatch(/this branch is short by/i);
    expect(t).not.toMatch(/B[123][^.]{0,40}short by \d/i);
  });
});

describe('PPC §6 (gate 9) — a supply-side design renders no load-side-only citation', () => {
  it('the design IS supply-side (705.11) on the canonical record', () => {
    expect(PKG.snap.project.interconnection.rule).toBe('705.11');
  });

  it('no load-side-only 705.12 clause is cited anywhere in the package', () => {
    const t = text(PKG.html);
    // load-side-only clauses
    expect(t).not.toMatch(/705\.12\(D\)/);
    expect(t).not.toMatch(/705\.12\(B\)\(2\)\(3\)\(e\)/);
    expect(t).not.toMatch(/705\.13\b/);
    // a bare "per NEC 705.12" requirement (as opposed to the legitimate
    // "705.12(B) does not apply / N/A" statements)
    expect(t).not.toMatch(/per NEC 705\.12(?!\()/);
    expect(t).not.toMatch(/NEC 690\.8\(A\) \/ 705\.12/);
  });

  it('the legitimate 705.12(B)-not-applicable statements are PRESERVED', () => {
    const t = text(PKG.html);
    expect(t).toMatch(/705\.12\(B\)\)? (does not apply|applies only load-side|N\/A)/);
  });
});

// ── §10 — issue-state language ──────────────────────────────────────────────
describe('PPC §10 (gate 14) — pending issue state cannot render approved-design language', () => {
  it('the issue-state language accessor refuses approved wording while blockers are open', () => {
    const lang = projectIssueStateLanguage(PKG.snap);
    expect(lang.openBlockers).toBeGreaterThan(0);
    expect(lang.approved).toBe(false);
    expect(lang.computedFromLabel)
      .toBe('SITE-COMPUTED FROM THE CURRENT DESIGN-REVIEW SNAPSHOT — NOT YET APPROVED');
    expect(lang.packageLabel).toBe('DESIGN REVIEW PACKAGE');
    expect(lang.deviationReferenceLabel).toBe('the design of record as issued for review');
  });

  it('PV-5 states the design-review-snapshot basis, never "the approved design"', () => {
    const pv5 = sheetWith(PKG.html, 'WARNING LABELS');
    expect(pv5).not.toBe('');
    const t = text(pv5);
    expect(t).toContain('SITE-COMPUTED FROM THE CURRENT DESIGN-REVIEW SNAPSHOT — NOT YET APPROVED');
    expect(t).not.toMatch(/APPROVED DESIGN/i);
    expect(t).not.toMatch(/approved plans|engineer approved|permit approved|construction approved/i);
    // The label COUNT line must survive the pending-state sweep.
    // TAC WS-13 — the old header ("N SITE-COMPUTED + M STANDARD (R OF D DATASET
    // LABELS APPLY)") stated two true numbers that did not add up: the labels
    // superseded by the rating cards / the power-source placard were subtracted
    // from the decal count and then left uncounted. Assert the applicability
    // count AND the reconciliation that closes the arithmetic.
    expect(t).toMatch(/\d+ OF \d+ DATASET LABELS \(\d+ DECALS?/);
    expect(t).toMatch(/\d+ \+ \d+ YES\* = \d+ of \d+ apply, \d+ N\/A/);
  });

  it('the accessor DOES permit approved wording once a digest-bound approval clears', () => {
    const s = clone(PKG.snap) as any;
    s.projectAuthority.issueState = 'PERMIT-READY';
    s.permitReadiness.registry = [];
    s.permitReadiness.blockers = [];
    s.permitReadiness.ready = true;
    const lang = projectIssueStateLanguage(s as PermitDesignSnapshot);
    expect(lang.approved).toBe(true);
    expect(lang.computedFromLabel).toBe('SITE-COMPUTED FROM THE APPROVED DESIGN');
  });
});
