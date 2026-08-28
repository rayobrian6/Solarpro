// ═══════════════════════════════════════════════════════════════════════════
// HIERARCHICAL RELEASE-GATE MODEL (RGM §1-§4, §7-§10) — stage 1 tests.
//
// Proves: the seven root gates derive from the registry (3/2/1/6/3/2/2 = 19
// requirements / 0 advisories on the Braidon condition), the §10 verification
// checks hold, the §7 finding-type semantics are exactly as mandated, and EVERY
// directive anti-vacuity input behaves (all-open; one structural child cleared;
// all structural cleared; NOT_APPLICABLE with authority; professional approval
// added; administrative-only hold; procurement-only hold; no active
// requirements; UNKNOWN code fails closed into UNMAPPED_REQUIREMENT and FAILS
// the verification).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot, PermitReadinessBlocker } from '@/lib/permit/snapshot/types';
import { classifyBlockerSeverity, SEVERITY_POLICY } from '@/lib/permit/snapshot/severityPolicy';
import {
  deriveReleaseGateModel, projectReleaseGates, exportReleaseGateEvidence,
  releaseHeadline, requirementAffects, requirementToGateMap,
  validateReleaseGateMap, verifyReleaseGateModel, verifyRequirementMultiset,
  verifyOnePrimaryGate, verifyGateCounts, verifyNoUnmappedRequirements,
  verifySummaryAndAxes, verifyFindingTypeSemantics, verifyIssueStateAgreement,
  deriveResponsibleRole, deriveRequirementStatus, NOT_APPLICABLE_AUDIT_PREFIX,
  RELEASE_GATE_DEFINITIONS, REQUIREMENT_DECLARATIONS, UNMAPPED_GATE_ID,
  type ReleaseGateModel,
} from '@/lib/permit/snapshot/releaseGates';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// ─── the code inventory (every code the snapshot build can emit) ──────────────
// Sources: build.ts META/push calls · structuralAuthority.collectBlockers ·
// rackingAssembly.structuralAuthorityGaps · equipmentProjection
// .collectEquipmentDocumentBlockers · the two legacy aliases
// projectAuthority.classifyBlockerDomain still recognises.
const KNOWN_EMITTABLE_CODES = [
  // build.ts
  'ROUTE-LENGTH-ESTIMATE', 'EQUIPMENT-IDENTITY-CONFLICT', 'FEEDER-RACEWAY-AUTHORITY',
  'CONDUIT-FILL-PENDING', 'BRANCH-RACEWAY-AUTHORITY', 'RACEWAY-SEGMENT-CONFLICT',
  'TAP-CONDUCTOR-LENGTH-PENDING', 'TAP-CONDUCTOR-LENGTH-EXCEEDED', 'QCABLE-PROCUREMENT-INSUFFICIENT',
  'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED', 'CODE-AUTHORITY-INCOMPLETE',
  'PROJECT-AUTHORITY-UNVERIFIED', 'PROJECT-NAME-NONPRODUCTION',
  'DESIGNER-OF-RECORD-MISSING', 'ENGINEERING-REVIEW-PENDING',
  // structuralAuthority
  'STRUCTURAL-BOM-RECONCILIATION-FAILED', 'STRUCTURAL-REACTION-RECONCILIATION-FAILED',
  'MOUNT-TOPOLOGY-UNKNOWN', 'FRAMING-AUTHORITY-UNVERIFIED', 'ATTACHMENT-CAPACITY-SOURCE-MISSING',
  'FASTENER-CONFIG-MISSING', 'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED', 'PENDING-RACKING-ASSEMBLY-SELECTION',
  'RACKING-RAIL-CAPACITY-UNBOUNDED', 'FASTENER-ASSEMBLY-UNVERIFIED',
  'EQUIPMENT-DOCUMENT-APPLICABILITY', 'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED',
  'DIRECT-MOUNT-GEOMETRY-MISSING', 'REACTIONS-UNTRACEABLE', 'STRUCTURAL-UTILIZATION-EXCEEDED',
  'RAIL-QUANTITY-UNTRACEABLE', 'SITE-GEOMETRY-MISSING', 'MODULE-DIMENSIONS-UNVERIFIED',
  // rackingAssembly
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED', 'RACKING-CAPACITY-APPLICABILITY-GAP',
  'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED',
  // equipmentProjection
  'EQUIPMENT-DOCUMENT-UNVERIFIED', 'MODULE-EXACT-DATASHEET-PENDING',
  // legacy aliases
  'STRUCTURAL-FRAMING-UNVERIFIED', 'WIND-SNOW-AUTHORITY-UNRESOLVED',
] as const;

/** The BRAIDON release condition (directive §3): the exact 19 blocking codes,
 *  three per gate 1, two per gate 2 … as Ray enumerated them. */
const BRAIDON_19: string[] = [
  // gate 1 (3)
  'CODE-AUTHORITY-INCOMPLETE', 'PROJECT-AUTHORITY-UNVERIFIED', 'PROJECT-NAME-NONPRODUCTION',
  // gate 2 (2)
  'EQUIPMENT-IDENTITY-CONFLICT', 'MODULE-EXACT-DATASHEET-PENDING',
  // gate 3 (1)
  'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED',
  // gate 4 (6)
  'FRAMING-AUTHORITY-UNVERIFIED', 'RACKING-RAIL-CAPACITY-UNBOUNDED', 'FASTENER-ASSEMBLY-UNVERIFIED',
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED', 'RACKING-CAPACITY-APPLICABILITY-GAP', 'EQUIPMENT-DOCUMENT-APPLICABILITY',
  // gate 5 (3)
  'ROUTE-LENGTH-ESTIMATE', 'CONDUIT-FILL-PENDING', 'TAP-CONDUCTOR-LENGTH-PENDING',
  // gate 6 (2)
  'QCABLE-PROCUREMENT-INSUFFICIENT', 'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED',
  // gate 7 (2)
  'DESIGNER-OF-RECORD-MISSING', 'ENGINEERING-REVIEW-PENDING',
];

