// ═══════════════════════════════════════════════════════════════════════════
// Tigo rapid-shutdown companions.
//
// The defect these pin: generateBOMV4 emitted TS4-A-F units at one per
// on-building module with NOTHING to drive them. Measured across the catalogue,
// 22 of 48 string inverters reached that branch and all 22 produced zero driver
// lines — while the package printed "NEC 690.12: Rapid shutdown devices added".
// A TS4-A-F with no keep-alive outputs 0.6 V: the array is dead, not unmonitored.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  resolveTigoRsdCompanions,
  transmittersRequired,
  RSS_TRANSMITTER_PART_NUMBER,
  STRINGS_PER_TRANSMITTER_CORE,
} from '@/lib/bom/tigoRsdCompanions';
import { generateBOMV4 } from '@/lib/bom-engine-v4';
import { STRING_INVERTERS, SOLAR_PANELS } from '@/lib/equipment-db';

describe('transmitter quantity — per inverter, never global', () => {
  it('two inverters of five strings each need TWO transmitters, not one', () => {
    // The whole point of the rule. A global ceil(10/10) would say 1, and Tigo
    // forbids conductors from separate inverters sharing a core.
    expect(transmittersRequired(10, 2)).toBe(2);
    expect(transmittersRequired(10, 1)).toBe(1);
  });

  it('scales with strings once a single core is exceeded', () => {
    expect(transmittersRequired(STRINGS_PER_TRANSMITTER_CORE, 1)).toBe(1);
    expect(transmittersRequired(STRINGS_PER_TRANSMITTER_CORE + 1, 1)).toBe(2);
    expect(transmittersRequired(21, 1)).toBe(3);
  });

  it('never returns fewer than one per inverter', () => {
    for (const inv of [1, 2, 3, 7]) {
      expect(transmittersRequired(1, inv)).toBeGreaterThanOrEqual(inv);
    }
  });

  it('is total-safe against degenerate input', () => {
    expect(transmittersRequired(0, 0)).toBe(1);
    expect(transmittersRequired(NaN as unknown as number, 1)).toBeGreaterThanOrEqual(1);
  });
});

describe('companion resolution', () => {
  it('emits nothing when there are no TS4 devices — never speculative', () => {
    const r = resolveTigoRsdCompanions({ ts4DeviceCount: 0, stringCount: 2, inverterCount: 1 });
    expect(r.lines).toHaveLength(0);
    expect(r.blockerCode).toBeNull();
  });

  it('emits a CANDIDATE transmitter, never an orderable one', () => {
    const r = resolveTigoRsdCompanions({ ts4DeviceCount: 24, stringCount: 2, inverterCount: 1 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].partNumber).toBe(RSS_TRANSMITTER_PART_NUMBER);
    // The quantity is derived; the SELECTION is not verified — the catalogue has
    // no per-model integrated-transmitter fact to check.
    expect(r.lines[0].authorityStateHint).toBe('CANDIDATE_NON_ORDERABLE');
    expect(r.blockerCode).toBe('TIGO-RSS-TRANSMITTER-UNVERIFIED');
  });

  it('never emits a TAP or a CCA — wrong signalling family for TS4-A-F', () => {
    // F/2F and O/S/M are "not inter-mixable within single systems or arrays".
    // Reaching for a TAP here is the exact error already sitting in the price
    // table (a TAP-prefixed optimizer row).
    const r = resolveTigoRsdCompanions({ ts4DeviceCount: 31, stringCount: 3, inverterCount: 1 });
    const blob = JSON.stringify(r.lines);
    expect(blob).not.toMatch(/\bTAP\b/);
    expect(blob).not.toMatch(/Cloud Connect|\bCCA\b/i);
    expect(blob).not.toMatch(/158-00000|346-00000|344-00000|348-00000/);
  });

  it('does not emit the part number that does not exist', () => {
    const r = resolveTigoRsdCompanions({ ts4DeviceCount: 24, stringCount: 12, inverterCount: 1 });
    // 493-00000-51 is a plausible-looking SKU produced by false symmetry with
    // the 492 pair. Tigo makes no single-core 277/480 V transmitter.
    expect(JSON.stringify(r.lines)).not.toContain('493-00000-51');
  });

  it('states the derivation rather than asserting a bare number', () => {
    const r = resolveTigoRsdCompanions({ ts4DeviceCount: 24, stringCount: 12, inverterCount: 2 });
    expect(r.basis).toContain('per core');
    expect(r.lines[0].formula).toBe(r.basis);
  });
});

describe('BOM engine — a TS4 array is never quoted without a keep-alive source', () => {
  const panel = (SOLAR_PANELS as any[]).find(p => p.id === 'qcells-peak-duo-400') ?? SOLAR_PANELS[0];
  const mk = (inverterId: string) => ({
    inverterId, panelId: panel.id,
    moduleCount: 24, stringCount: 2, inverterCount: 1,
    systemKw: (panel.watts * 24) / 1000, acOutputKw: 7.6,
    dcWireGauge: '#10 AWG', acWireGauge: '#6 AWG',
    dcWireLength: 80, acWireLength: 40,
    conduitType: 'EMT' as const, conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 48, railSections: 8,
    requiresRapidShutdown: true, systemType: 'roof',
    subSystemCounts: { roof: 24, ground: 0, fence: 0 },
    includeTruckStock: false, includeSuggestedTools: false,
    interconnectionMethod: 'LOAD_SIDE',
  }) as any;

  it('EVERY inverter that emits TS4 units also emits a driver', () => {
    const offenders: string[] = [];
    let reached = 0;
    for (const inv of STRING_INVERTERS as any[]) {
      let res: any;
      try { res = generateBOMV4(mk(inv.id)); } catch { continue; }
      const items: any[] = res?.items ?? [];
      const hasTs4 = items.some(i => /TS4/i.test(`${i.partNumber ?? ''}${i.model ?? ''}`));
      if (!hasTs4) continue;
      reached++;
      const hasDriver = items.some(i => /transmitter|\bRSS\b/i.test(
        `${i.manufacturer ?? ''} ${i.model ?? ''} ${i.partNumber ?? ''} ${i.description ?? ''}`));
      if (!hasDriver) offenders.push(`${inv.manufacturer} ${inv.model}`);
    }
    // The branch must actually be exercised, or this test passes vacuously —
    // the failure mode that let the original defect survive a green suite.
    expect(reached).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('the transmitter is excluded from orderable procurement', () => {
    const inv = (STRING_INVERTERS as any[]).find(i => /Primo/i.test(i.model));
    if (!inv) return;
    const items: any[] = (generateBOMV4(mk(inv.id)) as any)?.items ?? [];
    const tx = items.find(i => i.partNumber === RSS_TRANSMITTER_PART_NUMBER);
    expect(tx).toBeTruthy();
    const state = tx.orderability?.authorityStateHint ?? tx.authorityStateHint;
    expect(state).toBe('CANDIDATE_NON_ORDERABLE');
  });

  it('the compliance notes say the keep-alive is unresolved, not that all is well', () => {
    const inv = (STRING_INVERTERS as any[]).find(i => /Primo/i.test(i.model));
    if (!inv) return;
    const notes: string[] = (generateBOMV4(mk(inv.id)) as any)?.complianceNotes ?? [];
    expect(notes.some(n => /keep-alive/i.test(n))).toBe(true);
    expect(notes.some(n => /NOT established/i.test(n))).toBe(true);
  });
});
