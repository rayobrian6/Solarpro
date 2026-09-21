/**
 * tests/combinerSelectionAuthority.test.ts
 *
 * ONE SELECTED COMBINER PER SYSTEM. THE BOM AND THE DRAWINGS MUST NAME IT.
 *
 * `resolveIntegratedEquipment` picks the integrated combiner ("the brains") from
 * `ctx.compatibleCombinerIds` — the pairing `equipment-db` declares on the
 * selected microinverter — and falls back to the current-generation 6C when that
 * list is absent:
 *
 *     const combiner = resolveCompatibleCombiner(ctx.compatibleCombinerIds)
 *       ?? getBosDevice('enphase-iq-combiner-6c')!;
 *
 * Every Enphase IQ8 row declares `compatibleWith: ['enphase-iq-combiner-5', …]`,
 * so a caller that PASSES the list gets the 5C and a caller that OMITS it gets
 * the 6C. Five call sites; two passed it, three did not:
 *
 *     lib/permit/utils/integratedEquipment.ts   passes  ->  5C   planset sheets
 *     app/api/engineering/sld/route.ts          passes  ->  5C   the SLD
 *     lib/bom-engine-v4.ts  (x2)                omits   ->  6C   the BOM
 *     lib/equipment/integratedBos.ts (hybrid)   omits   ->  6C
 *
 * THE BOM SHIPPED THE 6C WHILE THE DRAWINGS PRINTED THE 5C, and this is not a
 * label: the 6C declares `disconnect: true`, the 5C does not, and
 * `providesAcDisconnect` drives the NEC 690.13 "integral AC disconnecting means"
 * statement on the compliance and electrical pages. One permit package could
 * contradict itself about whether a disconnect exists.
 *
 * The rule "which combiner does this inverter pair with" had THREE
 * implementations and THREE omissions. It now has one:
 * `combinerCompatibilityFor()`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveIntegratedEquipment, type SystemBosContext } from '@/lib/equipment/integratedBos';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import { MICROINVERTERS } from '@/lib/equipment-db';
import { stripCommentsAndStrings } from './support/stripSource';

/** A real Enphase micro system, taken from the real catalogue. */
const IQ8 = MICROINVERTERS.find(m => /enphase/i.test(m.manufacturer) && /IQ8/i.test(m.model))!;

function ctx(over: Partial<SystemBosContext> = {}): SystemBosContext {
  return {
    inverterManufacturer: IQ8.manufacturer,
    inverterModel: IQ8.model,
    isMicro: true,
    totalDevices: 24,
    branchCount: 3,
    hasBattery: false,
    ...over,
  };
}

describe('the catalogue really does declare the pairing this turns on', () => {
  it('the IQ8 row names a combiner, and it is not the 6C', () => {
    // If this ever stops being true the rest of the file is testing a hazard
    // that no longer exists, and it should fail here saying so.
    expect(IQ8, 'no Enphase IQ8 microinverter in the catalogue').toBeTruthy();
    expect(Array.isArray((IQ8 as any).compatibleWith)).toBe(true);
    expect((IQ8 as any).compatibleWith).toContain('enphase-iq-combiner-5');
    expect((IQ8 as any).compatibleWith).not.toContain('enphase-iq-combiner-6c');
  });
});

describe('combinerCompatibilityFor — the one implementation of the pairing rule', () => {
  it('finds the declared pairing from manufacturer + model', () => {
    expect(combinerCompatibilityFor(IQ8.manufacturer, IQ8.model)).toEqual((IQ8 as any).compatibleWith);
  });

  it('is case- and whitespace-insensitive, and NEVER a substring match', () => {
    expect(combinerCompatibilityFor(`  ${IQ8.manufacturer.toUpperCase()} `, ` ${IQ8.model.toLowerCase()}`))
      .toEqual((IQ8 as any).compatibleWith);
    // Substring matching on equipment models is a known defect class in this
    // repo. A model that merely CONTAINS a real one must not match it.
    expect(combinerCompatibilityFor(IQ8.manufacturer, `${IQ8.model}-XL`)).toBeUndefined();
    expect(combinerCompatibilityFor(IQ8.manufacturer, IQ8.model.slice(0, 3))).toBeUndefined();
  });

  it('returns undefined — never a guess — for an unknown inverter', () => {
    expect(combinerCompatibilityFor('Acme', 'Nonesuch 9000')).toBeUndefined();
    expect(combinerCompatibilityFor('', '')).toBeUndefined();
    expect(combinerCompatibilityFor(undefined, undefined)).toBeUndefined();
  });

  it('prefers an explicit inverter id when the caller has one', () => {
    const byId = combinerCompatibilityFor(undefined, undefined, (IQ8 as any).id);
    expect(byId).toEqual((IQ8 as any).compatibleWith);
  });
});

