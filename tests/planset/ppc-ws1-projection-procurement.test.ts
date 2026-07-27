// ═══════════════════════════════════════════════════════════════════════════
// PPC WS-1 — PROJECTION / PROCUREMENT AUTHORITY CORRECTIVE PASS
// docs/PROJECTION-PROCUREMENT-CORRECTIVE-DIRECTIVE.md §1 §2 §7 §8 §9
// (+ the §5 flag-propagation root fix WS-1 owns at the bom-engine boundary)
//
// §1  E-1 must not assert an installed open-air EGC while the grounding method
//     is PENDING. Gate 1 is an ASSERTION-CLASS scan, not a phrase list — the
//     previous phrase-list gate (planset-evidence-bar.mjs `groundingNoAssertion
//     WhilePending`) is exactly why `— with circuit conductors` leaked for four
//     consecutive campaigns.
// §2  RS-1 blocker-detail components are selected by canonical PAYLOAD SCHEMA.
//     Every registry code maps to its correct schema.
// §7  the legacy PV-4B project-level EGC <tr> is gone; every rendered grounding
//     conductor is a canonical GroundingSegment with a groundingSegmentId
//     (gate 10).
// §8  a PENDING quantity may never render as a certain zero (gate 11).
// §9  the insufficient Q-Cable BOM row is itself NON-ORDERABLE (gate 12), and
//     the AUTHORITATIVE PROCUREMENT TOTAL / orderable export excludes every
//     blocked row (gates 7 + 13).
//
// NON-VACUITY: the frozen acceptance fixture does NOT trip
// QCABLE-PROCUREMENT-INSUFFICIENT (audit §0), so §2's deficit component and all
// of §9 are tested against a PROCUREMENT-INSUFFICIENT INPUT built here. The
// frozen fixture is never modified.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { roofProject } from '../../test-fixtures/roofProject';
import {
  projectE1PhysicalSchedule, projectGroundingSegments, projectOpenAirBranchGrounding,
} from '@/lib/permit/snapshot/electricalProjection';
import {
  resolveOpenAirGroundingAuthority,
  GROUNDING_PENDING_BONDING_CELL_LABEL, GROUNDING_NON_ORDERABLE_LABEL,
  type GroundingDocumentEvidence, type ResolveGroundingAuthorityArgs,
} from '@/lib/permit/snapshot/groundingAuthority';
import {
  BLOCKER_PAYLOAD_SCHEMA, blockerPayloadSchema, renderBlockerPayload,
  pageReviewStatus, renderReviewStatusSheets, type BlockerPayloadSchema,
} from '@/lib/permit/sections/reviewStatus';
import { pageConductorSchedule, pageSingleLineDiagram } from '@/lib/permit/sections/electricalPages';
import { pageEquipmentSchedule, pageEquipmentScheduleCont } from '@/lib/permit/sections/structuralPages';
import {
  generateBOMForPermit, buildProcurementApproval, orderableProcurementExport,
  isOrderableForProcurement, type PermitBOMItem,
} from '@/lib/permit/utils/bomForPermit';
import {
  buildProcurementSufficiency, procurementInsufficiencyPayload,
} from '@/lib/permit/snapshot/procurementSufficiency';
import type {
  PermitDesignSnapshot, PermitReadinessBlocker, BranchCablePath, ListedCableAssembly,
} from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// ═══════════════════════════════════════════════════════════════════════════
// THE ASSERTION-CLASS SCANNER (gate 1)
//
// Written against the CLASS of statement, never an enumerated phrase list: a
// violation is any rendered text segment that (a) is about the OPEN-AIR branch /
// listed-cable-assembly section, (b) names an equipment grounding conductor, and
// (c) presents it as INSTALLED — either by stating a conductor SIZE or by using
// an installation predicate — WITHOUT the explicit non-assertion / pending /
// candidate qualifier. `— with circuit conductors` is one member of that class,
// not the definition of it, so a new phrasing of the same lie is still caught.
// ═══════════════════════════════════════════════════════════════════════════
const CTX_OPEN_AIR = /open[- ]air|q[- ]?cable|branch trunk|free air|690\.31\(c\)/i;
const TOK_EGC = /\begc\b|equipment grounding conductor|grounding conductor/i;
const TOK_SIZE = /#\s?\d+(?:\/0)?\s*awg|#\s?\d+\b/i;
const PRED_INSTALLED =
  /\b(installed|install|is run|are run|run with|routed with|with circuit conductors|shall be run|provide|provided|is required|are required|required by)\b/i;
const QUAL_NON_ASSERTION =
  /not asserted|pending manufacturer authority|pending exact manufacturer authority|candidate design quantity|non-orderable|not established|not determinative|not part of the approved installation|pending\b/i;
/** An explicitly NEGATED statement is not an assertion. */
const QUAL_NEGATED =
  /\bno\s+(additional\s+|separate\s+|raceway\s+)?(equipment grounding conductor|egc|grounding conductor)\b|\bis not (installed|required|asserted)\b|\bnone (is |are )?(installed|required)\b/i;

const strip = (html: string): string => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(td|span|strong|em|text|th)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&rsquo;/g, "'");

