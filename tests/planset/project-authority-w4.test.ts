// ═══════════════════════════════════════════════════════════════════════════
// W4 §3/§4/§12 — CANONICAL PROJECT/COVER AUTHORITY, ISSUE-STATE MACHINE,
// ISSUED-FOR-PERMIT GATE, and the buildPermitCoverSheet DELETION proof.
//
// Proves: the issue-state machine reaches every state incl. the digest-
// invalidation (REVISED) case; the ISSUED-FOR-PERMIT gate reports each
// precondition individually and fails closed; buildProjectAuthority injects no
// vendor/EOR default; the projection tags fields + fails closed on an absent
// snapshot; V33/V34/V35 are BLOCKING; and the legacy cover path is gone (file
// deleted, zero importers, no pipeline artifact).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  deriveIssueState, evaluateIssuedForPermitGate, classifyBlockerDomain,
  buildProjectAuthority, PROJECT_ISSUE_STATES,
  type IssuedForPermitGateInput, type ProjectAuthorityBuildArgs,
} from '@/lib/permit/snapshot/projectAuthority';
import {
  projectProjectAuthority, PENDING_PROJECT_VALUE,
} from '@/lib/permit/snapshot/projectAuthorityProjection';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { baseSnapshot } from './snapshot-w1.test';

const ROOT = path.resolve(__dirname, '../..');
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const DIGEST = 'a'.repeat(64);
const OLD_DIGEST = 'b'.repeat(64);

