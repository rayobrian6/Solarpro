/**
 * tests/stringSizingIsOneAuthority.test.ts
 *
 * THE PAGE TOLD THE DESIGNER A STRING LENGTH THE ENGINE DISAGREED WITH —
 * AND THEN OFFERED A BUTTON THAT APPLIED IT.
 *
 * 🚨 A SECOND STRING-SIZING AUTHORITY, ON A CONTROL THAT WRITES.
 *
 * `app/engineering/page.tsx` rendered a "String Sizing (NEC 690.7)" readout
 * computed inline: `floor(maxDcVoltage / vocCorrected)` for max,
 * `ceil(mpptVoltageMin / vmpCorrected)` for min, MPPT-centre for recommended.
 * It excluded only `micro` topology.
 *
 * So on an OPTIMIZER system it applied Voc x N — which is INAPPLICABLE there.
 * Each module has its own DC-DC converter; at open circuit the string is about
 * 1 V per optimizer, and in operation the inverter actively holds the bus at a
 * fixed voltage regardless of panel count. The real ceiling is the brand cap
 * (25 for SolarEdge), not a voltage division.
 *
 * That is not a display defect, and this is the part that makes it a P1: the
 * readout carries an "Auto" button that APPLIES what it shows. A designer
 * clicking it on a SolarEdge system got roughly 10-13 panels per string instead
 * of 25 — which is precisely the 10/10/10/6 layout `lib/string-generator.ts`
 * records (v47.412) as blowing the per-MPPT current budget and firing a
 * spurious MPPT_CURRENT_EXCEEDED on every optimizer system over ~10 panels.
 * The engine was repaired; the page went on reproducing the defect.
 *
 * It also resolved its own design temperature with a third `?? -10` fallback,
 * so it could disagree with the canonical thermal basis that the calculate
 * route, the SLD route and the stamped plan set now share.
 *
 * The repair is not "correct the page's copy". Two implementations of "how long
 * may a string be" is one too many when one of them writes a layout. The
 * arithmetic was lifted out of `generateStringConfig` unchanged as
 * `stringSizingBounds`, and both callers now call it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { stringSizingBounds } from '../lib/string-generator';

const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app', 'engineering', 'page.tsx'), 'utf8'));
const GEN = stripComments(readFileSync(join(ROOT, 'lib', 'string-generator.ts'), 'utf8'));

/** A real module + a real SolarEdge-class inverter. */
const MODULE = { moduleVoc: 45.0, moduleVmp: 37.5, tempCoeffVoc: -0.27 };
const INVERTER = {
  inverterMaxDcVoltage: 480,
  mpptVoltageMin: 200,
  mpptVoltageMax: 480,
  inverterMaxPanelsPerString: 25,
};
const COLD = -23;   // Illinois, canonical basis

describe('🚨 the optimizer case the page was getting wrong', () => {
  it('a string inverter is sized by Voc x N, as NEC 690.7 requires', () => {
    const b = stringSizingBounds({ ...MODULE, ...INVERTER, designTempMinC: COLD, topology: 'string' });
    // Voc corrected at -23 degC: 45.0 x (1 + (-0.27/100)(-48)) = 50.83 V
    // floor(480 / 50.83) = 9
    expect(b.optimizerBypass).toBe(false);
    expect(b.maxPanelsPerString).toBe(9);
  });

  it('🚨 an OPTIMIZER is NOT — Voc x N is bypassed and the brand cap governs', () => {
    const b = stringSizingBounds({ ...MODULE, ...INVERTER, designTempMinC: COLD, topology: 'optimizer' });
    expect(b.optimizerBypass).toBe(true);
    expect(b.recommendedPanelsPerString,
      'the optimizer recommendation fell back to a voltage division — this is the layout that blows the MPPT current budget')
      .toBe(25);
    // And the minimum is not a voltage division either: the bus is regulated.
    expect(b.minPanelsPerString).toBe(1);
  });

  it('the brand profile may LOWER the cap but never raise it above the datasheet max', () => {
    const lower = stringSizingBounds({
      ...MODULE, ...INVERTER, inverterMaxPanelsPerString: 16,
      designTempMinC: COLD, topology: 'optimizer',
    });
    expect(lower.recommendedPanelsPerString).toBe(16);

    const absurd = stringSizingBounds({
      ...MODULE, ...INVERTER, inverterMaxPanelsPerString: 999,
      designTempMinC: COLD, topology: 'optimizer',
    });
    expect(absurd.recommendedPanelsPerString, 'a bad registry value raised the ceiling above the datasheet')
      .toBe(25);
  });

  it('the recommendation is always inside [min, max]', () => {
    for (const topology of ['string', 'optimizer', 'micro']) {
      const b = stringSizingBounds({ ...MODULE, ...INVERTER, designTempMinC: COLD, topology });
      expect(b.recommendedPanelsPerString).toBeGreaterThanOrEqual(b.minPanelsPerString);
      expect(b.recommendedPanelsPerString).toBeLessThanOrEqual(b.maxPanelsPerString);
    }
  });

  it('a colder design temperature shortens a string — the physics is still there', () => {
    // Guards against the extraction having quietly dropped the NEC 690.7
    // correction. Asserted on the CONTINUOUS value first, because the string
    // length is a floor() and a modest temperature change need not move it —
    // a first version of this compared -5 degC with -30 degC, where the voltage
    // rises from 48.64 V to 51.68 V and the answer is 9 both times. That would
    // have failed on correct code.
    const warm = stringSizingBounds({ ...MODULE, ...INVERTER, designTempMinC: -5, topology: 'string' });
    const cold = stringSizingBounds({ ...MODULE, ...INVERTER, designTempMinC: -30, topology: 'string' });
    expect(cold.vocCorrected).toBeGreaterThan(warm.vocCorrected);
    expect(cold.maxPanelsPerString).toBeLessThanOrEqual(warm.maxPanelsPerString);

    // And a span wide enough that the integer must move, so the assertion above
    // cannot be satisfied by a function that ignores temperature entirely.
    const mild = stringSizingBounds({ ...MODULE, ...INVERTER, designTempMinC: 15, topology: 'string' });
    expect(mild.maxPanelsPerString).toBe(10);
    expect(cold.maxPanelsPerString).toBe(9);
  });

  it('the MPPT minimum uses HOT Vmp, not cold — or strings drop out on hot afternoons', () => {
    const b = stringSizingBounds({ ...MODULE, ...INVERTER, designTempMinC: COLD, topology: 'string' });
    // Vmp falls as the cell heats; the hot value must be BELOW nameplate.
    expect(b.vmpHot).toBeLessThan(MODULE.moduleVmp);
  });
});

