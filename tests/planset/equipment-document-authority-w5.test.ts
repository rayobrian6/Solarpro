// ═══════════════════════════════════════════════════════════════════════════
// W5 — Exact equipment & document authority (repair pass 2026-07-22, gates 9-10).
//   • APP-A rendered micro values == the verified equipment/document record.
//   • Split-thermal-basis detector: two distinct design temps in one package = fail.
//   • SKU sweep: IQ8A-72-2-US only.
//   • DS-1 exact-vs-family module document state.
// Pure-record tests + package-level scans (generate + parse the RENDERED output).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  projectMicroinverterDatasheet,
  resolveModuleDatasheetExactness,
  collectEquipmentDocumentBlockers,
} from '@/lib/permit/snapshot/equipmentProjection';
import { getThermalDesignBasis } from '@/lib/permit/utils/designTemps';
import { getMicroinverterById } from '@/lib/equipment-db';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// An IQ8A + Qcells-400 micro-roof package matching the Braidon design shape.
function braidonLikeInput(): any {
  const input: any = clone(roofProject);
  input.project = input.project ?? {};
  input.project.state = 'IL';
  input.project.address = '123 Test Ave, Granite City IL 62040';
  input.project.mountingSystemId = 'rooftech-mini';   // RT-MINI: rail_paired, rail SKU unpinned
  delete input.project.designTempMin;
  input.system.topology = 'micro';
  const inv = input.system.inverters[0];
  inv.manufacturer = 'Enphase';
  inv.model = 'IQ8A';
  inv.type = 'micro';
  inv.acOutputKw = 0.349;
  inv.maxDcVoltage = 60;
  for (const s of inv.strings ?? []) {
    s.panelManufacturer = 'Q CELLS';
    s.panelModel = 'Q.PEAK DUO BLK ML-G10+ 400W';
    s.panelWatts = 400;
    s.panelVoc = 41.6;
    s.panelIsc = 12.26;
  }
  return input;
}

// ─── 1. Equipment record reconciled to the verified datasheet ────────────────

describe('W5 §1 — IQ8A equipment-db record == verified datasheet values', () => {
  it('carries the datasheet-verified scalar specs + exact SKU', () => {
    const rec = getMicroinverterById!('enphase-iq8a')!;
    expect(rec).toBeTruthy();
    expect(rec.acOutputVaPeak).toBe(366);       // peak VA
    expect(rec.acOutputW).toBe(349);            // continuous VA
    expect(rec.acOutputCurrentMax).toBe(1.45);  // A max continuous
    expect(rec.cec_efficiency).toBe(97.5);      // CEC weighted
    expect(rec.weight).toBe(2.38);              // lb
    expect(rec.partNumber).toBe('IQ8A-72-2-US');
    expect(rec.connectorType).toBe('MC4');
    // the old hand-entered parallel values are gone
    expect(rec.acOutputCurrentMax).not.toBe(1.46);
    expect(rec.cec_efficiency).not.toBe(96.5);
    expect(rec.weight).not.toBe(2.2);
  });
});

