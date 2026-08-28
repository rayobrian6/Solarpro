// ═══════════════════════════════════════════════════════════════════════════
// THE SHIPPED MANUFACTURER DATASHEET CATALOGUE (2026-08-28)
//
// MODULE-EXACT-DATASHEET-PENDING fired on every package whose module had no
// governed registry row, and its only clearance was an operator archiving the
// manufacturer's datasheet by hand, per project. The Qcells Q.PEAK DUO BLK
// ML-G10+ sheet is the same document for every job in the country that uses that
// module, so SolarPro ships it.
//
// The point of these tests is that it changes NO predicate. The shipped record
// is projected into a RegistryDocument and handed to the SAME evaluator, so
// every refusal it enforces is still enforced — asserted here one at a time.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  MANUFACTURER_DATASHEET_CATALOGUE, findManufacturerDatasheet, toRegistryDocumentFromCatalogue,
} from '@/lib/documents/manufacturerDatasheetCatalogue';
import { evaluateModuleDatasheetApplicability } from '@/lib/permit/snapshot/moduleDocumentAuthority';
import type { RegistryDocument } from '@/lib/documents/types';
import { getPanelById } from '@/lib/equipment-db';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const SELECTED = {
  equipmentId: 'qcells-peak-duo-400',
  manufacturer: 'Q CELLS',
  model: 'Q.PEAK DUO BLK ML-G10+ 400W',
  watts: 400,
};
const DOC = () => toRegistryDocumentFromCatalogue(findManufacturerDatasheet(SELECTED))!;
const evalWith = (over: Partial<RegistryDocument> = {}) =>
  evaluateModuleDatasheetApplicability({ selected: SELECTED, document: { ...DOC(), ...over } });

