// ═══════════════════════════════════════════════════════════════════════════
// D5 — ONE VERIFICATION POLICY. "VERIFIED BY NOBODY" IS NOT A LEGAL STATE.
//
// Two writers disagreed about what `verification_state` meant:
//   • jurisdictionResolvers.ts passed verificationState:'verified' with the
//     resolver id in `reviewer` (the ASSIGNED-reviewer column);
//   • structuralResolvers.ts correctly refused to self-verify.
// And `createDocument` omitted verified_by / verified_at / verification_notes
// from its INSERT column list ENTIRELY — so the terminal state was reachable
// with no verifier at all. That is how the live climate row
// cedb14f7-917a-539b-a68a-f08f08b64d13 came to be `verified` with verified_by
// NULL, while three archived, hashed Roof Tech rows sat `unverified`.
//
// The policy: custody (archived + hashed) is NOT verification. Terminal
// 'verified' requires an actor, the KIND of actor, and a stated basis — and a
// deterministic resolver may only verify document classes where machine
// verification is objective. Structural classes are human-only.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  validateDocumentInput,
  MACHINE_VERIFIABLE_DOCUMENT_CLASSES,
  type DocumentInput,
} from '@/lib/documents/registry';

const archived = {
  archivedInRepo: true,
  sha256: '3b9a2a9588d237af626aef50ad3b00c30d561851be02b0149fc1360fcada362e',
};

function doc(over: Partial<DocumentInput> = {}): DocumentInput {
  return {
    documentClass: 'structural_pe_letter',
    manufacturerOrIssuer: 'Roof Tech, Inc.',
    title: 'RT-Mini II Mount — Structural Analysis',
    ...archived,
    ...over,
  } as DocumentInput;
}

describe('D5 · custody is not verification', () => {
  it('REFUSES terminal verified with no verifier — the exact hole that made the live row', () => {
    const r = validateDocumentInput(doc({ verificationState: 'verified', documentClass: 'climate_hazard_dataset' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/without a verificationActor/i);
    expect(r.error).toMatch(/custody is not verification/i);
  });

  it('REFUSES terminal verified with an actor but no actor kind', () => {
    const r = validateDocumentInput(doc({
      documentClass: 'climate_hazard_dataset',
      verificationState: 'verified', verificationActor: 'someone',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/verificationActorKind must be/i);
  });

  it('REFUSES terminal verified with no stated basis', () => {
    const r = validateDocumentInput(doc({
      documentClass: 'climate_hazard_dataset',
      verificationState: 'verified', verificationActor: 'env@v1', verificationActorKind: 'resolver',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/verificationBasis/i);
  });

  it('a `reviewer` value does NOT satisfy the verifier requirement', () => {
    // This is precisely what the environmental resolver used to do.
    const r = validateDocumentInput(doc({
      documentClass: 'climate_hazard_dataset',
      verificationState: 'verified', reviewer: 'environmental-load-authority@v1',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/verificationActor/i);
  });

  it('still refuses to verify a document that is not archived + hashed', () => {
    const r = validateDocumentInput({
      documentClass: 'climate_hazard_dataset', manufacturerOrIssuer: 'x', title: 'y',
      verificationState: 'verified', verificationActor: 'a', verificationActorKind: 'resolver',
      verificationBasis: 'B',
    } as DocumentInput);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/archived with a sha256/i);
  });
});

describe('D5 · a resolver may never establish licensed structural applicability', () => {
  it('REFUSES a resolver verifying a structural_pe_letter', () => {
    const r = validateDocumentInput(doc({
      verificationState: 'verified', verificationActor: 'racking-documents@v1',
      verificationActorKind: 'resolver', verificationBasis: 'MACHINE_RETRIEVAL',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/may not be verified by a resolver/i);
    expect(r.error).toMatch(/never licensed applicability/i);
  });

  it('REFUSES a resolver verifying a racking installation manual', () => {
    const r = validateDocumentInput(doc({
      documentClass: 'racking_installation_manual',
      verificationState: 'verified', verificationActor: 'racking-documents@v1',
      verificationActorKind: 'resolver', verificationBasis: 'MACHINE_RETRIEVAL',
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/may not be verified by a resolver/i);
  });

  it('ACCEPTS a human verifying a structural_pe_letter', () => {
    const r = validateDocumentInput(doc({
      verificationState: 'verified', verificationActor: 'user-uuid',
      verificationActorKind: 'human', verificationBasis: 'REGISTRAR_REVIEW',
    }));
    expect(r.ok).toBe(true);
  });

  it('ACCEPTS a resolver verifying a climate hazard dataset (RG-3 does not regress)', () => {
    const r = validateDocumentInput(doc({
      documentClass: 'climate_hazard_dataset',
      verificationState: 'verified', verificationActor: 'environmental-load-authority@v1',
      verificationActorKind: 'resolver', verificationBasis: 'MACHINE_GOVERNMENT_DATASET_RETRIEVAL',
    }));
    expect(r.ok).toBe(true);
  });

  it('the machine-verifiable allow-list contains NO structural class', () => {
    for (const c of ['structural_pe_letter', 'evaluation_report', 'racking_installation_manual']) {
      expect(MACHINE_VERIFIABLE_DOCUMENT_CLASSES).not.toContain(c);
    }
    expect(MACHINE_VERIFIABLE_DOCUMENT_CLASSES).toContain('climate_hazard_dataset');
  });
});

describe('D5 · unverified rows are unaffected', () => {
  it('an unverified document needs no verifier (retrieval records custody only)', () => {
    expect(validateDocumentInput(doc({ verificationState: 'unverified' })).ok).toBe(true);
    expect(validateDocumentInput(doc({})).ok).toBe(true);
  });

  it('an in_review document needs no verifier', () => {
    expect(validateDocumentInput(doc({ verificationState: 'in_review' })).ok).toBe(true);
  });
});