describe('W5 §1 — projection carries each value with document provenance', () => {
  const p = projectMicroinverterDatasheet('IQ8A');
  it('resolves the record + verified document', () => {
    expect(p.resolved).toBe(true);
    expect(p.sku).toBe('IQ8A-72-2-US');
    expect(p.documentRecordId).toBe('microinverter_spec:enphase-iq8a');
    expect(p.documentVerified).toBe(true);
  });
  it('projects the exact datasheet values', () => {
    expect(p.fields.peakVa.value).toBe(366);
    expect(p.fields.continuousVa.value).toBe(349);
    expect(p.fields.maxContinuousCurrentA.value).toBe(1.45);
    expect(p.fields.cecEfficiency.value).toBe(97.5);
    expect(p.fields.weightLb.value).toBe(2.38);
    expect(p.fields.connector.value).toBe('MC4');
  });
  it('stamps verified-document provenance + extracted field path on each value', () => {
    for (const key of ['peakVa', 'continuousVa', 'maxContinuousCurrentA', 'cecEfficiency', 'weightLb'] as const) {
      const f = p.fields[key];
      expect(f.provenance.verification).toBe('verified-document');
      expect(f.provenance.equipmentRecordId).toBe('enphase-iq8a');
      expect(f.provenance.sku).toBe('IQ8A-72-2-US');
      expect(f.provenance.extractedFieldPath).toMatch(/equipment-db#enphase-iq8a\./);
    }
  });
});

// ─── 2. APP-A rendered output == verified document record ────────────────────

describe('W5 §1 — APP-A RENDERED micro table equals the verified record', () => {
  const html = generatePermitHTML(braidonLikeInput());

  // parse the provenance-stamped rows APP-A emits (data-app-a-field="…").
  function rowValue(fieldPathFragment: string): string | null {
    const re = new RegExp(
      `<tr[^>]*data-app-a-field="[^"]*${fieldPathFragment}[^"]*"[^>]*>\\s*<td[^>]*>[^<]*</td>\\s*<td[^>]*>([^]*?)</td>`,
      'i',
    );
    const m = html.match(re);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
  }

  it('renders peak VA 366, continuous VA 349, current 1.45 A, CEC 97.5%, weight 2.38 lb', () => {
    expect(rowValue('acOutputVaPeak')).toBe('366 VA');
    expect(rowValue('acOutputW')).toBe('349 VA');
    expect(rowValue('acOutputCurrentMax')).toMatch(/^1\.45 A/);
    expect(rowValue('cec_efficiency')).toBe('97.5%');
    expect(rowValue('weight')).toBe('2.38 lbs');
    expect(rowValue('connectorType')).toBe('MC4');
  });

  it('never prints the retired hand-entered values (1.46 A / 96.5% / 2.2 lb) or "Peak" on 349', () => {
    // peak column no longer mislabels the 349 continuous value
    expect(html).not.toMatch(/data-app-a-field="[^"]*acOutputW[^"]*"[^>]*>\s*<td[^>]*>Peak/i);
    expect(rowValue('acOutputCurrentMax')).not.toContain('1.46');
    expect(rowValue('cec_efficiency')).not.toContain('96.5');
    expect(rowValue('weight')).not.toContain('2.2 ');
  });

  it('marks the micro table as sourced from a verified document', () => {
    expect(html).toMatch(/data-app-a-source="micro-datasheet"\s+data-doc-verified="true"/);
    expect(html).toContain('IQ8A-72-2-US');
  });
});

// ─── 3. Split-thermal-basis detector (one basis per package) ─────────────────

describe('W5 §4 — singular thermal basis (no split design temperature)', () => {
  const html = generatePermitHTML(braidonLikeInput());

  it('getThermalDesignBasis(IL) is the ASHRAE −23 °C basis, not −10', () => {
    const b = getThermalDesignBasis({ state: 'IL' });
    expect(b.minDesignTempC).toBe(-23);
    expect(b.revision).toBe('ASHRAE 2021');
    expect(b.overrideApplied).toBe(false);
  });

  it('an explicit AHJ override wins and is flagged', () => {
    const b = getThermalDesignBasis({ state: 'IL', designTempMinOverrideC: -18 });
    expect(b.minDesignTempC).toBe(-18);
    expect(b.overrideApplied).toBe(true);
  });

  it('the rendered package references exactly ONE design-low temperature', () => {
    // collect every design-low annotation ("@ -23°C", "DESIGN LOW TEMP -23°C",
    // "NEC 690.7 @ -23°C"); all must agree.
    const temps = new Set<number>();
    const patterns = [
      /@\s*(-?\d+)\s*(?:°|&deg;)\s*C/gi,
      /DESIGN LOW TEMP\s*(-?\d+)\s*(?:°|&deg;)\s*C/gi,
      /690\.7[^<]{0,40}?(-?\d+)\s*(?:°|&deg;)\s*C/gi,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) temps.add(parseInt(m[1], 10));
    }
    expect(temps.size).toBeGreaterThan(0);        // there IS a design-low annotation
    expect([...temps]).toEqual([-23]);            // and it is singular + correct
    expect(html).not.toMatch(/@\s*-10\s*(?:°|&deg;)\s*C/i);  // the APP-A −10 split is gone
  });
});

// ─── 4. SKU sweep ────────────────────────────────────────────────────────────

describe('W5 §2 — IQ8A SKU is IQ8A-72-2-US only', () => {
  const html = generatePermitHTML(braidonLikeInput());
  it('no legacy IQ8A-72-M-US SKU anywhere in the rendered package', () => {
    expect(html).toContain('IQ8A-72-2-US');
    expect(html).not.toContain('IQ8A-72-M-US');
  });
});

// ─── 5. DS-1 exact-vs-family module document ─────────────────────────────────