describe('the contradiction this replaces', () => {
  it('OMITTING the pairing still selects a DIFFERENT device — the defect is real', () => {
    // This is the mutation proof, kept in the suite rather than run once by
    // hand: it drives the real resolver with the two context shapes the two
    // families of call site used to build.
    const withPairing = resolveIntegratedEquipment(ctx({
      compatibleCombinerIds: combinerCompatibilityFor(IQ8.manufacturer, IQ8.model),
    }));
    const withoutPairing = resolveIntegratedEquipment(ctx());

    expect(withPairing.brains?.model).toBe('IQ Combiner 5C');
    expect(withoutPairing.brains?.model).toBe('IQ Combiner 6C');
    expect(withPairing.brains?.model).not.toBe(withoutPairing.brains?.model);
  });

  it('and the two devices disagree about a CODE STATEMENT, not a label', () => {
    const withPairing = resolveIntegratedEquipment(ctx({
      compatibleCombinerIds: combinerCompatibilityFor(IQ8.manufacturer, IQ8.model),
    }));
    const withoutPairing = resolveIntegratedEquipment(ctx());

    // providesAcDisconnect drives the NEC 690.13 integral-disconnect statement.
    expect(withPairing.providesAcDisconnect).toBe(false);
    expect(withoutPairing.providesAcDisconnect).toBe(true);
  });
});

describe('every caller now resolves the SAME device', () => {
  const ENGINE_FILES = [
    'lib/permit/utils/integratedEquipment.ts',
    'app/api/engineering/sld/route.ts',
    'lib/bom-engine-v4.ts',
    'lib/equipment/integratedBos.ts',
  ];

  it('no construction of a micro SystemBosContext omits the pairing', () => {
    // Structural, because the behavioural test above cannot see a NEW call site
    // added later. Comments and strings are stripped first: this file's own
    // documentation names `compatibleCombinerIds` repeatedly, and a guard that
    // reads its own prose as code is worthless in both directions.
    const offenders: string[] = [];
    let examined = 0;

    for (const rel of ENGINE_FILES) {
      const src = stripCommentsAndStrings(readFileSync(join(__dirname, '..', rel), 'utf8'));
      const calls = src.split('resolveIntegratedEquipment({').slice(1);
      for (const tail of calls) {
        examined++;
        // The argument object ends at the first line that closes it.
        const body = tail.slice(0, tail.indexOf('});'));
        if (!/isMicro/.test(body)) continue;               // not a micro context
        if (/isMicro:\s*false/.test(body)) continue;
        if (!/compatibleCombinerIds/.test(body)) offenders.push(`${rel} :: ${body.trim().slice(0, 90)}`);
      }
    }

    expect(examined, 'the scan found no resolveIntegratedEquipment call sites at all')
      .toBeGreaterThanOrEqual(4);
    expect(offenders, `these build a micro context without the pairing:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('the pairing rule has ONE implementation — nobody re-derives it inline', () => {
    // Before this, three call sites each carried their own
    // MICROINVERTERS.find(...) exact-match block.
    const inlineLookups: string[] = [];
    for (const rel of ENGINE_FILES.concat(['lib/permit/utils/integratedEquipment.ts'])) {
      const src = stripCommentsAndStrings(readFileSync(join(__dirname, '..', rel), 'utf8'));
      if (/MICROINVERTERS\s*\.\s*find\(/.test(src)) inlineLookups.push(rel);
    }
    expect(inlineLookups, `these still re-derive the pairing inline: ${inlineLookups.join(', ')}`)
      .toEqual([]);
  });
});