describe('🚨 there is one implementation, and both consumers call it', () => {
  it('the engine routes through it rather than computing inline', () => {
    expect(GEN).toMatch(/const _bounds = stringSizingBounds\(\{/);
    expect(GEN).toMatch(/const maxPanelsPerString = _bounds\.maxPanelsPerString;/);
  });

  it('the engineering page calls the same function', () => {
    expect(PAGE).toMatch(/import \{ stringSizingBounds \} from '@\/lib\/string-generator'/);
    expect(PAGE).toMatch(/const _sz = stringSizingBounds\(\{/);
  });

  it('🚨 every displayed bound COMES FROM the shared result', () => {
    // 🚨 PIN THE REQUIREMENT, NOT THE OLD LITERAL. A first version forbade the
    // exact previous expression — `Math.floor((invData.maxDcVoltage || 600) /
    // vocCorr)` — and a mutation that reintroduced the same arithmetic spelled
    // differently sailed straight through. Forbidding one spelling of a
    // computation does not stop the computation; requiring the value to come
    // from the authority does.
    for (const name of ['maxPPS', 'minPPS', 'clampedRec']) {
      const re = new RegExp(`const ${name} = _sz\\.\\w+;`);
      expect(PAGE, `${name} is no longer taken from the shared sizing result — the page is computing it again`)
        .toMatch(re);
    }
    // And nothing else in that block may derive a bound locally.
    const i = PAGE.indexOf('const _sz = stringSizingBounds({');
    const end = PAGE.indexOf('return (', i);
    expect(end).toBeGreaterThan(i);
    const block = PAGE.slice(i, end);
    expect(block, 'the readout block still divides a voltage to get a string length')
      .not.toMatch(/Math\.(floor|ceil|round)\s*\([^)]*(maxDcVoltage|mpptVoltage)/);
  });

  it('🚨 and no hardcoded cold-temperature literal survives in the page', () => {
    // A third basis. The calculate route, the SLD route and the plan set all
    // read getThermalDesignBasis; a `?? -10` here put the designer on a fourth.
    expect(PAGE, 'a hardcoded design-low is back in the engineering page')
      .not.toMatch(/\?\? -10\b/);
    expect(PAGE).toMatch(/getThermalDesignBasis\(\{ state: config\.state \|\| null \}\)\.minDesignTempC/);
  });

  it('the page passes the REAL topology, not a micro-only exclusion', () => {
    // The old code was `if (inv.type === 'micro') return null;` and nothing
    // else — which is why optimizers were treated as string inverters.
    // 🚨 SLICED TO THE CALL'S OWN CLOSING BRACE, not a fixed length. A first
    // version took 700 characters and stopped mid-argument — the property names
    // and the JSX indentation are long — so it failed on correct source. Fixed
    // windows have cost this suite time repeatedly.
    const i = PAGE.indexOf('const _sz = stringSizingBounds({');
    expect(i).toBeGreaterThan(-1);
    const end = PAGE.indexOf('});', i);
    expect(end).toBeGreaterThan(i);
    expect(PAGE.slice(i, end)).toMatch(/topology: topologyType/);
  });
});
