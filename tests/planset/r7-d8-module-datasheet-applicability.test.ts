// ═══════════════════════════════════════════════════════════════════════════
// D8 — MODULE-DATASHEET APPLICABILITY: ONE EVALUATOR, AND EXACTNESS IS EARNED.
//
// THE DEFECT, AS IT ACTUALLY STOOD ON THE LIVE ASSET LIBRARY. Exactness was
// decided by the ABSENCE of a regex match on a marketing title:
//
//     const m = docTitle.match(/(\d{3,4})\s*[–—-]\s*(\d{3,4})\s*W/i);
//     if (m) { … FAMILY-DATASHEET-PENDING … }
//     return { isExact: true, stateLabel: 'EXACT', coversSelectedWatts: true };
//
// Five of the fifteen `module_spec` assets fall through that `if`, and four of
// them are demonstrably NOT exact-model sheets:
//
//   Tesla   "Tesla Solar Panel Datasheet (TSP-415/TSP-420)"        ← ONE sheet, TWO models
//   LONGi   "LONGi Hi-MO 6 Explorer LR5-72HTD 550-580M Datasheet"  ← a range with no `W`
//   Panasonic "Panasonic EverVolt H Series 410W/400W Datasheet"    ← a two-wattage sheet
//
// The consequence was not cosmetic. `EXACT` counted as `bound`, so:
//   • `collectEquipmentDocumentBlockers` emitted NOTHING — the readiness registry
//     never received a MODULE-EXACT-DATASHEET-PENDING record, so RG-2 had no
//     requirement to fail on and passed vacuously;
//   • `evaluateModuleDatasheetBinding` reported `allBound: true` from an empty
//     archive, with no registry lookup performed at all;
//   • the resolver returned RESOLVED / cleared / confidence 1 and MINTED an audit
//     ref whose sourceRef was `document:asset#<model>` — a citation naming a
//     static asset, which D7 established carries no hash and no verification.
//   • DS-n rendered NO banner, presenting a two-model sheet as the exact sheet.
//
// A THIRD hole, in the same evaluator: a module with NO document on file emitted
// no blocker either (only `FAMILY-DATASHEET-PENDING` did), so the two evaluators
// disagreed — the binding said "not bound", the readiness registry said nothing.
//
// THE RULE THESE TESTS PIN. A static asset can never establish exactness; only a
// VERIFIED registry document can. The title parser explains the gap, it does not
// decide authority. `allBound` is false without registry facts, always.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  resolveModuleDatasheetExactness, collectEquipmentDocumentBlockers,
} from '@/lib/permit/snapshot/equipmentProjection';
import { evaluateModuleDatasheetBinding } from '@/lib/permit/snapshot/resolution/datasheetBinding';
import type { PermitInput } from '@/lib/permit/types';

/** the smallest input `collectEquipmentDocumentBlockers` and the binding read. */
function fleet(...panels: Array<[string, number]>): PermitInput {
  return {
    system: {
      inverters: [{
        type: 'micro', manufacturer: 'Enphase', model: 'IQ8A',
        strings: panels.map(([panelModel, panelWatts]) => ({ panelModel, panelWatts, count: 10 })),
      }],
    },
  } as unknown as PermitInput;
}

const MODULE_CODE = 'MODULE-EXACT-DATASHEET-PENDING';
const moduleBlockers = (input: PermitInput) =>
  collectEquipmentDocumentBlockers(input).filter(b => b.code === MODULE_CODE);

// ── CMDA — D8's seam, STRENGTHENED ──────────────────────────────────────────
// D8 made a bound document id the only route to EXACT. CMDA went further: a
// bound id is no longer sufficient either, because the row it names may never
// have been checked against the selected variant. The lookup now carries the
// CANONICAL verdict, and these helpers say which one they mean.
const DOC_ID = 'doc-qcells-peak-duo-400w-9a1c4f2e0bd7';

