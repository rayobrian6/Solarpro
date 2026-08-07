// ═══════════════════════════════════════════════════════════════════════════
// CMDA — CANONICAL MODULE DOCUMENT AUTHORITY.
//
// D8 removed FALSE title-based exactness. It did not give the question a strong
// enough owner, so module applicability could still be established by:
//   • `equipment_model_applicability LIKE '%<model>%'` — a substring match
//   • the mere PRESENCE of a bound document id
//   • `verification_state='verified'` on its own
//   • a static asset's marketing title ("385-405W")
// and, in the other direction, an official Q CELLS family sheet that genuinely
// covers 400 W was reported as "Attach the exact 400 W datasheet".
//
// The rule under test: a verified document is AUTHENTIC; whether it COVERS the
// selected variant is a separate question answered only by governed structured
// claims, read off ONE registry row.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  evaluateModuleDatasheetApplicability, noModuleDocumentAuthority,
  MODULE_APPLICABILITY_HEADLINE,
  type SelectedModuleIdentity,
} from '@/lib/permit/snapshot/moduleDocumentAuthority';
import { pickVerifiedDocument, validateVerificationTransition } from '@/lib/documents/registry';
import type { RegistryDocument, ExtractedEngineeringClaims } from '@/lib/documents/types';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { resolveSnapshotAuthorityInputs } from '@/lib/permit/snapshot/authorityInputs';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import type { SafeDbRead } from '@/lib/permit/snapshot/resolution/types';

const SHA = 'a'.repeat(64);

const SELECTED: SelectedModuleIdentity = {
  equipmentId: 'qcells-peak-duo-400',
  manufacturer: 'Q CELLS',
  model: 'Q.PEAK DUO BLK ML-G10+ 400W',
  watts: 400,
};

/** The governed Q CELLS family claims — the shape a real record must carry. */
function familyClaims(over: Partial<NonNullable<ExtractedEngineeringClaims['module']>> = {}): ExtractedEngineeringClaims {
  return {
    module: {
      manufacturer: 'Q CELLS',
      productFamily: 'Q.PEAK DUO BLK ML-G10+',
      equipmentIdsCovered: ['qcells-peak-duo-400'],
      modelsCovered: ['Q.PEAK DUO BLK ML-G10+ 385W', 'Q.PEAK DUO BLK ML-G10+ 400W', 'Q.PEAK DUO BLK ML-G10+ 405W'],
      wattagesCovered: [385, 390, 395, 400, 405],
      explicitWattageRange: { minWatts: 385, maxWatts: 405 },
      electricalMechanicalSpecificationsPresent: true,
      evidence: { page: 2, table: 'Electrical Characteristics', column: '400' },
      applicabilityBasis: 'Q CELLS Q.PEAK DUO BLK ML-G10+ 385-405 datasheet, electrical characteristics table',
      ...over,
    },
  };
}