describe('the archived datasheet is what it claims to be', () => {
  it('carries full custody — identity, revision, source URL, hash and an in-repo path', () => {
    const d = findManufacturerDatasheet(SELECTED)!;
    expect(d.documentClass).toBe('module_datasheet');
    expect(d.manufacturer).toBe('Q CELLS');
    expect(d.revision).toBe('Rev06_NA');
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.sourceUrl).toMatch(/^https:\/\//);
    expect(d.archivedPath).toMatch(/^public\/manufacturer-assets\/datasheets\//);
  });

  it('the archived bytes on disk match the recorded SHA-256', async () => {
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { resolve } = await import('node:path');
    const d = findManufacturerDatasheet(SELECTED)!;
    const bytes = readFileSync(resolve(process.cwd(), d.archivedPath));
    expect(bytes.byteLength).toBe(d.byteLength);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(d.sha256);
  });

  it('THE TRAP: it is the 395-415 Rev06 sheet, not the 385-405 one', () => {
    // Qcells publishes TWO ML-G10+ sheets whose ranges overlap at 400 W with
    // DIFFERENT numbers (385-405 Rev01: Isc 11.14 / Voc 45.30). The catalogue
    // record, its datasheetUrl and this document must be the SAME sheet.
    const d = findManufacturerDatasheet(SELECTED)!;
    expect(d.explicitWattageRange).toEqual({ minWatts: 395, maxWatts: 415 });
    expect(d.wattagesCovered).toContain(400);
    expect(d.wattagesCovered).not.toContain(385);
    const panel = getPanelById('qcells-peak-duo-400')!;
    // the numbers the product publishes are THIS sheet's 400 W column
    expect(panel.voc).toBe(45.24);
    expect(panel.isc).toBe(11.05);
    expect(d.applicabilityBasis).toContain('11.05');
    expect(d.applicabilityBasis).toContain('45.24');
  });

  it('records WHERE the coverage was read — a claim with no location is unauditable', () => {
    for (const d of MANUFACTURER_DATASHEET_CATALOGUE) {
      expect(d.evidence.page).toBeGreaterThan(0);
      expect(d.evidence.table.length).toBeGreaterThan(10);
      expect(d.electricalMechanicalSpecificationsPresent).toBe(true);
    }
  });
});

describe('the evaluator still refuses everything it used to', () => {
  it('CLEARS on the correct document (the positive control)', () => {
    const v = evalWith();
    expect(v.clears).toBe(true);
    expect(['EXACT_VARIANT', 'FAMILY_COVERED']).toContain(v.state);
  });

  it('WRONG CLASS — a document that is not a module_datasheet clears nothing', () => {
    expect(evalWith({ documentClass: 'inverter_datasheet' }).clears).toBe(false);
  });

  it('NOT CURRENT / NOT ARCHIVED / NO HASH — custody is still required', () => {
    expect(evalWith({ status: 'superseded' }).clears).toBe(false);
    expect(evalWith({ archivedInRepo: false }).clears).toBe(false);
    expect(evalWith({ sha256: null }).clears).toBe(false);
    expect(evalWith({ sha256: 'not-a-hash' }).clears).toBe(false);
  });

  it('NOT VERIFIED — an unverified row clears nothing', () => {
    expect(evalWith({ verificationState: 'in_review' }).clears).toBe(false);
  });

  it('NO COVERAGE CLAIM — a document with no module claims clears nothing', () => {
    expect(evalWith({ extractedClaims: null }).clears).toBe(false);
  });

  it('OUT OF RANGE — a wattage the sheet does not cover is NOT_COVERED', () => {
    const v = evaluateModuleDatasheetApplicability({
      selected: { ...SELECTED, watts: 550 }, document: DOC(),
    });
    expect(v.clears).toBe(false);
  });

  it('A BROCHURE clears nothing, even with a range', () => {
    const doc = DOC();
    const claims = clone(doc.extractedClaims)!;
    claims.module!.electricalMechanicalSpecificationsPresent = false;
    expect(evalWith({ extractedClaims: claims }).clears).toBe(false);
  });

  it('NO DOCUMENT at all is NO_DOCUMENT, never a silent pass', () => {
    const v = evaluateModuleDatasheetApplicability({ selected: SELECTED, document: null });
    expect(v.clears).toBe(false);
    expect(v.state).toBe('NO_DOCUMENT');
  });
});

describe('lookup is by IDENTITY, never a substring', () => {
  it('finds the sheet by catalogue equipment id and by exact model', () => {
    expect(findManufacturerDatasheet({ equipmentId: 'qcells-peak-duo-400' })).toBeTruthy();
    expect(findManufacturerDatasheet({ model: 'Q.PEAK DUO BLK ML-G10+ 400W' })).toBeTruthy();
  });

  it('a SUBSTRING never matches — the defect moduleDocumentAuthority was written to end', () => {
    expect(findManufacturerDatasheet({ model: 'Q.PEAK' })).toBeNull();
    expect(findManufacturerDatasheet({ model: 'ML-G10' })).toBeNull();
    expect(findManufacturerDatasheet({ equipmentId: 'qcells' })).toBeNull();
    expect(findManufacturerDatasheet({ model: 'Q.PEAK DUO BLK ML-G10+ 400W EXTRA' })).toBeNull();
  });

  it('an unrelated module finds nothing', () => {
    expect(findManufacturerDatasheet({ equipmentId: 'silfab-sil430' })).toBeNull();
  });
});

describe('the live Braidon package', () => {
  const build = () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    const html = generatePermitHTML(input as never);
    return { html, snap: (input as { _snapshot?: PermitDesignSnapshot })._snapshot! };
  };

  it('MODULE-EXACT-DATASHEET-PENDING clears, and clears from a resolved document', () => {
    const { snap } = build();
    expect(snap.permitReadiness.registry.map(r => r.code))
      .not.toContain('MODULE-EXACT-DATASHEET-PENDING');
    // ANTI-VACUITY: the shipped document really does cover the selected module.
    const v = evalWith();
    expect(v.clears).toBe(true);
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.evidenceLocation).toBeTruthy();
  });
});