// ── §12 issue-state machine ──────────────────────────────────────────────────
describe('W4 §12 — deriveIssueState (all 8 states reachable)', () => {
  const elec = [{ code: 'ROUTE-LENGTH-ESTIMATE' }, { code: 'ENGINEERING-REVIEW-PENDING' }];
  const struct = [{ code: 'STRUCTURAL-FRAMING-UNVERIFIED' }, { code: 'ENGINEERING-REVIEW-PENDING' }];
  const multi = [{ code: 'ROUTE-LENGTH-ESTIMATE' }, { code: 'STRUCTURAL-FRAMING-UNVERIFIED' }, { code: 'ENGINEERING-REVIEW-PENDING' }];
  const codeOnly = [{ code: 'CODE-AUTHORITY-INCOMPLETE' }, { code: 'ENGINEERING-REVIEW-PENDING' }];
  const reviewOnly = [{ code: 'ENGINEERING-REVIEW-PENDING' }];

  it('DESIGN DRAFT — no modules', () => {
    expect(deriveIssueState({ hasDesign: false, blockers: elec, review: null, currentDigest: DIGEST, gatePasses: false }).state)
      .toBe('DESIGN DRAFT');
  });
  it('PENDING ELECTRICAL REVIEW — only electrical gaps', () => {
    expect(deriveIssueState({ hasDesign: true, blockers: elec, review: null, currentDigest: DIGEST, gatePasses: false }).state)
      .toBe('PENDING ELECTRICAL REVIEW');
  });
  it('PENDING STRUCTURAL REVIEW — only structural gaps', () => {
    expect(deriveIssueState({ hasDesign: true, blockers: struct, review: null, currentDigest: DIGEST, gatePasses: false }).state)
      .toBe('PENDING STRUCTURAL REVIEW');
  });
  it('PENDING ENGINEERING REVIEW — multiple domains', () => {
    expect(deriveIssueState({ hasDesign: true, blockers: multi, review: null, currentDigest: DIGEST, gatePasses: false }).state)
      .toBe('PENDING ENGINEERING REVIEW');
  });
  it('PENDING ENGINEERING REVIEW — a single non-electrical/structural (code) domain', () => {
    expect(deriveIssueState({ hasDesign: true, blockers: codeOnly, review: null, currentDigest: DIGEST, gatePasses: false }).state)
      .toBe('PENDING ENGINEERING REVIEW');
  });
  it('PENDING ENGINEERING REVIEW — clean, awaiting sign-off (only review marker)', () => {
    expect(deriveIssueState({ hasDesign: true, blockers: reviewOnly, review: null, currentDigest: DIGEST, gatePasses: false }).state)
      .toBe('PENDING ENGINEERING REVIEW');
  });
  it('REVIEWED — current review but authority gaps remain', () => {
    const r = deriveIssueState({ hasDesign: true, blockers: elec, review: { reviewedDigest: DIGEST }, currentDigest: DIGEST, gatePasses: false });
    expect(r.state).toBe('REVIEWED');
    expect(r.reviewCoversCurrentDigest).toBe(true);
  });
  it('PERMIT-READY — current review, no gaps, gate not fully passing', () => {
    expect(deriveIssueState({ hasDesign: true, blockers: reviewOnly, review: { reviewedDigest: DIGEST }, currentDigest: DIGEST, gatePasses: false }).state)
      .toBe('PERMIT-READY');
  });
  it('ISSUED FOR PERMIT — current review + gate passes', () => {
    expect(deriveIssueState({ hasDesign: true, blockers: reviewOnly, review: { reviewedDigest: DIGEST }, currentDigest: DIGEST, gatePasses: true }).state)
      .toBe('ISSUED FOR PERMIT');
  });
  it('REVISED — a prior approval is invalidated by a digest change', () => {
    const r = deriveIssueState({ hasDesign: true, blockers: reviewOnly, review: { reviewedDigest: OLD_DIGEST }, currentDigest: DIGEST, gatePasses: true });
    expect(r.state).toBe('REVISED');
    expect(r.reviewStale).toBe(true);
  });
  it('every enumerated state is produced by some input (coverage)', () => {
    const produced = new Set([
      deriveIssueState({ hasDesign: false, blockers: [], review: null, currentDigest: DIGEST, gatePasses: false }).state,
      deriveIssueState({ hasDesign: true, blockers: elec, review: null, currentDigest: DIGEST, gatePasses: false }).state,
      deriveIssueState({ hasDesign: true, blockers: struct, review: null, currentDigest: DIGEST, gatePasses: false }).state,
      deriveIssueState({ hasDesign: true, blockers: multi, review: null, currentDigest: DIGEST, gatePasses: false }).state,
      deriveIssueState({ hasDesign: true, blockers: elec, review: { reviewedDigest: DIGEST }, currentDigest: DIGEST, gatePasses: false }).state,
      deriveIssueState({ hasDesign: true, blockers: reviewOnly, review: { reviewedDigest: DIGEST }, currentDigest: DIGEST, gatePasses: false }).state,
      deriveIssueState({ hasDesign: true, blockers: reviewOnly, review: { reviewedDigest: DIGEST }, currentDigest: DIGEST, gatePasses: true }).state,
      deriveIssueState({ hasDesign: true, blockers: reviewOnly, review: { reviewedDigest: OLD_DIGEST }, currentDigest: DIGEST, gatePasses: true }).state,
    ]);
    for (const s of PROJECT_ISSUE_STATES) expect(produced.has(s)).toBe(true);
  });
});