describe('W5 §3 — module datasheet exactness', () => {
  it('detects the Qcells 400W selection is served only by a FAMILY series sheet', () => {
    // BRAIDON PDF AUDIT 2026-08-27 (N2) — family range moved 385-405 → 395-415 because the
    // registered Qcells document changed, deliberately: the asset row's docTitle said
    // "385-405W" while its sourceUrl was the 395-415 Wp sheet, and the archived image was
    // page 1 (marketing, no spec table). equipment-db, its datasheetUrl and the asset are now
    // all on ZZ304800120 Rev06 2023-12. The RULE is unchanged: a series sheet is never exact,
    // and the range still covers the selected 400 W.
    const ex = resolveModuleDatasheetExactness('Q.PEAK DUO BLK ML-G10+ 400W', 400);
    expect(ex.stateLabel).toBe('FAMILY-DATASHEET-PENDING');
    expect(ex.isExact).toBe(false);
    expect(ex.familyRange).toEqual([395, 415]);
    expect(ex.selectedWatts).toBe(400);
  });

  it('DS-1 never presents a generic sheet as the established source, and never demands a wattage-exact PDF', () => {
    const html = generatePermitHTML(braidonLikeInput());
    // CMDA — DS-1 PROJECTS the canonical state. With no governed registry
    // document this input has none, so the page must say applicability is not
    // established — and must NOT claim it is, nor invent a coverage verdict from
    // the static asset's title.
    expect(html).toMatch(/data-ds-state="module-(no-document|applicability-evidence-incomplete|not-covered)"/);
    expect(html).toMatch(/NO GOVERNED MODULE DATASHEET ON FILE|APPLICABILITY EVIDENCE INCOMPLETE|DOES NOT COVER/);
    expect(html).not.toContain('COVERAGE VERIFIED');
    // the false requirement is gone: a family document that covers the selection
    // is acceptable, so DS-1 may never demand a single-wattage PDF.
    expect(html).not.toMatch(/Attach the exact .* datasheet/);
  });

  it('emits a canonical blocker for the pending exact module document', () => {
    const blockers = collectEquipmentDocumentBlockers(braidonLikeInput());
    expect(blockers.some(b => b.code === 'MODULE-EXACT-DATASHEET-PENDING')).toBe(true);
  });
});

// ─── 6. W6 banned-token leaks in APP-A / DS (coordinator delegation) ──────────

describe('W6 — APP-A racking section projects the canonical assembly, no banned tokens', () => {
  const html = generatePermitHTML(braidonLikeInput());

  // scope the banned-token check to the APP-A racking table (this agent's file);
  // schedule/BOM tables that re-print mounting-hardware-db strings are owned elsewhere.
  const appARacking = (html.match(/data-app-a-source="racking-assembly"[\s\S]*?<\/table>/i) ?? [''])[0];

  it('rail line carries NO banned "compatible rail" phrase; projects the canonical blocked state', () => {
    expect(appARacking).not.toBe('');
    expect(appARacking.toLowerCase()).not.toContain('compatible rail');
    // the RT-MINI rail is unpinned ⇒ APP-A shows the canonical structural language
    const m = appARacking.match(/data-app-a-field="railModel"[^>]*>([^<]*)</i);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('PENDING RACKING ASSEMBLY SELECTION');
  });

  it('fastener line carries NO fabricated "× 4\\" SS lag" length/material formula', () => {
    const m = html.match(/data-app-a-field="fastener"[^>]*>([^<]*)</i);
    expect(m).toBeTruthy();
    // never the invented 5/16" × 4" Min. Stainless Steel string
    expect(html).not.toMatch(/5\/16"?\s*DIA\s*×\s*4"?\s*Min\.\s*Stainless/i);
    expect(html).not.toMatch(/×\s*4"\s*Min\.\s*Stainless Steel/i);
    // it is either the canonical record fastener (structural wood screw), the
    // PENDING racking-assembly state, or — BAR §6 (2026-07-25) — the NON-ORDERABLE
    // design-quantity label that withholds every fastener dimension while the
    // assembly is unverified.
    expect(m![1]).toMatch(/screw|lag|PENDING RACKING ASSEMBLY SELECTION|NON-ORDERABLE \/ PENDING VERIFIED FASTENER ASSEMBLY/i);
  });

  it('mount topology projects rail_paired for RT-MINI (never rail-less/direct-attach)', () => {
    const m = html.match(/data-app-a-field="mountTopology"[^>]*>([^<]*)</i);
    expect(m).toBeTruthy();
    expect(m![1]).toBe('rail_paired');
    // and the rail profile is not mislabelled rail-less/direct-attach
    const r = html.match(/data-app-a-field="railModel"[^>]*>([^<]*)</i);
    expect(r![1].toLowerCase()).not.toContain('rail-less');
    expect(r![1].toLowerCase()).not.toContain('direct-attach');
  });
});

describe('§10 (Gate 10) — RACKING RAIL DS page OMITTED while the rail SKU is unpinned', () => {
  const html = generatePermitHTML(braidonLikeInput());

  it('does NOT render the unselected rail datasheet as an authoritative appendix page', () => {
    // Ray's preference (§10): OMIT the page entirely while the rail is pending.
    // An unselected datasheet must never render — no page, no banner, no rail image.
    // A datasheet appears as an authoritative appendix ONLY when its document
    // record is selected (railSku pinned) by the snapshot.
    expect(html).not.toContain('RACKING RAIL');
    expect(html).not.toMatch(/data-ds-rail="pending"/);
    expect(html).not.toMatch(/data-ds-state="rail-not-selected"/);
    expect(html).not.toMatch(/RAIL NOT YET SELECTED/);
  });
});
