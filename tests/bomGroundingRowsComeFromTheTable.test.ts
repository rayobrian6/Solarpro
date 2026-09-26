// ═══════════════════════════════════════════════════════════════════════════
// PRESENCE IS NOT CONSUMPTION.
//
// `tests/groundingAndBackfeedBillARealPart.test.ts` proves the three authorities
// are right: NEC Table 250.66, NEC 250.122 and the 240.6(A) ladder. It does NOT
// prove `lib/bom-engine-v4.ts` asks them. Phase 4 shipped TWO guards that were
// satisfied by a function merely existing — one asserted a refusal helper
// "appeared", and `if (false && ...)` passed it.
//
// So these cases run the REAL engine and read the REAL emitted rows: the wire a
// buyer is billed for and the part number a purchaser types into an order.
//
// Both BOM emitters are exercised — the legacy single-system path AND the hybrid
// per-sub-system path — because the whole shape of finding 3 is that a rule was
// applied to one emitter and left off the other.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generateBOMV4, type BOMGenerationInputV4, type BOMLineItemV4 } from '@/lib/bom-engine-v4';
import type { SubSystemEquipment, SubSystemKey } from '@/lib/system/subSystemEquipment';
import { NEC_STANDARD_OCPD } from '@/lib/electrical/stdSizes';

const STANDARD = new Set<number>(NEC_STANDARD_OCPD as readonly number[]);
const NOW = '2026-07-12T00:00:00.000Z';

/** Single-system design-studio fallback: no `runs`, so the flat EGC row is emitted. */
function single(over: Partial<BOMGenerationInputV4> = {}): BOMGenerationInputV4 {
  return {
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405',
    moduleCount: 32, deviceCount: 32, stringCount: 0, inverterCount: 32, systemKw: 13,
    dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 64, railSections: 20,
    mainPanelAmps: 200, backfeedAmps: 60, acOCPD: 60, dcOCPD: 20,
    systemType: 'roof', rackingId: 'ironridge-xr100', topologyType: 'MICROINVERTER',
    interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200,
    ...over,
  } as BOMGenerationInputV4;
}

const sub = (key: SubSystemKey, over: Partial<SubSystemEquipment>): SubSystemEquipment => ({
  key, source: 'engineering', updatedAt: NOW, ...over,
});

/** Hybrid: >1 map entries + subSystemCounts ⇒ generateBOMV4PerSubSystem. */
function hybrid(over: Partial<BOMGenerationInputV4> = {}): BOMGenerationInputV4 {
  return {
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405',
    moduleCount: 91, deviceCount: 48, stringCount: 4, inverterCount: 50,
    systemKw: 36.9, acOutputKw: 31.8,
    dcWireGauge: '#10 AWG', acWireGauge: '#6 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 96, railSections: 24,
    mainPanelAmps: 200, backfeedAmps: 0, acOCPD: 60, dcOCPD: 30,
    systemType: 'roof', rackingId: 'ironridge-xr100',
    interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200,
    includeTruckStock: true, includeSuggestedTools: false,
    subSystemCounts: { roof: 48, ground: 26, fence: 17 },
    roofStringCount: 5,
    subSystemEquipment: {
      roof: sub('roof', {
        panelId: 'rec-alpha-pure-r-405', inverterId: 'enphase-iq8plus',
        topology: 'micro', ecosystemBrand: 'enphase',
        mountingId: 'ironridge-xr100', roofType: 'shingle', env: { rooftopTempAdderC: 30 },
      }),
      ground: sub('ground', {
        panelId: 'qcells-q-peak-duo-400', inverterId: 'solis-s6-eh1p-7p6k-us',
        topology: 'string', ecosystemBrand: 'solis', trenchRunLengthFt: 80,
        env: { rooftopTempAdderC: 0, wireLengthFt: 120 },
      }),
    },
    ...over,
  } as BOMGenerationInputV4;
}

const rows = (i: BOMGenerationInputV4): BOMLineItemV4[] => generateBOMV4(i).items;
const find = (items: BOMLineItemV4[], re: RegExp) => items.filter(i => re.test(i.model));