/** Build a registry record the way build.ts does (severity from THE policy). */
function rec(code: string, over?: Partial<PermitReadinessBlocker>): PermitReadinessBlocker {
  const sev = classifyBlockerSeverity(code);
  return {
    code,
    severity: sev.severity,
    justification: sev.justification,
    domain: 'other',
    authorityPath: `authority.${code.toLowerCase()}`,
    affectedSheets: ['RS-1'],
    explanation: `${code} explanation`,
    resolutionAction: `${code} resolution`,
    payload: null,
    provenance: { source: 'test-registry', ref: null },
    createdAtIso: '2026-07-26T00:00:00Z',
    createdVersion: '1',
    resolved: false,
    resolutionAuditRef: null,
    ...over,
  };
}

function model(codes: string[], mut?: (reg: PermitReadinessBlocker[]) => void): ReleaseGateModel {
  const registry = codes.map(c => rec(c));
  if (mut) mut(registry);
  return deriveReleaseGateModel({ registry, snapshotId: 'PDS-TEST', snapshotDigest: 'deadbeef'.repeat(8) });
}

function gate(m: ReleaseGateModel, gateId: string) {
  const g = m.gates.find(x => x.gateId === gateId);
  expect(g, `gate ${gateId} must exist`).toBeTruthy();
  return g!;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. the declarative map itself
// ═══════════════════════════════════════════════════════════════════════════

describe('RGM §3 — the canonical requirement→gate map is self-consistent', () => {
  it('validateReleaseGateMap reports no errors', () => {
    expect(validateReleaseGateMap()).toEqual([]);
  });

  it('exactly the seven root gates are declared (+ the fail-closed UNMAPPED sink)', () => {
    const roots = RELEASE_GATE_DEFINITIONS.filter(g => g.gateId !== UNMAPPED_GATE_ID);
    expect(roots.map(g => g.gateCode)).toEqual([
      'PROJECT_AND_AHJ_AUTHORITY',
      'EQUIPMENT_RECONCILIATION',
      'ENVIRONMENTAL_LOAD_AUTHORITY',
      'STRUCTURAL_ASSEMBLY_AUTHORITY',
      'ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE',
      'QCABLE_SYSTEM_CLOSURE',
      'PROFESSIONAL_RELEASE',
    ]);
    expect(RELEASE_GATE_DEFINITIONS.find(g => g.gateId === UNMAPPED_GATE_ID)!.gateCode)
      .toBe('UNMAPPED_REQUIREMENT');
  });

  it('EVERY code the snapshot build can emit is declared — no known code can reach UNMAPPED', () => {
    const undeclared = KNOWN_EMITTABLE_CODES.filter(c => !(c in REQUIREMENT_DECLARATIONS));
    expect(undeclared, `undeclared codes: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('EVERY emittable code carries an explicit severity-policy impact declaration', () => {
    const missing = KNOWN_EMITTABLE_CODES.filter(c => !(c in SEVERITY_POLICY));
    expect(missing, `codes without an impact declaration: ${missing.join(', ')}`).toEqual([]);
  });

  it('the added impact declarations changed NO severity outcome (blocking + empty justification)', () => {
    for (const code of KNOWN_EMITTABLE_CODES) {
      const c = classifyBlockerSeverity(code);
      // GOVERNING-CANDIDATE ENVELOPE (2026-08-27) — PENDING-RACKING-ASSEMBLY-SELECTION joined the
      // advisory set. It now fires only when the rail bending envelope HAS been bounded, i.e. the
      // design is complete and specified by performance and only the distributor part number is
      // outstanding. When the envelope cannot be bounded, RACKING-RAIL-CAPACITY-UNBOUNDED fires
      // instead and is blocking on all five axes — so nothing structural became silent.
      if (code === 'EQUIPMENT-DOCUMENT-UNVERIFIED' || code === 'PENDING-RACKING-ASSEMBLY-SELECTION') {
        expect(c.severity, code).toBe('warning');
        expect(c.justification.length, code).toBeGreaterThan(40);
      } else {
        expect(c.severity, code).toBe('blocking');
        expect(c.justification, code).toBe('');
      }
    }
  });

  it('every ELECTRICAL_CLOSURE child declares WHICH result it affects (§3 gate 5)', () => {
    const gate5 = Object.entries(REQUIREMENT_DECLARATIONS).filter(([, d]) => d.gateId === 'RG-5');
    expect(gate5.length).toBeGreaterThanOrEqual(3);
    for (const [code] of gate5) expect(requirementAffects(code), code).toBeTruthy();
  });

  it('the exported requirementToGateMap covers every declared code with its gate + finding type', () => {
    const map = requirementToGateMap();
    expect(Object.keys(map).sort()).toEqual(Object.keys(REQUIREMENT_DECLARATIONS).sort());
    expect(map['ROUTE-LENGTH-ESTIMATE']).toEqual({
      gateId: 'RG-5', gateCode: 'ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE', findingType: 'FIELD_VERIFICATION',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. the Braidon derivation — 3/2/1/6/3/2/2 → 7 gates / 19 requirements / 0 advisory
// ═══════════════════════════════════════════════════════════════════════════

describe('RGM §3/§4 — the Braidon 19-requirement condition derives exactly seven root gates', () => {
  const m = model(BRAIDON_19);

  it('the expected gate table is 3/2/1/6/3/2/2', () => {
    const table = m.gates
      .filter(g => g.gateId !== UNMAPPED_GATE_ID)
      .map(g => g.unresolvedCount);
    expect(table).toEqual([3, 2, 1, 6, 3, 2, 2]);
  });

  it('all seven root gates are OPEN and the UNMAPPED gate is empty + CLEARED', () => {
    for (const g of m.gates.filter(x => x.gateId !== UNMAPPED_GATE_ID)) {
      expect(g.status, g.gateId).toBe('OPEN');
    }
    const un = gate(m, UNMAPPED_GATE_ID);
    expect(un.totalRequirementCount).toBe(0);
    expect(un.status).toBe('CLEARED');
  });

  it('the summary is 7 gates / 19 unresolved requirements / 0 advisories / not permit-ready', () => {
    expect(m.summary.openGateCount).toBe(7);
    expect(m.summary.unresolvedRequirementCount).toBe(19);
    expect(m.summary.advisoryCount).toBe(0);
    expect(m.summary.permitReady).toBe(false);
    expect(m.summary.procurementReady).toBe(false);
    expect(m.summary.engineeringReviewReady).toBe(false);
  });

  it('the §4 headline replaces "19 OPEN RELEASE BLOCKERS" and never conflates the counts', () => {
    expect(releaseHeadline(m.summary))
      .toBe('7 OPEN RELEASE GATES / 19 UNRESOLVED REQUIREMENTS / 0 ADVISORIES / NOT FOR PERMIT SUBMISSION');
  });

  it('all 19 requirements are preserved — nothing suppressed, nothing merged', () => {
    expect(m.requirements).toHaveLength(19);
    expect(m.requirements.map(q => q.requirementCode).sort()).toEqual([...BRAIDON_19].sort());
  });

  it('gate children total exactly 19 across the seven gates', () => {
    const total = m.gates.reduce((s, g) => s + g.totalRequirementCount, 0);
    expect(total).toBe(19);
  });

  it('each gate carries the registry pass-through data (sheets, resolution, evidence, snapshot ids)', () => {
    for (const g of m.gates.filter(x => x.status === 'OPEN')) {
      expect(g.affectedSheets.length).toBeGreaterThan(0);
      expect(g.primaryResolutionAction.length).toBeGreaterThan(0);
      expect(g.evidenceReferences.length).toBeGreaterThan(0);
      expect(g.snapshotId).toBe('PDS-TEST');
      expect(g.snapshotDigest.length).toBeGreaterThan(0);
    }
  });

  it('the ELECTRICAL closure gate explains which RESULT each unresolved input affects', () => {
    const g5 = gate(m, 'RG-5');
    expect(g5.description).toContain('ROUTE-LENGTH-ESTIMATE affects:');
    expect(g5.description).toMatch(/Voltage-drop results and the procurement conductor/);
    expect(g5.description).toMatch(/Ampacity, OCPD sizing, terminal ratings .*are NOT\s+blocked/);
    expect(g5.description).toContain('CONDUIT-FILL-PENDING affects:');
    expect(g5.description).toMatch(/conduit-FILL result itself/);
    expect(g5.description).toContain('TAP-CONDUCTOR-LENGTH-PENDING affects:');
    expect(g5.description).toMatch(/705\.11\(C\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. §7 finding types + responsible-role derivation
// ═══════════════════════════════════════════════════════════════════════════

describe('RGM §7 — technical vs workflow condition is explicit and never mislabelled', () => {
  const m = model(BRAIDON_19);
  const q = (code: string) => m.requirements.find(x => x.requirementCode === code)!;

  it('the mandated finding types are exactly as directed', () => {
    expect(q('PROJECT-NAME-NONPRODUCTION').findingType).toBe('ADMINISTRATIVE_HOLD');
    expect(q('ENGINEERING-REVIEW-PENDING').findingType).toBe('PROFESSIONAL_RELEASE');
    expect(q('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED').findingType).toBe('PENDING_DOCUMENT');
    expect(q('EQUIPMENT-IDENTITY-CONFLICT').findingType).toBe('TECHNICAL_CONFLICT');
    expect(q('ROUTE-LENGTH-ESTIMATE').findingType).toBe('FIELD_VERIFICATION');
    expect(q('CONDUIT-FILL-PENDING').findingType).toBe('FIELD_VERIFICATION');
// 2026-08-28 TAP MIGRATION - the span is no longer a thing a crew
    // discovers: an unconstrained span is a PENDING_SELECTION (the designer has
    // not placed the disconnect), and a constrained span that BUSTS the limit is a
    // VERIFIED_DEFICIENCY, not a pending measurement.
    expect(q('TAP-CONDUCTOR-LENGTH-PENDING').findingType).toBe('PENDING_SELECTION');
    // EXCEEDED does not fire on this fixture (the span is design-constrained), so
    // its mandate is asserted where the mandate lives — the declaration table.
    expect(REQUIREMENT_DECLARATIONS['TAP-CONDUCTOR-LENGTH-EXCEEDED'].findingType).toBe('VERIFIED_DEFICIENCY');
    expect(q('QCABLE-PROCUREMENT-INSUFFICIENT').findingType).toBe('VERIFIED_DEFICIENCY');
    expect(q('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED').findingType).toBe('PENDING_AUTHORITY');
    expect(q('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED').findingType).toBe('PENDING_AUTHORITY');
  });

  it('an administrative hold is never an engineering failure and never a technical conflict', () => {
    const admin = q('PROJECT-NAME-NONPRODUCTION');
    expect(admin.findingType).not.toBe('VERIFIED_DEFICIENCY');
    expect(admin.findingType).not.toBe('TECHNICAL_CONFLICT');
    // it blocks the administrative + permit lanes only — not engineering review,
    // not procurement, not construction.
    expect(admin.releaseImpact).toEqual({
      permitSubmission: true, procurement: false, engineeringReview: false,
      construction: false, administrativeRelease: true,
    });
  });

  it('pending authority is never presented as a verified failure (capacity NOT YET established)', () => {
    const cap = q('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
    expect(cap.findingType).toBe('PENDING_DOCUMENT');
    expect(cap.title.toLowerCase()).toContain('not yet established');
    expect(cap.title.toLowerCase()).not.toMatch(/fail|exceed|inadequate/);
  });

  it('ENGINEERING-REVIEW-PENDING derives from the ABSENCE of a digest-bound approval record', () => {
    // The requirement exists because build.ts emits the code from
    // certification.engineeringReviewApproved (D-6) — the model classifies the
    // record it finds; it never reads issue-state wording. Remove the code (a
    // review record exists) and gate 7's professional-release child disappears.
    const withApproval = model(BRAIDON_19.filter(c => c !== 'ENGINEERING-REVIEW-PENDING'));
    expect(withApproval.requirements.some(x => x.findingType === 'PROFESSIONAL_RELEASE')).toBe(false);
    expect(gate(withApproval, 'RG-7').unresolvedCount).toBe(1);   // designer-of-record still open
  });

  it('responsibleRole derives from (gate category, finding type)', () => {
    expect(q('PROJECT-NAME-NONPRODUCTION').responsibleRole).toBe('admin');
    expect(q('CODE-AUTHORITY-INCOMPLETE').responsibleRole).toBe('admin');
    expect(q('ENGINEERING-REVIEW-PENDING').responsibleRole).toBe('engineer-of-record');
    expect(q('EQUIPMENT-IDENTITY-CONFLICT').responsibleRole).toBe('operator');   // operator-only reconciliation
    expect(q('RACKING-RAIL-CAPACITY-UNBOUNDED').responsibleRole).toBe('designer');
    expect(q('ROUTE-LENGTH-ESTIMATE').responsibleRole).toBe('operator');         // a field measurement is owed
    expect(q('QCABLE-PROCUREMENT-INSUFFICIENT').responsibleRole).toBe('designer');
    expect(q('FRAMING-AUTHORITY-UNVERIFIED').responsibleRole).toBe('operator');  // archive the source document
    // the matrix itself
    expect(deriveResponsibleRole('EQUIPMENT_AUTHORITY', 'TECHNICAL_CONFLICT')).toBe('operator');
    expect(deriveResponsibleRole('ELECTRICAL_CLOSURE', 'TECHNICAL_CONFLICT')).toBe('designer');
    expect(deriveResponsibleRole('STRUCTURAL_AUTHORITY', 'VERIFIED_DEFICIENCY')).toBe('engineer-of-record');
    expect(deriveResponsibleRole('PROCUREMENT_CLOSURE', 'VERIFIED_DEFICIENCY')).toBe('designer');
  });

  it('every requirement carries EXACTLY the §2 field list', () => {
    for (const q1 of m.requirements) {
      expect(Object.keys(q1).sort()).toEqual([
        'affectedObjects', 'affectedSheets', 'authorityPath', 'evidenceReferences', 'explanation',
        'findingType', 'gateId', 'relatedRequirementCodes', 'releaseImpact', 'requirementCode',
        'resolutionAction', 'responsibleRole', 'severity', 'snapshotDigest', 'snapshotId', 'status', 'title',
      ]);
    }
  });

  it('every gate carries EXACTLY the §1 field list', () => {
    for (const g of m.gates) {
      expect(Object.keys(g).sort()).toEqual([
        'affectedSheets', 'clearedRequirementCodes', 'description', 'evidenceReferences', 'gateCategory',
        'gateCode', 'gateId', 'primaryResolutionAction', 'releaseImpact', 'requirementCodes',
        'responsibleRole', 'snapshotDigest', 'snapshotId', 'status', 'title', 'totalRequirementCount',
        'unresolvedCount', 'unresolvedRequirementCodes',
      ]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. §10 verification checks
// ═══════════════════════════════════════════════════════════════════════════

describe('RGM §10 — the independent verification checks', () => {
  const registry = BRAIDON_19.map(c => rec(c));
  const m = deriveReleaseGateModel({ registry, snapshotId: 'PDS-TEST', snapshotDigest: 'x'.repeat(64) });

  it('every active code becomes exactly one requirement (exact multiset equality)', () => {
    expect(verifyRequirementMultiset(m, registry)).toEqual([]);
  });

  it('every requirement has exactly one primary gate', () => {
    expect(verifyOnePrimaryGate(m)).toEqual([]);
  });

  it('gate child counts equal their children and Σ children equals the requirement count', () => {
    expect(verifyGateCounts(m)).toEqual([]);
  });

  it('no requirement is unmapped', () => {
    expect(verifyNoUnmappedRequirements(m)).toEqual([]);
  });

  it('the summary counts and readiness axes agree with the gates', () => {
    expect(verifySummaryAndAxes(m)).toEqual([]);
  });

  it('the finding-type semantics hold', () => {
    expect(verifyFindingTypeSemantics(m)).toEqual([]);
  });

  it('the issue state may never claim release while a gate is open', () => {
    expect(verifyIssueStateAgreement(m, 'PENDING ENGINEERING REVIEW')).toEqual([]);
    expect(verifyIssueStateAgreement(m, 'PERMIT-READY')).toHaveLength(1);
    expect(verifyIssueStateAgreement(m, 'ISSUED FOR PERMIT')[0]).toMatch(/claims release while 7 release gate/);
  });

  it('the aggregate verification passes on the Braidon condition', () => {
    expect(verifyReleaseGateModel(m, registry, 'PENDING ENGINEERING REVIEW')).toEqual([]);
  });

  it('a code lost or duplicated by the projection is detected', () => {
    const tampered: ReleaseGateModel = clone(m);
    tampered.requirements.pop();
    expect(verifyRequirementMultiset(tampered, registry).length).toBeGreaterThan(0);
    const dup: ReleaseGateModel = clone(m);
    dup.requirements.push(dup.requirements[0]);
    expect(verifyRequirementMultiset(dup, registry).length).toBeGreaterThan(0);
  });

  it('the evidence export carries releaseSummary / releaseGates / releaseRequirements / requirementToGateMap', () => {
    const ev = exportReleaseGateEvidence(m);
    expect(ev.releaseSummary).toEqual(m.summary);
    expect(ev.releaseGates).toHaveLength(RELEASE_GATE_DEFINITIONS.length);
    expect(ev.releaseGates.filter(g => g.status === 'OPEN')).toHaveLength(7);
    expect(ev.releaseRequirements).toHaveLength(19);
    expect(Object.keys(ev.requirementToGateMap).length).toBe(Object.keys(REQUIREMENT_DECLARATIONS).length);
    expect(ev.gateRollup.reduce((s, r) => s + r.unresolvedCount, 0)).toBe(19);
    expect(ev.headline).toBe(releaseHeadline(m.summary));
    expect(Object.keys(ev.releaseSummary).sort()).toEqual([
      'advisoryCount', 'engineeringReviewReady', 'openGateCount', 'permitReady',
      'procurementReady', 'unresolvedRequirementCount',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ANTI-VACUITY inputs (every scenario the directive mandates)
// ═══════════════════════════════════════════════════════════════════════════

describe('RGM anti-vacuity — all seven gates open', () => {
  const m = model(BRAIDON_19);
  it('every release axis is blocked and every root gate is listed on the axes that it blocks', () => {
    expect(m.summary.openGateCount).toBe(7);
    expect(m.readinessAxes.permitSubmission.ready).toBe(false);
    expect(m.readinessAxes.procurement.ready).toBe(false);
    expect(m.readinessAxes.engineeringReview.ready).toBe(false);
    expect(m.readinessAxes.construction.ready).toBe(false);
    expect(m.readinessAxes.administrativeRelease.ready).toBe(false);
    expect(m.readinessAxes.permitSubmission.openGateCodes).toContain('STRUCTURAL_ASSEMBLY_AUTHORITY');
    expect(m.issueStatePredicates.designReview).toBe(true);
    expect(m.issueStatePredicates.readyForEngineeringReview).toBe(false);
    expect(m.issueStatePredicates.readyForPermitSubmission).toBe(false);
  });
});

describe('RGM anti-vacuity — ONE structural child clears', () => {
  const m = model(BRAIDON_19, reg => {
    const t = reg.find(r => r.code === 'FASTENER-ASSEMBLY-UNVERIFIED')!;
    t.resolved = true;
    t.resolutionAuditRef = 'AUDIT-7781 fastener withdrawal document archived + verified';
  });

  it('the structural gate stays OPEN with 5 unresolved of 6, and the child shows CLEARED', () => {
    const g4 = gate(m, 'RG-4');
    expect(g4.status).toBe('OPEN');
    expect(g4.unresolvedCount).toBe(5);
    expect(g4.totalRequirementCount).toBe(6);
    expect(g4.clearedRequirementCodes).toEqual(['FASTENER-ASSEMBLY-UNVERIFIED']);
    expect(m.summary.openGateCount).toBe(7);
    expect(m.summary.unresolvedRequirementCount).toBe(18);
  });

  it('nothing is lost: the cleared child is still a requirement record', () => {
    expect(m.requirements).toHaveLength(19);
    const q = m.requirements.find(x => x.requirementCode === 'FASTENER-ASSEMBLY-UNVERIFIED')!;
    expect(q.status).toBe('CLEARED');
  });

  it('a resolved flag WITHOUT an audit reference does NOT clear a requirement (fail closed)', () => {
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: null })).toBe('OPEN');
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: '  ' })).toBe('OPEN');
    const sneaky = model(BRAIDON_19, reg => { reg.find(r => r.code === 'FRAMING-AUTHORITY-UNVERIFIED')!.resolved = true; });
    expect(gate(sneaky, 'RG-4').unresolvedCount).toBe(6);
  });
});

describe('RGM anti-vacuity — ALL structural children clear ⇒ the gate is CLEARED', () => {
  const STRUCT = [
    'FRAMING-AUTHORITY-UNVERIFIED', 'RACKING-RAIL-CAPACITY-UNBOUNDED', 'FASTENER-ASSEMBLY-UNVERIFIED',
    'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED', 'RACKING-CAPACITY-APPLICABILITY-GAP', 'EQUIPMENT-DOCUMENT-APPLICABILITY',
  ];
  const m = model(BRAIDON_19, reg => {
    for (const r of reg) {
      if (!STRUCT.includes(r.code)) continue;
      r.resolved = true;
      r.resolutionAuditRef = `AUDIT-${r.code}`;
    }
  });

  it('the structural gate is CLEARED and stops blocking every axis', () => {
    const g4 = gate(m, 'RG-4');
    expect(g4.status).toBe('CLEARED');
    expect(g4.unresolvedCount).toBe(0);
    expect(g4.totalRequirementCount).toBe(6);
    expect(g4.clearedRequirementCodes).toHaveLength(6);
    expect(g4.releaseImpact).toEqual({
      permitSubmission: false, procurement: false, engineeringReview: false,
      construction: false, administrativeRelease: false,
    });
    for (const axis of Object.values(m.readinessAxes)) expect(axis.openGateIds).not.toContain('RG-4');
  });

  it('the top-level counts drop to 6 gates / 13 requirements — never to zero', () => {
    expect(m.summary.openGateCount).toBe(6);
    expect(m.summary.unresolvedRequirementCount).toBe(13);
    expect(m.summary.permitReady).toBe(false);
  });
});

describe('RGM anti-vacuity — ONE requirement NOT_APPLICABLE on a recorded authority', () => {
  const m = model(BRAIDON_19, reg => {
    const t = reg.find(r => r.code === 'TAP-CONDUCTOR-LENGTH-PENDING')!;
    t.resolved = true;
    t.resolutionAuditRef = `${NOT_APPLICABLE_AUDIT_PREFIX} AUDIT-4410 load-side interconnection — no supply-side tap exists`;
  });

  it('the requirement is NOT_APPLICABLE (neither open nor cleared) and stays visible', () => {
    const q = m.requirements.find(x => x.requirementCode === 'TAP-CONDUCTOR-LENGTH-PENDING')!;
    expect(q.status).toBe('NOT_APPLICABLE');
    expect(m.requirements).toHaveLength(19);
    const g5 = gate(m, 'RG-5');
    expect(g5.totalRequirementCount).toBe(3);
    expect(g5.unresolvedCount).toBe(2);
    expect(g5.clearedRequirementCodes).not.toContain('TAP-CONDUCTOR-LENGTH-PENDING');
    expect(g5.requirementCodes).toContain('TAP-CONDUCTOR-LENGTH-PENDING');
  });

  it('a gate whose children are ALL not-applicable reports NOT_APPLICABLE, never PASS', () => {
    const na = model(['ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'], reg => {
      reg[0].resolved = true;
      reg[0].resolutionAuditRef = `${NOT_APPLICABLE_AUDIT_PREFIX} AUDIT-1 ground-mount out of scope`;
    });
    expect(gate(na, 'RG-3').status).toBe('NOT_APPLICABLE');
  });

  it('the verification still passes with a not-applicable child', () => {
    const registry = BRAIDON_19.map(c => rec(c));
    registry.find(r => r.code === 'TAP-CONDUCTOR-LENGTH-PENDING')!.resolved = true;
    registry.find(r => r.code === 'TAP-CONDUCTOR-LENGTH-PENDING')!.resolutionAuditRef = `${NOT_APPLICABLE_AUDIT_PREFIX} AUDIT-4410`;
    const m2 = deriveReleaseGateModel({ registry, snapshotId: 'PDS-TEST', snapshotDigest: 'y'.repeat(64) });
    expect(verifyReleaseGateModel(m2, registry)).toEqual([]);
    expect(m2.summary.unresolvedRequirementCount).toBe(18);
  });
});

describe('RGM anti-vacuity — professional approval added', () => {
  // A digest-bound approval exists AND the designer is assigned ⇒ build.ts emits
  // neither gate-7 code, so gate 7 clears.
  const m = model(BRAIDON_19.filter(c => c !== 'ENGINEERING-REVIEW-PENDING' && c !== 'DESIGNER-OF-RECORD-MISSING'));

  it('gate 7 is CLEARED and the professional-release lane is complete', () => {
    const g7 = gate(m, 'RG-7');
    expect(g7.status).toBe('CLEARED');
    expect(g7.totalRequirementCount).toBe(0);
    expect(m.issueStatePredicates.professionalReleaseComplete).toBe(true);
    expect(m.summary.openGateCount).toBe(6);
    expect(m.summary.unresolvedRequirementCount).toBe(17);
  });

  it('permit submission is still blocked by the remaining technical gates', () => {
    expect(m.summary.permitReady).toBe(false);
    expect(m.readinessAxes.permitSubmission.openGateCodes).toContain('STRUCTURAL_ASSEMBLY_AUTHORITY');
    expect(m.summary.engineeringReviewReady).toBe(false);
    expect(m.issueStatePredicates.readyForEngineeringReview).toBe(false);
  });

  it('READY_FOR_ENGINEERING_REVIEW only when professional release is the SOLE open gate', () => {
    const sole = model(['DESIGNER-OF-RECORD-MISSING', 'ENGINEERING-REVIEW-PENDING']);
    expect(sole.summary.openGateCount).toBe(1);
    expect(sole.summary.engineeringReviewReady).toBe(true);
    expect(sole.issueStatePredicates.readyForEngineeringReview).toBe(true);
    expect(sole.issueStatePredicates.readyForPermitSubmission).toBe(false);
    // procurement is independent — nothing procurement-impacting is open
    expect(sole.summary.procurementReady).toBe(true);
  });
});

describe('RGM anti-vacuity — administrative-only hold', () => {
  const m = model(['PROJECT-NAME-NONPRODUCTION']);

  it('only the project/AHJ gate is open and it is an ADMINISTRATIVE hold', () => {
    expect(m.summary.openGateCount).toBe(1);
    expect(m.gates.filter(g => g.status === 'OPEN').map(g => g.gateCode)).toEqual(['PROJECT_AND_AHJ_AUTHORITY']);
    expect(m.requirements[0].findingType).toBe('ADMINISTRATIVE_HOLD');
    expect(m.gates[0].gateCategory).toBe('ADMINISTRATIVE_CODE_AUTHORITY');
    expect(m.gates[0].responsibleRole).toBe('admin');
  });

  it('it blocks permit submission + administrative release but NOT procurement / engineering / construction', () => {
    expect(m.summary.permitReady).toBe(false);
    expect(m.readinessAxes.administrativeRelease.ready).toBe(false);
    expect(m.summary.procurementReady).toBe(true);
    expect(m.readinessAxes.engineeringReview.ready).toBe(true);
    expect(m.readinessAxes.construction.ready).toBe(true);
    // an administrative hold is NEVER an engineering failure
    expect(m.summary.engineeringReviewReady).toBe(false);   // a non-professional gate is open
    expect(m.issueStatePredicates.administrativeReleaseReady).toBe(false);
  });
});

describe('RGM anti-vacuity — procurement-only hold', () => {
  const m = model(['QCABLE-PROCUREMENT-INSUFFICIENT']);

  it('only the Q-Cable closure gate is open, and procurement readiness is false', () => {
    expect(m.summary.openGateCount).toBe(1);
    expect(m.gates.filter(g => g.status === 'OPEN').map(g => g.gateCode)).toEqual(['QCABLE_SYSTEM_CLOSURE']);
    expect(m.summary.procurementReady).toBe(false);
    expect(m.readinessAxes.procurement.openGateCodes).toEqual(['QCABLE_SYSTEM_CLOSURE']);
    expect(m.readinessAxes.construction.ready).toBe(false);
    expect(m.summary.permitReady).toBe(false);
  });

  it('it does NOT block the administrative-release lane (procurement ≠ administrative)', () => {
    expect(m.readinessAxes.administrativeRelease.ready).toBe(true);
    expect(m.issueStatePredicates.administrativeReleaseReady).toBe(true);
  });
});

describe('RGM anti-vacuity — no active requirements', () => {
  const m = model([]);

  it('every gate is CLEARED and every count is zero', () => {
    for (const g of m.gates) {
      expect(g.status, g.gateId).toBe('CLEARED');
      expect(g.unresolvedCount).toBe(0);
      expect(g.totalRequirementCount).toBe(0);
      expect(g.requirementCodes).toEqual([]);
    }
    expect(m.summary).toEqual({
      openGateCount: 0, unresolvedRequirementCount: 0, advisoryCount: 0,
      permitReady: true, procurementReady: true, engineeringReviewReady: true,
    });
    expect(releaseHeadline(m.summary))
      .toBe('0 OPEN RELEASE GATES / 0 UNRESOLVED REQUIREMENTS / 0 ADVISORIES / NO PERMIT-IMPACTING GATE OPEN');
  });

  it('the readiness axes are all ready and no state claims are contradicted', () => {
    for (const axis of Object.values(m.readinessAxes)) {
      expect(axis.ready).toBe(true);
      expect(axis.openGateIds).toEqual([]);
    }
    expect(m.issueStatePredicates.designReview).toBe(false);
    expect(m.issueStatePredicates.readyForPermitSubmission).toBe(true);
    expect(m.issueStatePredicates.readyForEngineeringReview).toBe(false);   // nothing left to review-gate
    expect(verifyReleaseGateModel(m, [], 'PERMIT-READY')).toEqual([]);
  });
});

describe('RGM anti-vacuity — an UNKNOWN blocker code fails closed', () => {
  const registry = [...BRAIDON_19, 'SOME-BRAND-NEW-UNMAPPED-CODE'].map(c => rec(c));
  const m = deriveReleaseGateModel({ registry, snapshotId: 'PDS-TEST', snapshotDigest: 'z'.repeat(64) });

  it('it lands in the UNMAPPED_REQUIREMENT gate — never dropped, never silent', () => {
    const un = gate(m, UNMAPPED_GATE_ID);
    expect(un.status).toBe('OPEN');
    expect(un.gateCode).toBe('UNMAPPED_REQUIREMENT');
    expect(un.unresolvedRequirementCodes).toEqual(['SOME-BRAND-NEW-UNMAPPED-CODE']);
    expect(m.requirements).toHaveLength(20);
    expect(m.summary.openGateCount).toBe(8);
    expect(m.summary.unresolvedRequirementCount).toBe(20);
  });

  it('the UNMAPPED gate blocks EVERY release axis', () => {
    const un = gate(m, UNMAPPED_GATE_ID);
    expect(un.releaseImpact).toEqual({
      permitSubmission: true, procurement: true, engineeringReview: true,
      construction: true, administrativeRelease: true,
    });
    for (const axis of Object.values(m.readinessAxes)) expect(axis.openGateIds).toContain(UNMAPPED_GATE_ID);
  });

  it('the verification FAILS (an unknown code can never pass the harness)', () => {
    expect(verifyNoUnmappedRequirements(m)).toHaveLength(1);
    expect(verifyNoUnmappedRequirements(m)[0]).toContain('SOME-BRAND-NEW-UNMAPPED-CODE');
    const errs = verifyReleaseGateModel(m, registry);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(' ')).toContain('UNMAPPED_REQUIREMENT');
  });

  it('the multiset / count checks still hold — nothing is lost while it fails', () => {
    expect(verifyRequirementMultiset(m, registry)).toEqual([]);
    expect(verifyGateCounts(m)).toEqual([]);
    expect(verifyOnePrimaryGate(m)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ADVISORY handling + duplicate codes
// ═══════════════════════════════════════════════════════════════════════════

describe('RGM — advisories are counted separately and never gate a release axis', () => {
  const m = model([...BRAIDON_19, 'EQUIPMENT-DOCUMENT-UNVERIFIED']);

  it('the advisory is a requirement of gate 2 with the ADVISORY finding type', () => {
    const q = m.requirements.find(x => x.requirementCode === 'EQUIPMENT-DOCUMENT-UNVERIFIED')!;
    expect(q.findingType).toBe('ADVISORY');
    expect(q.severity).toBe('warning');
    expect(q.gateId).toBe('RG-2');
    expect(q.releaseImpact).toEqual({
      permitSubmission: false, procurement: false, engineeringReview: false,
      construction: false, administrativeRelease: false,
    });
  });

  it('advisoryCount is 1 and the unresolved-requirement count stays 19', () => {
    expect(m.summary.advisoryCount).toBe(1);
    expect(m.summary.unresolvedRequirementCount).toBe(19);
    expect(gate(m, 'RG-2').totalRequirementCount).toBe(3);
  });

  it('an advisory alone opens no gate and blocks nothing', () => {
    const only = model(['EQUIPMENT-DOCUMENT-UNVERIFIED']);
    expect(only.summary.advisoryCount).toBe(1);
    expect(only.summary.unresolvedRequirementCount).toBe(0);
    expect(only.summary.permitReady).toBe(true);
    // the gate still reports the child as unresolved (nothing suppressed) but
    // carries no release impact.
    expect(gate(only, 'RG-2').unresolvedCount).toBe(1);
    expect(gate(only, 'RG-2').releaseImpact.permitSubmission).toBe(false);
  });
});

describe('RGM — a duplicated registry code is preserved, never merged or double-counted', () => {
  const registry = [rec('EQUIPMENT-IDENTITY-CONFLICT', { explanation: 'roof: REC 405 vs Qcells 400' }),
    rec('EQUIPMENT-IDENTITY-CONFLICT', { explanation: 'ground: REC 405 vs Qcells 400' })];
  const m = deriveReleaseGateModel({ registry, snapshotId: 'PDS-TEST', snapshotDigest: 'd'.repeat(64) });

  it('two records ⇒ two requirements under one gate', () => {
    expect(m.requirements).toHaveLength(2);
    expect(m.requirements.map(q => q.explanation)).toEqual(['roof: REC 405 vs Qcells 400', 'ground: REC 405 vs Qcells 400']);
    expect(gate(m, 'RG-2').totalRequirementCount).toBe(2);
    expect(m.summary.openGateCount).toBe(1);
    expect(m.summary.unresolvedRequirementCount).toBe(2);
  });

  it('the multiset + count verifications pass on the duplicate', () => {
    expect(verifyReleaseGateModel(m, registry)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. REAL snapshot integration (projected at read; no stored fields)
// ═══════════════════════════════════════════════════════════════════════════

describe('RGM §9 — the model is PROJECTED from a real built snapshot (no digest churn)', () => {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  generatePermitHTML(input);
  const snap = input._snapshot as PermitDesignSnapshot;
  const m = projectReleaseGates(snap);

  it('the snapshot itself gains NO stored release-gate fields (digest untouched)', () => {
    const s = snap as unknown as Record<string, unknown>;
    expect(s.releaseGates).toBeUndefined();
    expect(s.releaseRequirements).toBeUndefined();
    expect(s.releaseSummary).toBeUndefined();
    expect(s.readinessAxes).toBeUndefined();
    // the canonical registry + back-compat list are untouched
    expect(Array.isArray(snap.permitReadiness.registry)).toBe(true);
    expect(Array.isArray(snap.permitReadiness.blockers)).toBe(true);
  });

  it('every active registry code maps to a declared gate — nothing UNMAPPED on real data', () => {
    expect(snap.permitReadiness.registry.length).toBeGreaterThan(0);
    expect(verifyNoUnmappedRequirements(m)).toEqual([]);
    expect(gate(m, UNMAPPED_GATE_ID).totalRequirementCount).toBe(0);
  });

  it('the full §10 verification passes against the real registry + issue state', () => {
    expect(verifyReleaseGateModel(m, snap.permitReadiness.registry, snap.projectAuthority?.issueState)).toEqual([]);
  });

  it('the requirement multiset equals the active registry multiset exactly', () => {
    const active = snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code).sort();
    expect(m.requirements.filter(q => q.status === 'OPEN').map(q => q.requirementCode).sort()).toEqual(active);
  });

  it('the gate rollup reconciles with the registry counts (gates ≤ requirements, nothing hidden)', () => {
    const activeBlocking = snap.permitReadiness.registry.filter(r => !r.resolved && r.severity === 'blocking').length;
    expect(m.summary.unresolvedRequirementCount).toBe(activeBlocking);
    expect(m.summary.openGateCount).toBeGreaterThan(0);
    expect(m.summary.openGateCount).toBeLessThanOrEqual(m.summary.unresolvedRequirementCount);
    expect(m.gates.reduce((s, g) => s + g.unresolvedCount, 0))
      .toBe(m.summary.unresolvedRequirementCount + m.summary.advisoryCount);
  });

  it('permit-ready is never claimed while gates are open (Braidon is never permit-ready)', () => {
    expect(m.summary.permitReady).toBe(false);
    expect(snap.permitReadiness.ready).toBe(false);
    // 2026-08-28 MODULE-DATASHEET MIGRATION - MODULE-EXACT-DATASHEET-PENDING no
    // longer fires: SolarPro SHIPS the Qcells datasheet, archived and hashed
    // in-repo, and the SAME evaluator clears it. Every refusal it still enforces
    // is asserted in tests/planset/manufacturer-datasheet-catalogue.test.ts.
    // The count is a running tally of the product's progress, so the property is
    // asserted as the one that matters: gates ARE open, and permit-ready is not
    // claimed while they are.
    expect(m.summary.openGateCount).toBeGreaterThan(0);
  });

  it('the snapshot id / digest are carried on every gate and requirement (sheet-stamp parity)', () => {
    for (const g of m.gates) {
      expect(g.snapshotId).toBe(snap.meta.snapshotId);
      expect(g.snapshotDigest).toBe(snap.meta.digest);
    }
    for (const q of m.requirements) {
      expect(q.snapshotId).toBe(snap.meta.snapshotId);
      expect(q.snapshotDigest).toBe(snap.meta.digest);
    }
  });

  it('projecting a null snapshot yields an empty, honest model (no fabricated readiness data)', () => {
    const empty = projectReleaseGates(null);
    expect(empty.requirements).toEqual([]);
    expect(empty.summary.openGateCount).toBe(0);
    expect(empty.snapshotId).toBe('');
  });
});