/** a governed lookup whose claims genuinely cover the selection. */
const BOUND = (a?: { model: string; watts: number | null }) => ({
  boundDocumentId: DOC_ID,
  failure: null,
  applicability: {
    selectedEquipmentId: null, selectedManufacturer: 'Q CELLS', selectedModel: a?.model ?? null, selectedWatts: a?.watts ?? null,
    documentId: DOC_ID, documentClass: 'module_datasheet',
    documentTitle: 'Q CELLS Q.PEAK DUO BLK ML-G10+ 385-405W Datasheet',
    sha256: 'a'.repeat(64), archivedInRepo: true, status: 'current',
    verificationState: 'verified', verificationActor: 'Dana Reyes', verificationBasis: 'page 2 table checked',
    state: 'FAMILY_COVERED' as const, clears: true,
    coveredRange: { minWatts: 385, maxWatts: 405 }, coveredWattages: [385, 400, 405], coveredModels: [a?.model ?? ''],
    evidenceLocation: 'page 2, table Electrical Characteristics', applicabilityBasis: 'family datasheet',
    refusals: [],
    basis: `registry document '${DOC_ID}' explicitly covers 385–405 W, which includes ${a?.watts ?? '?'} W`,
  },
});

/** CMDA — the D8-era shape: an id and nothing else. It must NOT clear. */
const BOUND_ID_ONLY = (a?: { model: string; watts: number | null }) => ({
  boundDocumentId: DOC_ID,
  failure: null,
  applicability: {
    selectedEquipmentId: null, selectedManufacturer: null, selectedModel: a?.model ?? null, selectedWatts: a?.watts ?? null,
    documentId: DOC_ID, documentClass: 'module_datasheet', documentTitle: null,
    sha256: 'a'.repeat(64), archivedInRepo: true, status: 'current',
    verificationState: 'verified', verificationActor: 'Dana Reyes', verificationBasis: null,
    state: 'EVIDENCE_INCOMPLETE' as const, clears: false,
    coveredRange: null, coveredWattages: null, coveredModels: null,
    evidenceLocation: null, applicabilityBasis: null,
    refusals: ['the document carries no structured module applicability claims'],
    basis: 'the document is governed but states no structured module coverage',
  },
});