// ── EGC: the 250.122 table must reach the billed wire ───────────────────────
describe('🚨 the billed EGC row comes from the 250.122 table', () => {
  it('a 300 A AC OCPD bills #4 AWG, not the flat #6 the ternary gave', () => {
    const egc = find(rows(single({ acOCPD: 300 })), /Green EGC/);
    expect(egc.length, 'no EGC row was emitted — this case would be blind').toBeGreaterThan(0);
    expect(egc[0].model, 'the BOM still bills the flat #6 AWG above 100 A').toContain('#4 AWG');
    // The part number is derived from the gauge, so it must move with it.
    expect(egc[0].partNumber).toBe('THWN2-GRN-4');
  });

  it('a 20 A AC OCPD bills #12 AWG, not the over-bought #10', () => {
    const egc = find(rows(single({ acOCPD: 20 })), /Green EGC/);
    expect(egc[0].model).toContain('#12 AWG');
  });

  it('the HYBRID emitter bills the same gauge as the single-system one', () => {
    // The whole shape of these findings is a rule fixed in one emitter and not
    // the other, so the two paths are compared rather than each pinned alone.
    const a = find(rows(single({ acOCPD: 300 })), /Green EGC/)[0];
    const b = find(rows(hybrid({ acOCPD: 300 })), /Green EGC/)[0];
    expect(b, 'the hybrid path emitted no EGC row').toBeTruthy();
    expect(b.model.match(/#[\d/]+ AWG/)?.[0]).toBe(a.model.match(/#[\d/]+ AWG/)?.[0]);
  });
});

// ── GEC: Table 250.66 + the 250.66(A) rod cap must reach the billed wire ────
describe('🚨 the billed GEC row is capped by 250.66(A), not keyed on the OCPD', () => {
  it('a 200 A service bills #6 AWG, not the #2 the OCPD-keyed copy gave', () => {
    const gec = find(rows(single({ requiresGroundingElectrode: true, acOCPD: 200 })), /Bare Copper GEC/);
    expect(gec.length, 'no GEC row emitted — this case would be blind').toBeGreaterThan(0);
    expect(gec[0].model, 'the BOM still bills #2 bare copper on a rod-only electrode').toContain('#6 AWG');
    expect(gec[0].partNumber).toBe('BARE-CU-6');
  });

  it('the gauge does not track the OCPD any more — that was the wrong axis', () => {
    const at60  = find(rows(single({ requiresGroundingElectrode: true, acOCPD: 60 })),  /Bare Copper GEC/)[0];
    const at400 = find(rows(single({ requiresGroundingElectrode: true, acOCPD: 400 })), /Bare Copper GEC/)[0];
    // The old ternary gave #6 at 60 A and #2 at 400 A. Table 250.66 is indexed on
    // the service-entrance conductor, which did not change between these two
    // calls — so the answer must not change either.
    expect(at400.model).toBe(at60.model);
  });

  it('the printed basis names the rule that decided it', () => {
    const gec = find(rows(single({ requiresGroundingElectrode: true })), /Bare Copper GEC/)[0];
    expect(gec.description, 'the row no longer discloses which rule sized it').toMatch(/250\.66/);
  });
});

// ── The electrode gate must exist on BOTH emitters ──────────────────────────
describe('🚨 no phantom grounding electrode on a hybrid project', () => {
  const electrodeRows = (items: BOMLineItemV4[]) =>
    items.filter(i => /Ground Rod|Acorn Clamp|Bare Copper GEC/.test(i.model));

  it('the HYBRID emitter ships no rod, clamp or GEC unless asked', () => {
    const items = rows(hybrid()); // requiresGroundingElectrode unset
    const found = electrodeRows(items);
    expect(found.map(f => f.model),
      'the hybrid BOM shipped a phantom electrode system the plan set says is not added',
    ).toEqual([]);
  });

  it('the hybrid emitter still ships one when the design DOES require it', () => {
    const found = electrodeRows(rows(hybrid({ requiresGroundingElectrode: true })));
    expect(found.length, 'the gate became a wall — a real electrode is never emitted')
      .toBeGreaterThanOrEqual(3);
    expect(found.some(f => /Bare Copper GEC/.test(f.model))).toBe(true);
  });

  it('the single-system emitter behaves identically — one rule, two emitters', () => {
    expect(electrodeRows(rows(single())).map(f => f.model)).toEqual([]);
    expect(electrodeRows(rows(single({ requiresGroundingElectrode: true }))).length)
      .toBeGreaterThanOrEqual(3);
  });

  it('the compliance note is not printed when no electrode is emitted', () => {
    // The note said 'NEC 250.52(A)(5): ... required' unconditionally — a crew
    // instruction contradicting the stamped sheet.
    const res = generateBOMV4(hybrid());
    expect(res.complianceNotes.filter(n => /250\.52\(A\)\(5\)/.test(n)),
      'the BOM still prints an electrode requirement it did not emit').toEqual([]);
  });
});

// ── The backfeed breaker part number must be orderable ──────────────────────
describe('🚨 the backfeed breaker part number is a real Square D rating', () => {
  /** 320 A bus / 200 A main ⇒ allowance floor(384 − 200) = 184, which is not a rating. */
  const oversized = (over: Partial<BOMGenerationInputV4> = {}) => single({
    interconnectionMethod: 'LOAD_SIDE',
    panelBusRating: 320, mainPanelAmps: 200,
    backfeedAmps: 250, acOCPD: 250, systemKw: 60, acOutputKw: 60,
    requiresGroundingElectrode: false,
    ...over,
  });

  it('does not emit QO184 for a 320 A bus with a 200 A main', () => {
    const breaker = find(rows(oversized()), /Backfeed Breaker/);
    expect(breaker.length, 'no backfeed breaker row — this case would be blind').toBeGreaterThan(0);
    expect(breaker[0].partNumber, 'the BOM still orders a breaker Square D does not make')
      .not.toBe('QO184');
    expect(breaker[0].model).not.toContain('184A');
    expect(breaker[0].partNumber).toBe('QO175');
  });

  it('every emitted backfeed rating is an NEC 240.6(A) size and within the allowance', () => {
    // Sweep bus/main combinations whose 120% allowance is NOT a standard rating —
    // exactly the cases the raw Math.min turned into fictitious part numbers.
    for (const [bus, main] of [[320, 200], [200, 100], [400, 225], [225, 150], [320, 150]]) {
      const items = rows(oversized({ panelBusRating: bus, mainPanelAmps: main }));
      const breaker = find(items, /Backfeed Breaker/)[0];
      if (!breaker) continue;
      const amps = Number(breaker.partNumber.replace(/^QO/, ''));
      const allowance = Math.floor(bus * 1.2 - main);
      expect(STANDARD.has(amps), `${bus}/${main}: ${breaker.partNumber} is not a rating`).toBe(true);
      expect(amps, `${bus}/${main}: ${amps} A exceeds the ${allowance} A allowance`)
        .toBeLessThanOrEqual(allowance);
    }
  });

  it('the warning still states the TRUE unrounded allowance', () => {
    // The cap must not rewrite the code arithmetic the sheet discloses.
    const res = generateBOMV4(oversized());
    const warn = res.warnings.find(w => /705\.12\(B\) VIOLATION/.test(w));
    expect(warn, 'the 120% violation warning disappeared').toBeTruthy();
    expect(warn!, 'the warning no longer states the real 184 A allowance').toContain('184A');
  });

  it('a normal 200 A service is untouched — the fix is not a behaviour change', () => {
    // 200 A bus / 200 A main ⇒ allowance 40, already a standard rating.
    const breaker = find(rows(single({
      interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200, mainPanelAmps: 200,
      backfeedAmps: 40, acOCPD: 40,
    })), /Backfeed Breaker/)[0];
    expect(breaker.partNumber).toBe('QO40');
  });
});