function doc(over: Partial<RegistryDocument> = {}, claims?: ExtractedEngineeringClaims | null): RegistryDocument {
  return {
    id: 'doc-qcells-peak-duo-family',
    documentClass: 'module_datasheet' as RegistryDocument['documentClass'],
    manufacturerOrIssuer: 'Q CELLS',
    equipmentId: 'qcells-peak-duo-400',
    equipmentModelApplicability: 'Q.PEAK DUO BLK ML-G10+ 385-405',
    title: 'Q CELLS Q.PEAK DUO BLK ML-G10+ 385-405W Datasheet',
    revision: null, documentDate: '2026-01-01',
    archivedFileIdentity: 'https://q-cells.example/g10plus.pdf',
    archivedInRepo: true, sha256: SHA,
    source: 'https://q-cells.example/g10plus.pdf',
    jurisdictionBoundary: null, jurisdictionAuthorityId: null, applicabilityNotes: null,
    status: 'current' as RegistryDocument['status'],
    supersedesId: null, supersededById: null,
    extractedClaims: claims === undefined ? familyClaims() : claims,
    verificationState: 'verified' as RegistryDocument['verificationState'],
    reviewer: null, verifiedBy: 'Dana Reyes', verifiedAt: '2026-02-01T00:00:00.000Z',
    verificationNotes: 'Compared against the manufacturer download; page 2 table checked.',
    createdBy: 'test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as RegistryDocument;
}

const evalWith = (d: RegistryDocument | null, selected = SELECTED) =>
  evaluateModuleDatasheetApplicability({ selected, document: d });

// ═══════════════════════════════════════════════════════════════════════════
// §A — WHAT MAY NOT ESTABLISH AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════

describe('CMDA §A · weak evidence cannot establish module applicability', () => {
  it('1. a bound document id alone cannot clear — no module claims', () => {
    const a = evalWith(doc({}, null));
    expect(a.state).toBe('EVIDENCE_INCOMPLETE');
    expect(a.clears).toBe(false);
    expect(a.refusals.join(' ')).toMatch(/no structured module applicability claims/);
    // the identity IS still reported — the row is citable, it just proves nothing
    expect(a.documentId).toBe('doc-qcells-peak-duo-family');
  });

  it('2. verified + current + archived + hashed, with no applicability claims, cannot clear', () => {
    const a = evalWith(doc({ verificationState: 'verified' as RegistryDocument['verificationState'] }, null));
    expect(a.verificationState).toBe('verified');
    expect(a.archivedInRepo).toBe(true);
    expect(a.sha256).toBe(SHA);
    expect(a.clears).toBe(false);
  });

  it('3. a model substring in equipment_model_applicability is not authority', () => {
    // The registry text loosely contains the selected model, and nothing else.
    const loose = doc({ equipmentModelApplicability: 'Q.PEAK DUO BLK ML-G10+ 400W and friends' }, null);
    expect(evalWith(loose).clears).toBe(false);
    // …and the registry SELECTION must refuse it too when module coverage is required
    expect(pickVerifiedDocument([loose], {
      documentClass: 'module_datasheet', equipmentModel: SELECTED.model,
      selectedWatts: 400, requireModuleDatasheetCoverage: true,
    })).toBeNull();
    // without the flag the legacy substring path still selects it — proving the
    // flag is what carries the requirement, not an accident of the fixture
    expect(pickVerifiedDocument([loose], {
      documentClass: 'module_datasheet', equipmentModel: SELECTED.model,
    })).not.toBeNull();
  });

  it('4. an equipment-id match with no wattage coverage cannot clear', () => {
    const a = evalWith(doc({}, familyClaims({
      wattagesCovered: [], explicitWattageRange: null, variantsCovered: [],
      modelsCovered: ['Q.PEAK DUO BLK ML-G10+ 385W'],
    })));
    expect(a.state).toBe('NOT_COVERED');
    expect(a.clears).toBe(false);
  });

  it('4b. claims with no evidence LOCATION cannot clear', () => {
    const a = evalWith(doc({}, familyClaims({ evidence: null })));
    expect(a.state).toBe('EVIDENCE_INCOMPLETE');
    expect(a.refusals.join(' ')).toMatch(/evidence location/);
  });

  it('4c. claims that do not assert electrical+mechanical specs cannot clear', () => {
    const a = evalWith(doc({}, familyClaims({ electricalMechanicalSpecificationsPresent: false })));
    expect(a.state).toBe('EVIDENCE_INCOMPLETE');
  });

  it('7. a hashless / unarchived static-asset-like row cannot clear', () => {
    expect(evalWith(doc({ sha256: null, archivedInRepo: false })).clears).toBe(false);
    expect(evalWith(doc({ sha256: null, archivedInRepo: false })).state).toBe('EVIDENCE_INCOMPLETE');
    expect(evalWith(null).state).toBe('NO_DOCUMENT');
    expect(noModuleDocumentAuthority(SELECTED).clears).toBe(false);
  });

  it('8. claims and identity from DIFFERENT registry rows cannot be combined', () => {
    // The evaluator takes ONE row, so the only way to attempt this is to hand it
    // a row whose claims describe a different product. It must fail closed.
    const foreign = doc({ id: 'doc-other-vendor', equipmentId: 'longi-hi-mo-550' }, {
      module: {
        manufacturer: 'LONGi', productFamily: 'LR5-72HTH',
        equipmentIdsCovered: ['longi-hi-mo-550'], modelsCovered: ['LR5-72HTH 550M'],
        wattagesCovered: [550], explicitWattageRange: { minWatts: 545, maxWatts: 560 },
        electricalMechanicalSpecificationsPresent: true,
        evidence: { page: 1, table: 'Electrical' }, applicabilityBasis: 'LONGi datasheet',
      },
    });
    const a = evalWith(foreign);
    expect(a.state).toBe('NOT_COVERED');
    expect(a.clears).toBe(false);
    // and the cited identity is the foreign row's own — nothing was borrowed
    expect(a.documentId).toBe('doc-other-vendor');
  });

  it('9. verification revoked reopens the authority', () => {
    const ok = evalWith(doc());
    expect(ok.clears).toBe(true);
    const revoked = evalWith(doc({ verificationState: 'unverified' as RegistryDocument['verificationState'] }));
    expect(revoked.clears).toBe(false);
    expect(revoked.state).toBe('EVIDENCE_INCOMPLETE');
    expect(revoked.refusals.join(' ')).toMatch(/verification state/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §B — WHAT MUST ESTABLISH AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════

describe('CMDA §B · governed family coverage is real authority', () => {
  it('5. a Q CELLS family sheet explicitly covering 400 W CLEARS as FAMILY_COVERED', () => {
    const a = evalWith(doc());
    expect(a.state).toBe('FAMILY_COVERED');
    expect(a.clears).toBe(true);
    expect(a.refusals).toEqual([]);
    expect(a.selectedWatts).toBe(400);
    expect(a.coveredRange).toEqual({ minWatts: 385, maxWatts: 405 });
    expect(a.evidenceLocation).toBe('page 2, table Electrical Characteristics, column 400');
    expect(a.sha256).toBe(SHA);
    // the wording must NOT demand a single-wattage PDF
    expect(a.basis).not.toMatch(/attach the exact/i);
    expect(MODULE_APPLICABILITY_HEADLINE[a.state]).toBe('OFFICIAL MODULE DATASHEET — FAMILY COVERAGE VERIFIED');
  });

  it('5b. a per-variant row naming the exact variant is EXACT_VARIANT', () => {
    const a = evalWith(doc({}, familyClaims({
      variantsCovered: [{ model: 'Q.PEAK DUO BLK ML-G10+ 400W', watts: 400, equipmentId: 'qcells-peak-duo-400' }],
    })));
    expect(a.state).toBe('EXACT_VARIANT');
    expect(a.clears).toBe(true);
  });

  it('6. 410 W against a 385–405 W document is NOT_COVERED', () => {
    const a = evalWith(doc(), { ...SELECTED, model: 'Q.PEAK DUO BLK ML-G10+ 410W', watts: 410, equipmentId: 'qcells-peak-duo-410' });
    expect(a.state).toBe('NOT_COVERED');
    expect(a.clears).toBe(false);
    expect(a.basis).toMatch(/385–405 W/);
  });

  it('the registry SELECTION returns the full row, and requires module coverage when asked', () => {
    const good = doc();
    const noClaims = doc({ id: 'doc-no-claims' }, null);
    const picked = pickVerifiedDocument([noClaims, good], {
      documentClass: 'module_datasheet', equipmentId: SELECTED.equipmentId,
      equipmentModel: SELECTED.model, selectedWatts: 400, requireModuleDatasheetCoverage: true,
    });
    expect(picked?.id).toBe(good.id);
    // the FULL row is returned — not reduced to {id, sha256} before authority
    expect(picked?.extractedClaims?.module?.explicitWattageRange).toEqual({ minWatts: 385, maxWatts: 405 });
    expect(picked?.verifiedBy).toBe('Dana Reyes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §C — ONE VERIFICATION POLICY (D5 completion)
// ═══════════════════════════════════════════════════════════════════════════

describe('CMDA §C · one verification policy owns every transition to verified', () => {
  const archived = { archivedInRepo: true, sha256: SHA, documentClass: 'module_datasheet' as const };

  it('10. verifying without governed actor / kind / basis is rejected', () => {
    expect(validateVerificationTransition({ ...archived, verificationState: 'verified' }).ok).toBe(false);
    expect(validateVerificationTransition({
      ...archived, verificationState: 'verified', verificationActor: 'Dana Reyes',
    }).ok).toBe(false);   // no kind, no basis
    expect(validateVerificationTransition({
      ...archived, verificationState: 'verified', verificationActor: 'Dana Reyes',
      verificationActorKind: 'human',
    }).ok).toBe(false);   // no basis
    // custody is not verification
    expect(validateVerificationTransition({
      documentClass: 'module_datasheet', archivedInRepo: false, sha256: null,
      verificationState: 'verified', verificationActor: 'Dana Reyes',
      verificationActorKind: 'human', verificationBasis: 'checked',
    }).ok).toBe(false);
    // a RESOLVER may not verify a module datasheet — machine retrieval
    // establishes bytes, never licensed applicability
    expect(validateVerificationTransition({
      ...archived, verificationState: 'verified', verificationActor: 'racking-documents@v1',
      verificationActorKind: 'resolver', verificationBasis: 'fetched',
    }).ok).toBe(false);
  });

  it('10b. governed verification evidence succeeds', () => {
    const r = validateVerificationTransition({
      ...archived, verificationState: 'verified', verificationActor: 'Dana Reyes',
      verificationActorKind: 'human',
      verificationBasis: 'Compared against the manufacturer download; page 2 table checked.',
    });
    expect(r.ok).toBe(true);
  });

  it('10c. a non-verified transition needs no actor evidence', () => {
    expect(validateVerificationTransition({ ...archived, verificationState: 'in_review' }).ok).toBe(true);
    expect(validateVerificationTransition({ ...archived, verificationState: 'rejected' }).ok).toBe(true);
  });

  it('verification alone still does not establish module coverage', () => {
    // the SAME row that passes the verification policy fails applicability
    const verified = doc({}, null);
    expect(validateVerificationTransition({
      documentClass: verified.documentClass, archivedInRepo: true, sha256: verified.sha256,
      verificationState: 'verified', verificationActor: 'Dana Reyes',
      verificationActorKind: 'human', verificationBasis: 'checked',
    }).ok).toBe(true);
    expect(evalWith(verified).clears).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §D — SINGLE-SOURCE PROJECTION, END TO END THROUGH THE REAL ENGINE
// ═══════════════════════════════════════════════════════════════════════════

describe('CMDA §D · every consumer projects ONE frozen authority', () => {
  const MODEL = 'Q CELLS Q.PEAK DUO BLK ML-G10+ 400W';

  /** A guarded read that serves the governed Q CELLS row and nothing else. */
  function moduleRegistryRead(rows: RegistryDocument[]): SafeDbRead {
    return async (label, _r, failSoftTo) => {
      if (label.startsWith('findVerifiedDocument(module_datasheet')) {
        const picked = pickVerifiedDocument(rows, {
          documentClass: 'module_datasheet', equipmentModel: MODEL,
          selectedWatts: 400, requireModuleDatasheetCoverage: true,
        });
        return { value: picked as never, ok: true, error: null };
      }
      return { value: failSoftTo, ok: false, error: 'offline (test)' };
    };
  }

  async function build(rows: RegistryDocument[], mutate?: (i: Record<string, unknown>) => void) {
    const input = JSON.parse(JSON.stringify(braidonOriginalAuditFixture)) as Record<string, unknown>;
    input.generatedAtIso = '2026-08-07T12:00:00.000Z';
    input.projectId = 'c0ffee00-0000-4000-8000-00000000000a';
    (input.project as Record<string, unknown>).projectName = 'CMDA CONTROLLED FIXTURE';
    (input.project as Record<string, unknown>).designer = 'Dana Reyes';
    mutate?.(input);
    const authority = await resolveSnapshotAuthorityInputs(input as never, {
      safeDbRead: moduleRegistryRead(rows), nowIso: '2026-08-07T12:00:00.000Z', providers: {},
    });
    const html = generatePermitHTML(input as never, undefined, authority as never);
    const snap = (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
    return { snap, html, digest: snap.meta.digest };
  }

  /** the governed row, matched to the fixture's actual module model */
  const row = (over: Partial<RegistryDocument> = {}) => doc({
    equipmentModelApplicability: MODEL,
    ...over,
  }, familyClaims({ modelsCovered: [MODEL], productFamily: 'Q CELLS Q.PEAK DUO BLK ML-G10+' }));

  it('11. DS-1 and RG-2 consume the SAME frozen canonical object', async () => {
    const b = await build([row()]);
    const authority = b.snap.moduleDocumentAuthority;
    expect(authority, 'the snapshot must carry the canonical authority').toBeTruthy();
    const entries = Object.values(authority!);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(Object.isFrozen(e)).toBe(true);

    // the resolver's binding row and the snapshot map are the SAME instance —
    // not two equal-looking recomputations
    const binding = b.snap.resolutionAuthority?.moduleDatasheetBinding;
    expect(binding).toBeTruthy();
    for (const m of binding!.modules) {
      expect(authority![m.moduleModel]).toBe(m.applicability);
    }

    // RG-2 / readiness: the blocker set is a pure function of that authority
    const open = b.snap.permitReadiness.registry
      .filter(r => r.code === 'MODULE-EXACT-DATASHEET-PENDING' && !r.resolved);
    const uncleared = entries.filter(e => !e.clears);
    expect(open.length).toBe(uncleared.length);

    // DS-1: the page prints the canonical headline, and never the false demand
    if (uncleared.length === 0) {
      expect(b.html).toContain('FAMILY COVERAGE VERIFIED');
      expect(b.html).not.toContain('Attach the exact');
    }
  }, 300_000);

  it('12. the BOM module row follows the canonical authority, not a static title', async () => {
    const covered = await build([row()]);
    const notCovered = await build([row({}, ) as RegistryDocument].map(d => ({
      ...d, extractedClaims: familyClaims({ explicitWattageRange: { minWatts: 500, maxWatts: 600 }, wattagesCovered: [550], variantsCovered: [] }),
    })) as RegistryDocument[]);
    const openOf = (s: PermitDesignSnapshot) => s.permitReadiness.registry
      .filter(r => r.code === 'MODULE-EXACT-DATASHEET-PENDING' && !r.resolved).length;
    // the SAME static asset title is on file in both runs; only the governed
    // claims differ, and only the governed claims may move the BOM gate.
    expect(openOf(covered.snap)).toBe(0);
    expect(openOf(notCovered.snap)).toBeGreaterThan(0);
  }, 300_000);

  it('13. changing the selected module wattage re-evaluates and moves the digest', async () => {
    const a = await build([row()]);
    const b = await build([row()], i => {
      for (const inv of ((i.system as Record<string, unknown>)?.inverters as Record<string, unknown>[] ?? [])) {
        for (const s of ((inv?.strings as Record<string, unknown>[]) ?? [])) {
          if (typeof s?.panelWatts === 'number') s.panelWatts = 410;
        }
      }
    });
    expect(b.digest).not.toBe(a.digest);
    const bAuth = Object.values(b.snap.moduleDocumentAuthority ?? {});
    expect(bAuth.some(x => !x.clears)).toBe(true);   // 410 W is outside 385–405
  }, 300_000);

  it('13b. a different registry SHA-256 moves the digest', async () => {
    const a = await build([row()]);
    const b = await build([row({ sha256: 'b'.repeat(64) })]);
    expect(b.digest).not.toBe(a.digest);
  }, 300_000);

  it('13c. revoking verification reopens the requirement and moves the digest', async () => {
    const a = await build([row()]);
    const b = await build([row({ verificationState: 'unverified' as RegistryDocument['verificationState'] })]);
    expect(b.digest).not.toBe(a.digest);
    expect(b.snap.permitReadiness.registry
      .filter(r => r.code === 'MODULE-EXACT-DATASHEET-PENDING' && !r.resolved).length).toBeGreaterThan(0);
  }, 300_000);

  it('14. a no-op re-evaluation is digest- and byte-stable', async () => {
    const a = await build([row()]);
    const b = await build([row()]);
    expect(b.digest).toBe(a.digest);
    expect(b.html).toBe(a.html);
    expect(JSON.stringify(b.snap.moduleDocumentAuthority))
      .toBe(JSON.stringify(a.snap.moduleDocumentAuthority));
  }, 300_000);
});
