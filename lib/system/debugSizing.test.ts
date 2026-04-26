import { sizeSystemFromBrand } from './sizingEngine';
import { describe, it } from 'vitest';

describe('debug — 36 panels solaredge', () => {
  it('prints inverter count and string layout', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      selectedBrand: 'solaredge',
      panelVoc: 41.6,
      panelVmp: 34.5,
      panelIsc: 11.2,
      panelWattage: 400,
      panelTempCoeffVoc: -0.27,
    });
    console.log('=== inverterCount:', r.inverterCount);
    console.log('=== inverterModels:', JSON.stringify(r.inverterModels));
    console.log('=== strings count:', r.strings.length);
    r.strings.forEach(s => console.log(`  string[${s.index}] panels=${s.panelCount} invIdx=${s.inverterIndex} mppt=${s.mpptIndex}`));
    console.log('=== warnings:', r.warnings.map(w => w.code + '(' + w.severity + ')'));
  });
});