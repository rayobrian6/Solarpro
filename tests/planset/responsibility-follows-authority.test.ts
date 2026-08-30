// ═══════════════════════════════════════════════════════════════════════════
// RS-1 EXPLAINED WHY ONLY AN ENGINEER COULD CLOSE IT, THEN SAID "RESPONSIBLE: OPERATOR"
//
// FRAMING-AUTHORITY-UNVERIFIED declares
//
//     resolutionMode: 'AUTO_RETRIEVED',  residualMode: 'PROFESSIONAL_APPROVAL'
//
// and its RS-1 row says, in its own words, that existing framing capacity cannot
// be established automatically and must transition to professional approval. The
// same row then printed RESPONSIBLE: OPERATOR. An operator cannot close it.
// Nobody but a licensed engineer can.
//
// `deriveResponsibleRole` was a static map from (gateCategory, findingType) and
// never saw the resolution mode — while `requirementLane`, three hundred lines
// away, already read `residualMode ?? resolutionMode` to decide the lane. So the
// scorecard counted the requirement in the PROFESSIONAL lane and the row named
// the OPERATOR: two answers to "who is waiting", from two readers of the same
// declaration.
//
// Responsibility now reads the same field, and may TRANSITION as the authority
// state advances: the automatic phase belongs to whoever the finding type
// implies, the residual phase to the terminal actor.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  deriveResponsibleRole, requirementLane, projectReleaseGatesFromInput,
  REQUIREMENT_DECLARATIONS,
} from '@/lib/permit/snapshot/releaseGates';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

describe('responsibility follows the authority workflow — MUTATION', () => {
  it('a requirement whose RESIDUAL mode is professional is the engineer\'s', () => {
    const d = REQUIREMENT_DECLARATIONS['FRAMING-AUTHORITY-UNVERIFIED'];
    expect(d.resolutionMode).toBe('AUTO_RETRIEVED');
    expect(d.residualMode).toBe('PROFESSIONAL_APPROVAL');

    // automatic path exhausted (ran, did not close it) ⇒ the residual owner
    expect(deriveResponsibleRole(
      'STRUCTURAL_AUTHORITY', 'PENDING_AUTHORITY',
      'FRAMING-AUTHORITY-UNVERIFIED', true,
    )).toBe('engineer-of-record');
  });

  it('...and while the AUTOMATIC path is still live it is not', () => {
    // The transition is real in both directions: nothing is owed by the engineer
    // until the retrieval SolarPro attempts on his behalf has actually run.
    expect(deriveResponsibleRole(
      'STRUCTURAL_AUTHORITY', 'PENDING_AUTHORITY',
      'FRAMING-AUTHORITY-UNVERIFIED', false,
    )).toBe('operator');
  });

  it('unknown attempt state defaults to the TERMINAL owner', () => {
    // An OPEN requirement's owner is whoever must act if nothing else closes it.
    expect(deriveResponsibleRole(
      'STRUCTURAL_AUTHORITY', 'PENDING_AUTHORITY',
      'FRAMING-AUTHORITY-UNVERIFIED',
    )).toBe('engineer-of-record');
  });

  it('the lane and the role now read the SAME field', () => {
    for (const code of Object.keys(REQUIREMENT_DECLARATIONS)) {
      const lane = requirementLane(code);
      const role = deriveResponsibleRole(
        'STRUCTURAL_AUTHORITY',
        REQUIREMENT_DECLARATIONS[code].findingType,
        code, true,
      );
      if (lane === 'professional') {
        expect(role, `${code}: professional lane must be the engineer's`).toBe('engineer-of-record');
      }
    }
  });

  it('a NON-professional requirement is unaffected', () => {
    // The map still governs everything whose terminal mode is not professional.
    expect(deriveResponsibleRole('ADMINISTRATIVE_CODE_AUTHORITY', 'ADMINISTRATIVE_HOLD')).toBe('admin');
    expect(deriveResponsibleRole('PROCUREMENT_CLOSURE', 'PENDING_SELECTION')).toBe('designer');
    expect(deriveResponsibleRole('EQUIPMENT_AUTHORITY', 'TECHNICAL_CONFLICT')).toBe('operator');
  });
});

describe('the rendered package agrees', () => {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  const html = generatePermitHTML(input) as unknown as string;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('no professional-lane requirement names the operator on RS-1', () => {
    const model = projectReleaseGatesFromInput(input);
    for (const r of model.requirements) {
      if (r.status !== 'OPEN') continue;
      if (requirementLane(r.requirementCode) !== 'professional') continue;
      expect(r.responsibleRole, r.requirementCode).toBe('engineer-of-record');
    }
  });

  it('framing capacity is owned by the engineer of record on the sheet', () => {
    // The reported contradiction, gone from the rendered artifact.
    expect(text).toMatch(/FRAMING-AUTHORITY-UNVERIFIED/);
    const i = text.indexOf('FRAMING-AUTHORITY-UNVERIFIED');
    const row = text.slice(i, i + 1400);
    expect(row).toMatch(/RESPONSIBLE: ENGINEER OF RECORD/);
    expect(row).not.toMatch(/RESPONSIBLE: OPERATOR/);
  });

  it('and no software-resolver semantics reach the engineer-facing sheet', () => {
    for (const tok of ['resolverImplemented', 'plannedResolverPhase', 'lastResolutionResult',
      'unresolvedReasonCode', 'RESOLVER_NOT_IMPLEMENTED', 'NOT_ATTEMPTED', 'AUTO_RETRIEVED']) {
      expect(text, tok).not.toContain(tok);
    }
  });
});