/** the live case today: credential blocked, no registry row for any module. */
const UNBOUND = (a?: { model: string; watts: number | null }) => ({
  boundDocumentId: null,
  failure: 'no VERIFIED, current module_datasheet is registered for this model',
  applicability: {
    selectedEquipmentId: null, selectedManufacturer: null, selectedModel: a?.model ?? null, selectedWatts: a?.watts ?? null,
    documentId: null, documentClass: null, documentTitle: null, sha256: null,
    archivedInRepo: false, status: null,
    verificationState: null, verificationActor: null, verificationBasis: null,
    state: 'NO_DOCUMENT' as const, clears: false,
    coveredRange: null, coveredWattages: null, coveredModels: null,
    evidenceLocation: null, applicabilityBasis: null,
    refusals: ['no governed module_datasheet registry document is on file for the selected module'],
    basis: 'no governed module_datasheet registry document is on file for the selected module',
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 — EXACTNESS IS EARNED FROM THE REGISTRY, NEVER FROM A TITLE
// ═══════════════════════════════════════════════════════════════════════════

describe('D8 · a static asset can never establish exactness', () => {
  it('1 — the Tesla sheet covers TSP-415 AND TSP-420, and is no longer reported EXACT', () => {
    const ex = resolveModuleDatasheetExactness('Solar Panel TSP-415', 415);
    expect(ex.asset).not.toBeNull();
    expect(ex.stateLabel).not.toBe('EXACT');
    expect(ex.isExact).toBe(false);
    // the reason names the real situation, not "pending"
    expect(ex.missingDocument).toBeTruthy();
  });

  it('2 — a module whose title states NOTHING about coverage is unproven, not exact', () => {
    const ex = resolveModuleDatasheetExactness('SIL-430 BG', 430);
    expect(ex.asset).not.toBeNull();
    // Silfab's sheet genuinely IS the single-wattage sheet — but nothing in the
    // repository proves that, so the honest state is unevidenced, not exact.
    expect(ex.stateLabel).toBe('UNEVIDENCED-DATASHEET-PENDING');
    expect(ex.isExact).toBe(false);
    expect(ex.exactnessAuthority).toBe('none');
    expect(ex.coverageBasis).toMatch(/no hash|no verification|carries no/i);
  });

  it('3 — a VERIFIED registry binding is what makes a module EXACT', () => {
    const ex = resolveModuleDatasheetExactness('Q.PEAK DUO BLK ML-G10+ 400W', 400, {
      boundDocumentId: 'doc-qcells-peak-duo-400w-9a1c4f2e0bd7',
    });
    expect(ex.stateLabel).toBe('EXACT');
    expect(ex.isExact).toBe(true);
    expect(ex.exactnessAuthority).toBe('registry');
    expect(ex.missingDocument).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — THE TITLE PARSER: IT EXPLAINS THE GAP, IT DOES NOT DECIDE AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════

describe('D8 · family coverage the old parser could not see', () => {
  it('4 — "550-580M" is a series range even without a W suffix (LONGi)', () => {
    const ex = resolveModuleDatasheetExactness('Hi-MO 6 580W', 580);
    expect(ex.familyRange).toEqual([550, 580]);
    expect(ex.coversSelectedWatts).toBe(true);
    expect(ex.stateLabel).toBe('FAMILY-DATASHEET-PENDING');
  });

  it('5 — "410W/400W" is a two-wattage sheet, not an exact-model sheet (Panasonic)', () => {
    const ex = resolveModuleDatasheetExactness('EverVolt HK Black 410W', 410);
    expect(ex.familyWattages).toEqual([400, 410]);
    expect(ex.coversSelectedWatts).toBe(true);
    expect(ex.stateLabel).toBe('FAMILY-DATASHEET-PENDING');
  });

  it('6 — "(TSP-415/TSP-420)" is a two-MODEL sheet, and the basis says so (Tesla)', () => {
    const ex = resolveModuleDatasheetExactness('Solar Panel TSP-420', 420);
    expect(ex.familyModels).toEqual(['TSP-415', 'TSP-420']);
    expect(ex.stateLabel).toBe('FAMILY-DATASHEET-PENDING');
    expect(ex.coverageBasis).toMatch(/TSP-415/);
  });

  it('7 — a year span is NOT a wattage range (the plausibility guard)', () => {
    // A looser range regex without a band guard reads "2024-2025" as 2024-2025 W.
    const ex = resolveModuleDatasheetExactness('__probe__', 400, null, {
      id: 'module_spec:__probe__', category: 'module_spec', equipmentId: '__probe__',
      brand: 'Probe', model: 'Probe 400W', assetType: 'pdf',
      sourceUrl: null, pageRef: null, imageUrl: null,
      docTitle: 'Probe Series 2024-2025 Product Guide', verified: true, notes: null,
    });
    expect(ex.familyRange).toBeNull();
    expect(ex.stateLabel).toBe('UNEVIDENCED-DATASHEET-PENDING');
  });

  // BRAIDON PDF AUDIT 2026-08-27 (N1/N2) — the RULE this case pins is unchanged: a SERIES sheet
  // is never an exact-model sheet, so the verdict stays FAMILY-DATASHEET-PENDING and the parsed
  // family range must cover the selected 400 W. Only the registered DOCUMENT changed, deliberately.
  // The asset row's docTitle said "385-405W" while its sourceUrl was ZZ304800120 = the 395-415 Wp
  // sheet — two different documents with two different 400 W columns — and the archived image was
  // page 1 (marketing) with no spec table at all. equipment-db separately cited ZZ304800232
  // (385-405). Everything is now aligned on ZZ304800120 Rev06 2023-12, the current revision and
  // the one actually archived, so the parsed range moves 385-405 → 395-415. 400 W remains inside it.
  it('8 — the Qcells series sheet is a FAMILY sheet covering 400 W, never an exact-model sheet', () => {
    const ex = resolveModuleDatasheetExactness('Q.PEAK DUO BLK ML-G10+ 400W', 400);
    expect(ex.stateLabel).toBe('FAMILY-DATASHEET-PENDING');
    expect(ex.familyRange).toEqual([395, 415]);
    expect(ex.familyRange![0]).toBeLessThanOrEqual(400);
    expect(ex.familyRange![1]).toBeGreaterThanOrEqual(400);
    expect(ex.coversSelectedWatts).toBe(true);
    expect(ex.coverageBasis).toMatch(/INSIDE/);
    const outside = resolveModuleDatasheetExactness('Q.PEAK DUO BLK ML-G10+ 400W', 500);
    expect(outside.coversSelectedWatts).toBe(false);
    expect(outside.coverageBasis).toMatch(/OUTSIDE/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — ONE EVALUATOR: THE REGISTRY AND THE READINESS REGISTRY MUST AGREE
// ═══════════════════════════════════════════════════════════════════════════

describe('D8 · every module gap reaches the readiness registry', () => {
  it('9 — a module with NO document on file emits a blocker (it emitted nothing)', () => {
    const b = moduleBlockers(fleet(['Totally Unknown Module 999W', 999]));
    expect(b).toHaveLength(1);
    // CMDA — with no registry evaluation this path states the honest fact and
    // stops. It used to describe the on-file ASSET from its marketing title,
    // which was a second applicability decision made from the weakest evidence.
    expect(b[0].explanation).toMatch(/NOT ESTABLISHED on this path/i);
  });

  it('10 — a multi-model static sheet emits a blocker (it emitted nothing)', () => {
    const b = moduleBlockers(fleet(['Solar Panel TSP-415', 415]));
    expect(b).toHaveLength(1);
  });

  it('11 — an unevidenced static sheet emits a blocker naming what is unproven', () => {
    const b = moduleBlockers(fleet(['SIL-430 BG', 430]));
    expect(b).toHaveLength(1);
    expect(b[0].explanation).toMatch(/no hash|unverified|not established/i);
  });

  it('12 — the Braidon module still emits exactly one, and claims nothing from a title', () => {
    const b = moduleBlockers(fleet(['Q.PEAK DUO BLK ML-G10+ 400W', 400]));
    expect(b).toHaveLength(1);
    // CMDA — the blocker no longer asserts what the on-file document IS
    // ("the 385–405 W family datasheet") from a static asset's title. Whether a
    // family sheet covers 400 W is a governed-claims question, and this path has
    // not asked it.
    expect(b[0].explanation).toMatch(/NOT ESTABLISHED on this path/i);
    expect(b[0].explanation).not.toMatch(/385–405 W family datasheet/);
    expect(b[0].authorityPath).toBe('snapshot.moduleDocumentAuthority (canonical module applicability)');
  });

  it('13 — one blocker per DISTINCT module, never per string', () => {
    const b = moduleBlockers(fleet(
      ['Q.PEAK DUO BLK ML-G10+ 400W', 400],
      ['Q.PEAK DUO BLK ML-G10+ 400W', 400],
      ['Solar Panel TSP-415', 415],
    ));
    expect(b).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — allBound IS FALSE WITHOUT REGISTRY FACTS
// ═══════════════════════════════════════════════════════════════════════════

describe('D8 · the binding never reports bound from an empty archive', () => {
  it('14 — offline (no lookup at all): every module pending, allBound false', () => {
    const b = evaluateModuleDatasheetBinding(fleet(
      ['Solar Panel TSP-415', 415],
      ['Hi-MO 6 580W', 580],
      ['Q.PEAK DUO BLK ML-G10+ 400W', 400],
    ));
    expect(b.allBound).toBe(false);
    expect(b.boundModels).toEqual([]);
    expect(b.pendingModels).toHaveLength(3);
    for (const m of b.modules) expect(m.exactnessAuthority).toBe('none');
  });

  it('15 — a lookup that finds nothing is still not bound', () => {
    const b = evaluateModuleDatasheetBinding(fleet(['Solar Panel TSP-415', 415]), UNBOUND);
    expect(b.allBound).toBe(false);
    expect(b.modules[0].registryLookup.attempted).toBe(true);
    expect(b.modules[0].registryLookup.failure).toMatch(/no VERIFIED/);
  });

  it('16 — a GOVERNED lookup binds, and a bare document id does not', () => {
    const b = evaluateModuleDatasheetBinding(fleet(['Q.PEAK DUO BLK ML-G10+ 400W', 400]), BOUND);
    expect(b.allBound).toBe(true);
    // CMDA — a family document that explicitly covers the selection IS the
    // source. `RANGE-COVERED` is the cleared state; demanding a single-wattage
    // PDF was the false requirement this replaces.
    expect(b.modules[0].state).toBe('RANGE-COVERED');
    expect(b.modules[0].applicability.state).toBe('FAMILY_COVERED');
    expect(b.modules[0].applicability.clears).toBe(true);
    expect(b.modules[0].exactnessAuthority).toBe('registry');
    expect(b.modules[0].registryLookup.boundDocumentId).toBe('doc-qcells-peak-duo-400w-9a1c4f2e0bd7');
    expect(b.modules[0].missingDocument).toBeNull();

    // …and the D8-era shape — an id with no governed claims — does NOT bind.
    const weak = evaluateModuleDatasheetBinding(fleet(['Q.PEAK DUO BLK ML-G10+ 400W', 400]), BOUND_ID_ONLY);
    expect(weak.allBound).toBe(false);
    expect(weak.modules[0].registryLookup.boundDocumentId).toBe('doc-qcells-peak-duo-400w-9a1c4f2e0bd7');
    expect(weak.modules[0].applicability.clears).toBe(false);
  });

  it('17a — the readiness registry honours a REGISTRY binding, and only that', () => {
    const input = fleet(['Solar Panel TSP-415', 415]);
    // no binding: the gap is raised from static evidence
    expect(moduleBlockers(input)).toHaveLength(1);
    // a registry binding for THIS model establishes the source
    expect(collectEquipmentDocumentBlockers(input, {
      modules: [{
        moduleModel: 'Solar Panel TSP-415',
        registryLookup: { boundDocumentId: 'doc-tesla-1' },
        applicability: { clears: true, state: 'FAMILY_COVERED', basis: 'covers 415 W', selectedWatts: 415, documentId: 'doc-tesla-1' },
      }],
    }).filter(b => b.code === MODULE_CODE)).toHaveLength(0);
    // CMDA — a bound id with NO governed verdict establishes nothing
    expect(collectEquipmentDocumentBlockers(input, {
      modules: [{
        moduleModel: 'Solar Panel TSP-415',
        registryLookup: { boundDocumentId: 'doc-tesla-1' },
        applicability: { clears: false, state: 'EVIDENCE_INCOMPLETE', basis: 'no module claims', selectedWatts: 415, documentId: 'doc-tesla-1' },
      }],
    }).filter(b => b.code === MODULE_CODE)).toHaveLength(1);
    // a binding that ATTEMPTED and found nothing establishes nothing
    expect(collectEquipmentDocumentBlockers(input, {
      modules: [{
        moduleModel: 'Solar Panel TSP-415',
        registryLookup: { boundDocumentId: null },
        applicability: { clears: false, state: 'NO_DOCUMENT', basis: 'nothing on file', selectedWatts: 415, documentId: null },
      }],
    }).filter(b => b.code === MODULE_CODE)).toHaveLength(1);
  });

  it('17b — a binding for one model cannot suppress the gap on another', () => {
    const b = collectEquipmentDocumentBlockers(
      fleet(['Solar Panel TSP-415', 415], ['Q.PEAK DUO BLK ML-G10+ 400W', 400]),
      { modules: [{
        moduleModel: 'Solar Panel TSP-415',
        registryLookup: { boundDocumentId: 'doc-tesla-1' },
        applicability: { clears: true, state: 'FAMILY_COVERED', basis: 'covers 415 W', selectedWatts: 415, documentId: 'doc-tesla-1' },
      }] },
    ).filter(x => x.code === MODULE_CODE);
    expect(b).toHaveLength(1);
    expect(b[0].explanation).toMatch(/Q\.PEAK/);
  });

  it('17 — one bound module does not bind the others', () => {
    const b = evaluateModuleDatasheetBinding(
      fleet(['Q.PEAK DUO BLK ML-G10+ 400W', 400], ['Solar Panel TSP-415', 415]),
      ({ model }) => (/Q\.PEAK/i.test(model) ? BOUND() : UNBOUND()),
    );
    expect(b.allBound).toBe(false);
    expect(b.boundModels).toEqual(['Q.PEAK DUO BLK ML-G10+ 400W']);
    expect(b.pendingModels).toEqual(['Solar Panel TSP-415']);
  });
});