describe('W4 §12 — classifyBlockerDomain', () => {
  it('maps known blocker codes to their domains', () => {
    expect(classifyBlockerDomain('ROUTE-LENGTH-ESTIMATE')).toBe('electrical');
    expect(classifyBlockerDomain('FEEDER-RACEWAY-AUTHORITY')).toBe('electrical');
    expect(classifyBlockerDomain('STRUCTURAL-FRAMING-UNVERIFIED')).toBe('structural');
    expect(classifyBlockerDomain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED')).toBe('structural');
    expect(classifyBlockerDomain('CODE-AUTHORITY-INCOMPLETE')).toBe('code');
    expect(classifyBlockerDomain('EQUIPMENT-IDENTITY-CONFLICT')).toBe('equipment');
    expect(classifyBlockerDomain('ENGINEERING-REVIEW-PENDING')).toBe('review');
    expect(classifyBlockerDomain('MANUFACTURER-DOCUMENT-MISSING')).toBe('document');
    expect(classifyBlockerDomain('SOMETHING-NEW')).toBe('other');
  });
});

// ── §12 ISSUED-FOR-PERMIT gate ───────────────────────────────────────────────
describe('W4 §12 — evaluateIssuedForPermitGate (each precondition)', () => {
  const allPass: IssuedForPermitGateInput = {
    projectIdentityValid: true,   // §15(d)
    blockingValidatorsPass: true,
    noEquipmentIdentityConflict: true,
    codeAuthorityVerified: true,
    manufacturerDocumentsArchived: true,
    structuralApplicabilityEstablished: true,
    engineerReviewCoversCurrentDigest: true,
    signatureSealSatisfied: true,
  };

  it('passes only when every precondition is satisfied', () => {
    const g = evaluateIssuedForPermitGate(allPass);
    expect(g.pass).toBe(true);
    expect(g.preconditions.every(p => p.satisfied)).toBe(true);
    expect(g.preconditions).toHaveLength(8);
  });

  it('§15(d) — a TEST/undesigned project (projectIdentityValid=false) fails the gate', () => {
    const g = evaluateIssuedForPermitGate({ ...allPass, projectIdentityValid: false });
    expect(g.pass).toBe(false);
    const idPre = g.preconditions.find(p => p.id === 'project-identity-valid')!;
    expect(idPre.satisfied).toBe(false);
  });

  const flips: (keyof IssuedForPermitGateInput)[] = [
    'projectIdentityValid', 'blockingValidatorsPass', 'noEquipmentIdentityConflict', 'codeAuthorityVerified',
    'structuralApplicabilityEstablished', 'engineerReviewCoversCurrentDigest', 'signatureSealSatisfied',
  ];
  for (const k of flips) {
    it(`fails closed when ${k} is false`, () => {
      const g = evaluateIssuedForPermitGate({ ...allPass, [k]: false });
      expect(g.pass).toBe(false);
      expect(g.preconditions.some(p => !p.satisfied)).toBe(true);
    });
  }

  it('manufacturerDocumentsArchived=null (closer hook) is NOT satisfied', () => {
    const g = evaluateIssuedForPermitGate({ ...allPass, manufacturerDocumentsArchived: null });
    expect(g.pass).toBe(false);
    const docPre = g.preconditions.find(p => p.id === 'manufacturer-documents')!;
    expect(docPre.satisfied).toBe(false);
    expect(docPre.detail).toMatch(/closer hook/i);
  });

  it('digestInvalidatedByLedger forces the review precondition false even if reviewedDigest matched', () => {
    const g = evaluateIssuedForPermitGate({ ...allPass, digestInvalidatedByLedger: true });
    expect(g.pass).toBe(false);
    const rev = g.preconditions.find(p => p.id === 'engineer-review-current-digest')!;
    expect(rev.satisfied).toBe(false);
    expect(rev.detail).toMatch(/ledger/i);
  });
});

// ── §3 buildProjectAuthority — no vendor defaults ────────────────────────────
describe('W4 §3 — buildProjectAuthority (no vendor/EOR defaults)', () => {
  const args = (over: Partial<ProjectAuthorityBuildArgs> = {}): ProjectAuthorityBuildArgs => ({
    projectName: 'Braidon PV', customer: 'Braidon', installationAddress: '1 Main St',
    city: 'Springfield', stateCode: 'IL', zip: '62701', parcelApn: 'APN-1',
    ahjName: 'City of Springfield', utilityName: 'Ameren',
    systemType: 'ROOF MOUNT', dcKw: 12.4, acKw: 10.8, moduleCount: 31,
    equipmentSummary: {
      moduleManufacturer: 'Q CELLS', moduleModel: 'Q.PEAK 400W', moduleWatts: 400,
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8A', inverterType: 'MICROINVERTER',
      mountManufacturer: null, mountModel: null,
      batteryBrand: null, batteryModel: null, batteryCount: null, combinerLabel: null,
    },
    designer: null, contractor: null, issueDate: '2026-07-21',
    sheetIndex: [{ id: 'PV-0', title: 'COVER' }, { id: 'PV-1', title: 'SITE' }],
    governingCodes: { schemaVersion: '1.0.0', verificationStatus: 'incomplete', ahjName: 'City of Springfield' },
    generalNotes: ['DO NOT SCALE FROM DRAWINGS.'],
    hasDesign: true,
    blockers: [{ code: 'ROUTE-LENGTH-ESTIMATE' }, { code: 'ENGINEERING-REVIEW-PENDING' }],
    review: null, currentDigest: '',
    gateInput: {
      projectIdentityValid: false,
      blockingValidatorsPass: false, noEquipmentIdentityConflict: true, codeAuthorityVerified: false,
      manufacturerDocumentsArchived: null, structuralApplicabilityEstablished: false,
      engineerReviewCoversCurrentDigest: false, signatureSealSatisfied: false,
    },
    capturedAtIso: '2026-07-21',
    ...over,
  });

  it('a missing designer/contractor stays null (no "SolarPro Engineering Engine")', () => {
    const r = buildProjectAuthority(args());
    expect(r.designer).toBeNull();
    expect(r.contractor).toBeNull();
  });
  it('the issue state is DERIVED from the blockers (electrical-only → PENDING ELECTRICAL REVIEW)', () => {
    const r = buildProjectAuthority(args());
    expect(r.issueState).toBe('PENDING ELECTRICAL REVIEW');
    expect(r.issuedForPermitGate.pass).toBe(false);
  });
  it('the sheet index is the passed manifest, and rev A description = the issue state (never a fabricated "ISSUED FOR PERMIT")', () => {
    const r = buildProjectAuthority(args());
    expect(r.sheetIndex.map(s => s.id)).toEqual(['PV-0', 'PV-1']);
    expect(r.revisionHistory[0].description).toBe('PENDING ELECTRICAL REVIEW');
  });
  it('governing codes is a REFERENCE — carries NO edition literal', () => {
    const r = buildProjectAuthority(args());
    expect(JSON.stringify(r.governingCodesRef)).not.toMatch(/\b20(1[0-9]|2[0-9])\b|\b7-(1[0-9]|2[0-9])\b/);
    expect(r.governingCodesRef.source).toBe('snapshot.codeAuthority');
  });
});

// ── §3 projection accessor + fail-closed ─────────────────────────────────────
describe('W4 §3 — projectAuthority projection (tags + fail closed)', () => {
  it('an absent snapshot yields an empty projection whose values are all PENDING', () => {
    const p = projectProjectAuthority(null);
    expect(p.present).toBe(false);
    expect(p.ahj).toBeNull();
    expect(p.display('ahj')).toBe(PENDING_PROJECT_VALUE);
    expect(p.tag('issue-status')).toContain(`data-project-field="issue-status"`);
    expect(p.tag('issue-status')).toContain(PENDING_PROJECT_VALUE);
  });
  it('tags the truth-matrix fields with data-project-field and the escaped value', () => {
    const p = projectProjectAuthority(baseSnapshot());
    for (const f of ['ahj', 'utility', 'system-type', 'module-model', 'inverter-model', 'issue-status', 'snapshot-id', 'digest'] as const) {
      expect(p.tag(f)).toContain(`data-project-field="${f}"`);
    }
    expect(p.tag('ahj')).toContain('Test AHJ');
    expect(p.value('module-model')).toBe('Q CELLS Q.PEAK DUO BLK ML-G10+ 400W');
  });
});

// ── V33/V34/V35 blocking validators ──────────────────────────────────────────
describe('W4 §3/§12 — V33/V34/V35 are BLOCKING', () => {
  const vOf = (s: PermitDesignSnapshot, n: string) =>
    blockingViolations(validatePermitDesignSnapshot(s)).filter(x => x.invariant === n);

  it('baseSnapshot has no V33/V34/V35 violations (consistent authority)', () => {
    const s = baseSnapshot();
    expect(vOf(s, 'V33')).toEqual([]);
    expect(vOf(s, 'V34')).toEqual([]);
    expect(vOf(s, 'V35')).toEqual([]);
  });

  it('V33 fires when the stored issue state does not derive from the blockers', () => {
    const s = clone(baseSnapshot());
    s.projectAuthority.issueState = 'ISSUED FOR PERMIT';  // fabricated — blockers say PENDING
    const v = vOf(s, 'V33');
    expect(v.length).toBe(1);
    expect(v[0].authorityPath).toBe('projectAuthority.issueState');
  });

  it('V34 fires when ISSUED FOR PERMIT lacks a current-digest review', () => {
    const s = clone(baseSnapshot());
    // Make the blockers clear + gate pass so ONLY the missing review is at fault.
    s.permitReadiness.blockers = [{ code: 'ENGINEERING-REVIEW-PENDING', message: '' }];
    s.projectAuthority.issueState = 'ISSUED FOR PERMIT';
    s.projectAuthority.issuedForPermitGate = { pass: true, preconditions: [] };
    const v = vOf(s, 'V34');
    expect(v.length).toBeGreaterThanOrEqual(1);
  });

  it('V35 fires on stale/independent cover equipment (module ≠ snapshot record)', () => {
    const s = clone(baseSnapshot());
    s.projectAuthority.equipmentSummary.moduleModel = 'SOME OTHER PANEL 999W';
    const v = vOf(s, 'V35');
    expect(v.some(x => x.authorityPath.includes('moduleModel'))).toBe(true);
  });

  it('V35 fires when governing-codes reference carries an edition literal', () => {
    const s = clone(baseSnapshot());
    (s.projectAuthority.governingCodesRef as unknown as { schemaVersion: string }).schemaVersion = 'NEC 2023';
    const v = vOf(s, 'V35');
    expect(v.some(x => x.authorityPath.includes('governingCodesRef'))).toBe(true);
  });

  it('V35 fires when AHJ is not single-sourced from the code authority', () => {
    const s = clone(baseSnapshot());
    s.projectAuthority.ahjName = 'A DIFFERENT AHJ';
    const v = vOf(s, 'V35');
    expect(v.some(x => x.authorityPath === 'projectAuthority.ahjName')).toBe(true);
  });
});

// ── §4 buildPermitCoverSheet DELETION reachability proof ─────────────────────
describe('W4 §4 — the legacy buildPermitCoverSheet path is retired (deletion proof)', () => {
  it('lib/permit/buildPermitCoverSheet.ts no longer exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'lib/permit/buildPermitCoverSheet.ts'))).toBe(false);
  });
  it('the dormant React components/permit/CoverSheet.tsx no longer exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'components/permit/CoverSheet.tsx'))).toBe(false);
  });
  it('no source file imports the retired builder', () => {
    const hits: string[] = [];
    const exts = new Set(['.ts', '.tsx', '.mjs', '.js']);
    const skip = new Set(['node_modules', '.next', '.git', 'docs', 'repo-bisect', 'dist', 'build']);
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(dir, e.name)); continue; }
        if (!exts.has(path.extname(e.name))) continue;
        const txt = fs.readFileSync(path.join(dir, e.name), 'utf8');
        if (/from ['"][^'"]*buildPermitCoverSheet['"]|buildPermitCoverSheetArtifact\s*\(|renderPermitCoverHTML\s*\(|mapReportToPermitCover\s*\(/.test(txt)) {
          hits.push(path.relative(ROOT, path.join(dir, e.name)));
        }
      }
    };
    walk(path.join(ROOT, 'app'));
    walk(path.join(ROOT, 'lib'));
    walk(path.join(ROOT, 'components'));
    walk(path.join(ROOT, 'scripts'));
    expect(hits).toEqual([]);
  });
  it('the pipeline artifact builder no longer emits a permit_cover_sheet artifact', () => {
    const txt = fs.readFileSync(path.join(ROOT, 'lib/engineering/artifactBuilders.ts'), 'utf8');
    expect(txt).not.toMatch(/buildPermitCoverSheetArtifact\s*\(/);
    expect(txt).not.toMatch(/fileType:\s*['"]permit_cover_sheet['"]/);
  });
});