/** Split rendered HTML into BLOCKS (one table row / one note div). Context is
 *  block-scoped: in a schedule the section label and its bonding cell are two
 *  <td>s of the SAME <tr>, so a segment-only scan would miss the very assertion
 *  the row makes (that is how `#12 AWG Cu EGC — with circuit conductors` sat one
 *  cell away from `Q-CABLE TRUNK (OPEN AIR)` and passed every prior gate). */
export function blocks(html: string): string[] {
  // SVG has no rows: each <text>/<g> label is its own block, otherwise the whole
  // single-line diagram would be one block and every legitimate IN-RACEWAY EGC
  // label inside it would inherit the diagram's open-air context.
  return html.split(/<\/tr>|<\/div>|<\/li>|<\/p>|<\/table>|<\/text>|<\/g>|<\/svg>/i);
}

/** Sentence/bullet segments inside a block. */
export function segments(blockText: string): string[] {
  return blockText
    .split(/\n+|(?<=[.;])\s+|\s·\s/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Every rendered statement that asserts an INSTALLED open-air EGC. Empty ⇒ gate
 *  1 passes. The predicate is the assertion CLASS: within a block that is ABOUT
 *  the open-air / listed-cable-assembly section, any segment that names an EGC and
 *  either states a conductor size or uses an installation predicate, and is not
 *  explicitly pending / candidate / negated. */
export function installedOpenAirEgcAssertions(html: string): string[] {
  const out: string[] = [];
  for (const b of blocks(html)) {
    const text = strip(b);
    if (!CTX_OPEN_AIR.test(text)) continue;
    for (const s of segments(text)) {
      if (!TOK_EGC.test(s)) continue;
      if (!(TOK_SIZE.test(s) || PRED_INSTALLED.test(s))) continue;
      if (QUAL_NON_ASSERTION.test(s) || QUAL_NEGATED.test(s)) continue;
      out.push(s);
    }
  }
  return out;
}

// ── one real rendered package from the FROZEN acceptance fixture ─────────────
let PKG: { input: any; cad: any; snap: PermitDesignSnapshot };
beforeAll(() => {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-26T12:00:00Z';
  generatePermitHTML(input);
  PKG = { input, cad: generateCADLayout(input), snap: input._snapshot };
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — the projection root: the E-1 bonding cell derives from the AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════
describe('§1 — E-1 open-air branch bonding projects the grounding authority', () => {
  it('the live outcome is PENDING and every open-air branch row renders the NON-ASSERTION label', () => {
    const g = projectOpenAirBranchGrounding(PKG.snap);
    expect(g.present).toBe(true);
    expect(g.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');

    const sections = projectE1PhysicalSchedule(PKG.snap);
    const branchRows = sections.filter(s => s.sectionId === 'BRANCH_RUN');
    expect(branchRows.length).toBeGreaterThan(0);
    for (const r of branchRows) {
      expect(r.bonding).toBe(GROUNDING_PENDING_BONDING_CELL_LABEL);
      expect(r.bondingPendingAuthority).toBe(true);
      // the retired assertions
      expect(r.bonding).not.toMatch(/with circuit conductors/i);
      expect(r.bonding).not.toMatch(/#\s?\d+\s*AWG/i);
      expect(r.bonding).not.toMatch(/\bPASS\b/);
      expect(r.bonding).not.toMatch(/250\.122/);
    }
  });

  it('gate 10 — every branch row carries a groundingSegmentId', () => {
    for (const r of projectE1PhysicalSchedule(PKG.snap)) {
      if (r.bonding == null) continue;
      expect(r.groundingSegmentId, `${r.sectionId} renders bonding without a segment id`).toBeTruthy();
    }
  });

  it('the six grounding objects stay separate — the branch cell never borrows the FEEDER EGC gauge', () => {
    const sections = projectE1PhysicalSchedule(PKG.snap);
    const feederEgc = PKG.snap.electrical.groundingObjects.find(g => g.purpose === 'feeder-egc')?.conductorSize;
    const branch = sections.find(s => s.sectionId === 'BRANCH_RUN')!;
    if (feederEgc) expect(branch.bonding).not.toContain(feederEgc);
    // and the in-raceway rows keep their OWN independent basis + ids
    const hr = sections.find(s => s.sectionId === 'BRANCH_HOMERUN_RUN');
    if (hr?.bonding) {
      expect(hr.bondingPendingAuthority).toBe(false);
      expect(hr.groundingSegmentId).not.toBe(branch.groundingSegmentId);
    }
  });

  // Outcomes A/B render their HONEST results — the fix is not "always print
  // PENDING", it is "print what the authority actually established".
  const baseArgs = (over: Partial<ResolveGroundingAuthorityArgs> = {}): ResolveGroundingAuthorityArgs => ({
    present: true,
    selection: {
      microSku: 'SYNTH-MICRO-1', cableSku: 'SYNTH-CABLE-1', moduleSku: 'SYNTH-MODULE-1',
      mountingBondingSystem: 'SYNTH-MOUNT-1', jurisdiction: 'SYNTHETIC TEST JURISDICTION',
    },
    equipmentFacts: {
      cableConductorConstruction: 'two-wire, double-insulated', cableConductorCount: 2,
      equipmentInsulationClassification: null,
    },
    documentEvidence: null,
    conductorMaterial: 'Cu', conductorSizeNecDerived: '#12 AWG',
    conductorSizingBasis: 'NEC 250.122 @ 20A', branchIds: ['br-1'], segmentIds: ['BRANCH_RUN'],
    pathBasis: 'Σ per-branch BranchCablePath', designedInstalledFt: 100, lengthProvenance: 'geometry-derived',
    wasteFactor: 1.15, quantityFt: 115,
    ...over,
  });
  /** SYNTHETIC, clearly-fake exactly-applicable document (never real evidence). */
  const synthDoc = (m: GroundingDocumentEvidence['statedGroundingMethod']): GroundingDocumentEvidence => ({
    documentId: 'SYNTHETIC-PPC-DOC-0001', documentClass: 'microinverter_installation_manual',
    title: 'SYNTHETIC TEST DOCUMENT — NOT REAL MANUFACTURER EVIDENCE', revision: 'TEST-0',
    documentHash: '0'.repeat(64), archivedInRepo: true, verificationState: 'verified',
    status: 'current', sectionOrPage: '§SYNTH-1', statedGroundingMethod: m,
    statedText: 'SYNTHETIC TEST TEXT', equipmentClassification: 'SYNTHETIC: Class II',
    applicability: {
      microinverterSkus: ['SYNTH-MICRO-1'], cableAssemblySkus: ['SYNTH-CABLE-1'],
      moduleSkus: ['SYNTH-MODULE-1'], mountingBondingSystems: ['SYNTH-MOUNT-1'],
      jurisdictions: ['SYNTHETIC TEST JURISDICTION'], scope: 'exact-sku',
      productLine: 'SYNTHETIC (test fixture)',
    },
  });

  const snapWithOutcome = (m: GroundingDocumentEvidence['statedGroundingMethod']): PermitDesignSnapshot => {
    const s = clone(PKG.snap) as any;
    s.electrical.openAirGroundingAuthority =
      resolveOpenAirGroundingAuthority(baseArgs({ documentEvidence: synthDoc(m) }));
    return s as PermitDesignSnapshot;
  };

  it('outcome A renders the LISTED INTEGRATED METHOD — no installed conductor, no PENDING', () => {
    const rows = projectE1PhysicalSchedule(snapWithOutcome('no-additional-equipment-grounding-conductor'))
      .filter(s => s.sectionId === 'BRANCH_RUN');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.bonding).toMatch(/LISTED INTEGRATED METHOD/);
      expect(r.bonding).toMatch(/NO ADDITIONAL OPEN-AIR EGC INSTALLED/);
      expect(r.bondingPendingAuthority).toBe(false);
      expect(r.bonding).not.toMatch(/PENDING/);
    }
  });

  it('outcome B renders the HONEST installed additional EGC with the authority size', () => {
    const rows = projectE1PhysicalSchedule(snapWithOutcome('additional-equipment-grounding-conductor'))
      .filter(s => s.sectionId === 'BRANCH_RUN');
    for (const r of rows) {
      expect(r.bonding).toMatch(/ADDITIONAL EGC INSTALLED/);
      expect(r.bonding).toContain('#12 AWG');
      expect(r.bondingPendingAuthority).toBe(false);
      expect(r.bonding).not.toMatch(/with circuit conductors/i);
    }
  });

  it('the CANDIDATE EGC label carries Ray’s three required clauses', () => {
    expect(GROUNDING_NON_ORDERABLE_LABEL).toContain('CANDIDATE DESIGN QUANTITY');
    expect(GROUNDING_NON_ORDERABLE_LABEL).toContain('NON-ORDERABLE');
    expect(GROUNDING_NON_ORDERABLE_LABEL).toContain('NOT PART OF THE APPROVED INSTALLATION');
    expect(GROUNDING_NON_ORDERABLE_LABEL).toContain('PENDING EXACT MANUFACTURER AUTHORITY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GATE 1 (rendered) — assertion-CLASS scan of the real sheets
// ═══════════════════════════════════════════════════════════════════════════
describe('gate 1 — pending grounding produces ZERO installed-open-air-EGC assertions', () => {
  it('E-1 (SLD + physical schedule + grounding note) makes no installed assertion', () => {
    const e1 = pageSingleLineDiagram(PKG.input, PKG.cad, 6, 21);
    const viol = installedOpenAirEgcAssertions(e1);
    expect(viol, `E-1 installed-EGC assertions: ${JSON.stringify(viol, null, 1)}`).toEqual([]);
  });

  it('PV-4B (conductor schedule + assembly note + grounding rows) makes no installed assertion', () => {
    const pv4b = pageConductorSchedule(PKG.input, PKG.cad, 7, 21);
    const viol = installedOpenAirEgcAssertions(pv4b);
    expect(viol, `PV-4B installed-EGC assertions: ${JSON.stringify(viol, null, 1)}`).toEqual([]);
  });

  it('the scanner is not vacuous — it CATCHES the exact retired literal and its paraphrases', () => {
    const retired = '<td>AC BRANCH B1 — Q-CABLE TRUNK (OPEN AIR)</td>'
      + '<td>#12 AWG Cu EGC (NEC 250.122 @ 20A) — with circuit conductors</td>';
    expect(installedOpenAirEgcAssertions(retired).length).toBeGreaterThan(0);
    const paraphrase = '<div>Open-air branch: a #10 AWG copper equipment grounding conductor is installed '
      + 'alongside the Q-Cable trunk.</div>';
    expect(installedOpenAirEgcAssertions(paraphrase).length).toBeGreaterThan(0);
    const noSizeParaphrase = '<div>Provide an equipment grounding conductor run with the open-air branch trunk.</div>';
    expect(installedOpenAirEgcAssertions(noSizeParaphrase).length).toBeGreaterThan(0);
  });

  it('the scanner accepts the honest PENDING rendering', () => {
    const honest = `<div>AC BRANCH B1 — Q-CABLE TRUNK (OPEN AIR)</div><div>${GROUNDING_PENDING_BONDING_CELL_LABEL}</div>`;
    expect(installedOpenAirEgcAssertions(honest)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — blocker-detail component selection by canonical payload schema
// ═══════════════════════════════════════════════════════════════════════════
describe('§2 — RS-1 blocker payload components are schema-selected', () => {
  // The 19 codes of the audited package + every other code the build can push.
  const EXPECTED: Record<string, BlockerPayloadSchema> = {
    // the audited 19 (delivered order)
    'EQUIPMENT-IDENTITY-CONFLICT': 'generic',
    'FRAMING-AUTHORITY-UNVERIFIED': 'generic',
    'PENDING-RACKING-ASSEMBLY-SELECTION': 'generic',
    'FASTENER-ASSEMBLY-UNVERIFIED': 'generic',
    'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED': 'generic',
    'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED': 'generic',
    'RACKING-CAPACITY-APPLICABILITY-GAP': 'generic',
    'ROUTE-LENGTH-ESTIMATE': 'generic',
    'CONDUIT-FILL-PENDING': 'generic',
    'TAP-CONDUCTOR-LENGTH-PENDING': 'generic',
    'QCABLE-PROCUREMENT-INSUFFICIENT': 'qcable-procurement-deficit',
    'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED': 'qcable-grounding-authority',
    'CODE-AUTHORITY-INCOMPLETE': 'generic',
    'EQUIPMENT-DOCUMENT-APPLICABILITY': 'generic',
    'PROJECT-AUTHORITY-UNVERIFIED': 'generic',
    'PROJECT-NAME-NONPRODUCTION': 'generic',
    'DESIGNER-OF-RECORD-MISSING': 'generic',
    'MODULE-EXACT-DATASHEET-PENDING': 'generic',
    'ENGINEERING-REVIEW-PENDING': 'generic',
    // the remaining emitters
    'FEEDER-RACEWAY-AUTHORITY': 'generic',
    'BRANCH-RACEWAY-AUTHORITY': 'generic',
    'RACEWAY-SEGMENT-CONFLICT': 'generic',
    'FASTENER-CONFIG-MISSING': 'generic',
    'ATTACHMENT-CAPACITY-SOURCE-MISSING': 'generic',
    'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED': 'generic',
    'MOUNT-TOPOLOGY-UNKNOWN': 'generic',
    'DIRECT-MOUNT-GEOMETRY-MISSING': 'generic',
    'REACTIONS-UNTRACEABLE': 'generic',
    'RAIL-QUANTITY-UNTRACEABLE': 'generic',
    'STRUCTURAL-UTILIZATION-EXCEEDED': 'generic',
    'STRUCTURAL-BOM-RECONCILIATION-FAILED': 'generic',
    'STRUCTURAL-REACTION-RECONCILIATION-FAILED': 'generic',
    'SITE-GEOMETRY-MISSING': 'generic',
    'MODULE-DIMENSIONS-UNVERIFIED': 'generic',
    'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED': 'generic',
    'EQUIPMENT-DOCUMENT-UNVERIFIED': 'generic',
  };

  it('EVERY registry code maps to its correct payload schema', () => {
    for (const [code, schema] of Object.entries(EXPECTED)) {
      expect(blockerPayloadSchema(code), code).toBe(schema);
    }
  });

  it('the schema table declares every code the enumeration knows (no silent omission)', () => {
    for (const code of Object.keys(EXPECTED)) {
      expect(Object.prototype.hasOwnProperty.call(BLOCKER_PAYLOAD_SCHEMA, code), `${code} missing from BLOCKER_PAYLOAD_SCHEMA`).toBe(true);
    }
  });

  it('an UNKNOWN code fails safe to generic — it can never inherit another template', () => {
    expect(blockerPayloadSchema('SOME-FUTURE-BLOCKER')).toBe('generic');
    const r = {
      code: 'SOME-FUTURE-BLOCKER', payload: { someField: 'x', nested: { a: 1 } },
    } as unknown as PermitReadinessBlocker;
    const html = renderBlockerPayload(r);
    expect(html).toContain('BLOCKER PAYLOAD:');
    expect(html).not.toContain('DEFICIT PAYLOAD');
    expect(html).not.toContain('GROUNDING AUTHORITY PAYLOAD');
    // no foreign empty fields
    expect(html).not.toMatch(/SKU —/);
    expect(html).not.toMatch(/deficit —/);
  });

  it('the GROUNDING blocker renders the grounding payload with Ray’s full field list', () => {
    const rs1 = renderReviewStatusSheets(PKG.input, PKG.cad);
    expect(rs1).toContain('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED');
    expect(rs1).toContain('GROUNDING AUTHORITY PAYLOAD:');
    for (const field of [
      'selected micro', 'cable assembly', 'authority result', 'verification',
      'manufacturer document', 'SHA-256', 'applicability', 'equipment classification',
      'candidate EGC', 'affected segments', 'module/racking bonding', 'resolution',
    ]) expect(rs1, `grounding payload missing "${field}"`).toContain(field);
    expect(rs1).toContain('PENDING_MANUFACTURER_AUTHORITY');
    expect(rs1).toContain('NON-ORDERABLE');
  });

  it('the frozen fixture’s RS-1 shows NO deficit template (the §2 defect is gone)', () => {
    const rs1 = renderReviewStatusSheets(PKG.input, PKG.cad);
    const codes = (PKG.snap.permitReadiness.registry ?? []).map(r => r.code);
    expect(codes).not.toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
    // …therefore no DEFICIT PAYLOAD box may exist anywhere on the sheet
    expect(rs1).not.toContain('DEFICIT PAYLOAD');
    // and the hardcoded literal that read no field at all is gone
    expect(rs1).not.toContain('mfr-doc authority null');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7 — canonical GroundingSegment objects replace the legacy PV-4B EGC row
// ═══════════════════════════════════════════════════════════════════════════
describe('§7 — the legacy project-level EGC row is gone; grounding rows are canonical objects', () => {
  it('the projected graph gives every object an id, its OWN raceway and its OWN length', () => {
    const segs = projectGroundingSegments(PKG.snap);
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.groundingSegmentId, 'grounding segment without an id').toBeTruthy();
      expect(s.necBasis).toBeTruthy();
      expect(['verified', 'pending-manufacturer-authority', 'nec-derived', 'not-required'])
        .toContain(s.authorityState);
    }
    // the open-air branch object: FREE AIR, no borrowed conduit, no asserted
    // conductor and NO size while the authority is pending
    const oa = segs.find(s => s.purpose === 'branch-egc');
    expect(oa).toBeDefined();
    expect(oa!.physicalRacewayId).toBeNull();
    expect(oa!.racewayLabel).toMatch(/FREE AIR/);
    expect(oa!.authorityState).toBe('pending-manufacturer-authority');
    expect(oa!.installedConductorAsserted).toBe(false);
    expect(oa!.conductorSize).toBeNull();
    expect(oa!.lengthFt).toBeNull();
    expect(oa!.lengthSource).toBe('not-established');
    expect(oa!.bomRowState).toBe('design-quantity-non-orderable');
  });

  it('PV-4B no longer renders the stale Array → AC Disconnect (ground bus) EGC row', () => {
    const pv4b = pageConductorSchedule(PKG.input, PKG.cad, 7, 21);
    expect(pv4b).not.toContain('AC Disconnect (ground bus)');
    // the tell of the retired row: the FEEDER's own conduit + length reprinted as
    // a grounding run. A grounding row may not print an in-conduit raceway that
    // belongs to the feeder segment while claiming to run from the Array.
    expect(pv4b).toContain('GroundingSegment');
  });

  it('gate 10 — EVERY rendered grounding row carries a groundingSegmentId', () => {
    const pv4b = pageConductorSchedule(PKG.input, PKG.cad, 7, 21);
    const segs = projectGroundingSegments(PKG.snap);
    const tagged = pv4b.match(/data-grounding-segment-id="[^"]+"/g) ?? [];
    expect(tagged.length).toBeGreaterThanOrEqual(segs.length);
    for (const s of segs) expect(pv4b).toContain(`data-grounding-segment-id="${s.groundingSegmentId}"`);
    // no grounding row may be tagged with an EMPTY id
    expect(pv4b).not.toContain('data-grounding-segment-id=""');
  });

  it('every segment reconciles to a BOM line or explicitly orders nothing', () => {
    for (const s of projectGroundingSegments(PKG.snap)) {
      if (s.bomRowState === 'no-row') expect(s.bomLineId).toBeNull();
      else expect(s.bomLineId != null || s.method === 'raceway' || s.method === 'conductor').toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8 — a PENDING quantity may never render as a certain zero (gate 11)
// ═══════════════════════════════════════════════════════════════════════════
describe('§8 — sealing-cap quantity is PENDING, not a certain zero', () => {
  it('the cap row carries quantityState pending + its label', () => {
    const caps = (PKG.input.bom as PermitBOMItem[]).filter(i => i.category === 'sealing_cap');
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.quantityState).toBe('pending');
      expect(c.quantityStateLabel).toMatch(/MODELED \/ FIELD QUANTITY PENDING/);
      expect(c.description).toMatch(/QUANTITY PENDING/);
    }
  });

  it('the rendered quantity cell prints the pending label, never a bare number', () => {
    const sched = pageEquipmentSchedule(PKG.input, PKG.cad, 18, 21)
      + pageEquipmentScheduleCont(PKG.input, PKG.cad, 19, 21, 0)
      + pageEquipmentScheduleCont(PKG.input, PKG.cad, 20, 21, 1);
    expect(sched).toContain('MODELED / FIELD QUANTITY PENDING');
    expect(sched).toContain('data-bom-quantity-state="pending"');
    // the cap row's quantity cell is not a plain <td class="tr fw7">0</td>
    expect(sched).not.toMatch(/data-bom-quantity-state="established"[^>]*>\s*0\s*<\/td>/);
  });

  it('terminators stay a SEPARATE established type (caps and ends are not merged)', () => {
    const bom = PKG.input.bom as PermitBOMItem[];
    const terms = bom.filter(i => i.category === 'terminator');
    expect(terms.length).toBeGreaterThan(0);
    for (const t of terms) expect(t.quantityState).not.toBe('pending');
  });

  it('a pending-quantity row is EXCLUDED from procurement approval', () => {
    const caps = (PKG.input.bom as PermitBOMItem[]).filter(i => i.category === 'sealing_cap');
    for (const c of caps) expect(isOrderableForProcurement(c)).toBe(false);
    const approval = buildProcurementApproval(PKG.input.bom as PermitBOMItem[]);
    expect(approval.excludedCountByClass['quantity-pending']).toBeGreaterThan(0);
    expect(orderableProcurementExport(PKG.input.bom as PermitBOMItem[]).some(i => i.category === 'sealing_cap')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 propagation (WS-1's half) — calcRackingBOM's flags survive the type boundary
// ═══════════════════════════════════════════════════════════════════════════
describe('§5 propagation — pending racking rows arrive NON-ORDERABLE in the permit BOM', () => {
  it('every PENDING RACKING ASSEMBLY SELECTION row is tagged non-orderable with its reason', () => {
    const pend = (PKG.input.bom as PermitBOMItem[])
      .filter(i => /PENDING RACKING ASSEMBLY SELECTION/i.test(i.model ?? '') || /PENDING RACKING ASSEMBLY SELECTION/i.test(i.description ?? ''));
    expect(pend.length).toBeGreaterThan(0);
    for (const p of pend) {
      expect(p.nonOrderable, `${p.category} not tagged`).toBe(true);
      expect(p.nonOrderableReason).toMatch(/PENDING-RACKING-ASSEMBLY-SELECTION/);
      // a pending assembly has no selected manufacturer to name
      expect(p.manufacturer).toBe('—');
      expect(isOrderableForProcurement(p)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9 — PROCUREMENT-INSUFFICIENT INPUT (non-vacuous §2 deficit + §9 + gates 7/12/13)
// ═══════════════════════════════════════════════════════════════════════════
const ASM = (): ListedCableAssembly => ({
  assemblyId: 'QCABLE-ASSEMBLY', manufacturer: 'Enphase', ecosystem: 'IQ Q-Cable',
  model: 'Q-12-10-240', sku: 'Q-12-10-240', skuNote: null,
  conductorConstruction: 'two-wire', conductorCount: 2, conductorGauge: '#12 AWG',
  insulationListing: 'TC-ER', wiringMethodLabel: 'ENPHASE Q CABLE (TC-ER)',
  connectorSpacingFt: 4.25, maxBranchCurrentA: 20, compatibleMicroModels: ['IQ8A'],
  cableLengthFt: 152, dropCount: 31, unusedDropCapSku: null, terminatorSku: null,
  sourceDocument: null, verificationStatus: 'catalog-sourced', provenance: { source: 'test' },
});
const PATH = (id: string, label: string, drops: number, designed: number, proc: number): BranchCablePath => ({
  branchId: id, branchLabel: label, moduleCount: drops, dropCount: drops,
  designedInstalledLengthFt: designed, connectorSpacingFt: 4.25, procurementLengthFt: proc,
  wasteFactor: 1.15, lengthProvenance: 'geometry-derived', derivation: 'test',
  provenance: { source: 'test' },
});

/** THE procurement-insufficient TEST INPUT (audit §0: the frozen fixture does NOT
 *  trip this blocker, so without it §2's deficit component and all of §9 would
 *  pass vacuously). The frozen fixture itself is never modified — the snapshot is
 *  CLONED, the deficit + blocker injected, and the BOM regenerated against it. */
function insufficientInput() {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-26T12:00:00Z';
  generatePermitHTML(input);
  const cad = generateCADLayout(input);
  const snap: any = clone(input._snapshot);
  // live-shaped geometry: designed 166.5 ft vs procurement 152 ft ⇒ 14.5 ft short
  const ps = buildProcurementSufficiency({
    assembly: ASM(),
    branchPaths: [PATH('br-1', 'B1', 13, 64.0, 64), PATH('br-2', 'B2', 13, 63.2, 63), PATH('br-3', 'B3', 5, 39.3, 25)],
    selectedSystem: 'Enphase IQ8A',
  })!;
  snap.electrical.procurementSufficiency = ps;
  const blocker: PermitReadinessBlocker = {
    code: 'QCABLE-PROCUREMENT-INSUFFICIENT', severity: 'blocking', justification: '',
    domain: 'electrical', authorityPath: 'electrical.procurementSufficiency',
    affectedSheets: ['PV-4B', 'SCHED', 'E-1', 'RS-1'],
    explanation: `Q-Cable procurement ${ps.procurementLengthFt} ft is SHORT of the ${ps.totalDesignedInstalledFt} ft designed-installed path by ${ps.deficitFt} ft.`,
    resolutionAction: 'Select a VERIFIED listed cable-extension product.',
    payload: procurementInsufficiencyPayload(ps),
    provenance: { source: 'electrical.procurementSufficiency', ref: ps.assemblyId },
    createdAtIso: '2026-07-26T12:00:00Z', createdVersion: 'test', resolved: false,
    resolutionAuditRef: null,
  };
  snap.permitReadiness.registry = [...(snap.permitReadiness.registry ?? []), blocker];
  snap.permitReadiness.blockers = [...(snap.permitReadiness.blockers ?? []), { code: blocker.code, message: blocker.explanation }];
  snap.permitReadiness.ready = false;
  input._snapshot = snap;
  // regenerate the BOM against the INSUFFICIENT snapshot so the §9 post-pass runs
  input.bom = generateBOMForPermit(input, cad);
  return { input, cad, ps, blocker };
}

describe('§9 — the insufficient Q-Cable BOM row is itself NON-ORDERABLE', () => {
  const { input, cad, ps } = insufficientInput();
  const trunk = (input.bom as PermitBOMItem[]).filter(i => i.category === 'trunk_cable');

  it('the row carries STATUS / REASON / DESIGNED-INSTALLED / BASE / DEFICIT / EXTENSION NOT SELECTED', () => {
    expect(trunk.length).toBeGreaterThan(0);
    for (const t of trunk) {
      expect(t.nonOrderable).toBe(true);
      expect(t.nonOrderableReason).toContain('STATUS: NON-ORDERABLE');
      expect(t.nonOrderableReason).toContain('REASON: QCABLE-PROCUREMENT-INSUFFICIENT');
      expect(t.nonOrderableReason).toContain(`DESIGNED-INSTALLED ${ps.totalDesignedInstalledFt} FT`);
      expect(t.nonOrderableReason).toContain(`CURRENT BASE ${ps.procurementLengthFt} FT`);
      expect(t.nonOrderableReason).toContain(`DEFICIT ${ps.deficitFt} FT`);
      expect(t.nonOrderableReason).toContain('EXTENSION SOLUTION NOT SELECTED');
    }
  });

  it('the SELECTED CABLE IDENTITY is kept (the quantity is insufficient, not the cable)', () => {
    for (const t of trunk) {
      expect(t.partNumber).toBe('Q-12-10-240');
      expect(t.manufacturer).toBe('Enphase');
    }
  });

  it('the SCHED row renders its own status and is machine-tagged non-orderable', () => {
    const sched = pageEquipmentSchedule(input, cad, 18, 21)
      + pageEquipmentScheduleCont(input, cad, 19, 21, 0)
      + pageEquipmentScheduleCont(input, cad, 20, 21, 1);
    expect(sched).toContain('Q-12-10-240');
    expect(sched).toContain('STATUS: NON-ORDERABLE');
    expect(sched).toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
    expect(sched).toContain(`DEFICIT ${ps.deficitFt} FT`);
    expect(sched).toContain('EXTENSION SOLUTION NOT SELECTED');
    expect(sched).toContain('data-bom-orderable="false"');
  });

  it('§2 non-vacuous — the DEFICIT component now renders, on the RIGHT blocker only', () => {
    const rs1 = renderReviewStatusSheets(input, cad);
    expect(rs1).toContain('DEFICIT PAYLOAD:');
    expect(rs1).toContain(`deficit ${ps.deficitFt} ft`);
    expect(rs1).toContain('Q-12-10-240');
    // the grounding blocker on the SAME sheet still renders ITS OWN component
    expect(rs1).toContain('GROUNDING AUTHORITY PAYLOAD:');
    // exactly one deficit box (it belongs to exactly one blocker)
    expect((rs1.match(/DEFICIT PAYLOAD:/g) ?? []).length).toBe(1);
    expect((rs1.match(/GROUNDING AUTHORITY PAYLOAD:/g) ?? []).length).toBe(1);
    // and the deficit template never appears on the grounding blocker's row
    const groundingRowIdx = rs1.indexOf('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED');
    const groundingRow = rs1.slice(groundingRowIdx, rs1.indexOf('</tr>', groundingRowIdx));
    expect(groundingRow).not.toContain('DEFICIT PAYLOAD');
  });

  // ── gates 7 / 12 / 13 — the AUTHORITATIVE PROCUREMENT TOTAL ────────────────
  it('gate 7/12 — the authoritative total counts ONLY orderable rows', () => {
    const items = input.bom as PermitBOMItem[];
    const a = buildProcurementApproval(items);
    expect(a.totalLineItems).toBe(items.length);
    expect(a.orderableLineItems).toBeLessThan(a.totalLineItems);
    expect(a.orderableLineItems + a.excludedLineItems).toBe(a.totalLineItems);
    expect(a.partial).toBe(true);
    // the insufficient trunk cable, the pending caps, the pending racking rows and
    // the design-quantity rows are ALL excluded — the retired prose named only two
    const excludedCats = a.exclusions.map(e => e.category);
    expect(excludedCats).toContain('trunk_cable');
    expect(excludedCats).toContain('sealing_cap');
    expect(excludedCats.some(c => ['rail', 'splice', 'mid_clamp', 'end_clamp', 'l_foot', 'mount_hardware', 'grounding'].includes(c))).toBe(true);
    // every exclusion states a reason
    for (const e of a.exclusions) expect(e.reason.length).toBeGreaterThan(10);
  });

  it('gate 13 — a blocked row can never enter an orderable export', () => {
    const items = input.bom as PermitBOMItem[];
    const exported = orderableProcurementExport(items);
    expect(exported.length).toBeGreaterThan(0);
    for (const row of exported) {
      expect(row.nonOrderable).not.toBe(true);
      expect(row.quantityState).not.toBe('pending');
    }
    const blocked = items.filter(i => !isOrderableForProcurement(i));
    expect(blocked.length).toBeGreaterThan(0);
    for (const b of blocked) expect(exported).not.toContain(b);
  });

  // ECD §10 (2026-07-26) — the per-row EXCLUSION ENUMERATION this test used to
  // demand is retired, and the assertion is STRENGTHENED rather than weakened.
  // Why: the fail-closed state model classifies ~38 of 48 rows non-orderable
  // (22 of them route-estimated), and enumerating every one inline clipped the
  // sheet — while duplicating what each row now says in its OWN cell. The
  // replacement proves MORE: every excluded row is individually identified on
  // the sheet by its STABLE ROW ID and its ONE authority state (machine-
  // readable), the summary counts are state-derived, and no row disappears.
  it('the rendered schedule states every row\'s state, the derived counts, and no procurement-ready claim', () => {
    const sched = pageEquipmentSchedule(input, cad, 18, 24)
      + pageEquipmentScheduleCont(input, cad, 19, 24, 0)
      + pageEquipmentScheduleCont(input, cad, 20, 24, 1)
      + pageEquipmentScheduleCont(input, cad, 21, 24, 2);
    const a = buildProcurementApproval(input.bom as PermitBOMItem[]);
    expect(sched).toContain('AUTHORITATIVE PROCUREMENT EXPORT');
    expect(sched).toContain(`data-procurement-total="${a.verifiedOrderableCount}"`);
    expect(sched).toContain(`data-procurement-excluded="${a.excludedLineItems}"`);
    expect(sched).toContain(`data-bom-population-total="${a.totalRowCount}"`);
    expect(sched).toContain('data-procurement-ready="false"');
    // the five state counts render, all derived from the same approval object
    expect(sched).toContain(`data-procurement-state-count="VERIFIED_ORDERABLE">${a.verifiedOrderableCount} `);
    expect(sched).toContain(`data-procurement-state-count="ESTIMATED_FIELD_VERIFY">${a.estimatedFieldVerifyCount} `);
    expect(sched).toContain(`data-procurement-state-count="CANDIDATE_NON_ORDERABLE">${a.candidateNonOrderableCount} `);
    expect(sched).toContain(`data-procurement-state-count="QUANTITY_PENDING">${a.quantityPendingCount} `);
    // EVERY row in the population — including the module row the table does not
    // list — appears with its stable id and its state; nothing disappears.
    for (const it of input.bom as PermitBOMItem[]) {
      expect(sched, `row ${it.partNumber} id missing from the sheet`)
        .toContain(`data-bom-line-id="${it.bomLineId}"`);
    }
    for (const e of a.exclusions) {
      expect(sched, `exclusion ${e.category} has no rendered state`)
        .toContain(`data-bom-authority-state="${e.authorityState}"`);
    }
    expect(sched).toContain('PROCUREMENT READY: NO.');
    expect(sched).toContain('NOT an approved procurement release');
    // the three retired claims must be GONE
    expect(sched).not.toContain('no manual estimates');
    expect(sched).not.toContain('items are required per NEC / manufacturer specification');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A second topology (roofProject) — the fixes are in the PROJECTION, so they
// inherit; no sheet-local special case.
// ═══════════════════════════════════════════════════════════════════════════
describe('inheritance — a second design gets the same honest projections', () => {
  it('roofProject: pending grounding ⇒ non-assertion cell + zero rendered assertions', () => {
    const input: any = clone(roofProject);
    input.project = input.project ?? {};
    input.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
    const html = generatePermitHTML(input);
    const snap: PermitDesignSnapshot = input._snapshot;
    const g = projectOpenAirBranchGrounding(snap);
    if (!g.present) return;               // non-micro design — nothing to assert
    expect(g.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');
    for (const r of projectE1PhysicalSchedule(snap).filter(s => s.sectionId === 'BRANCH_RUN')) {
      expect(r.bonding).toBe(GROUNDING_PENDING_BONDING_CELL_LABEL);
    }
    const viol = installedOpenAirEgcAssertions(html);
    expect(viol, `package installed-EGC assertions: ${JSON.stringify(viol, null, 1)}`).toEqual([]);
  });
});
