import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { hasRealBattery } from '@/lib/permit/utils/helpers';
import { roofProject } from '../../test-fixtures/roofProject';

describe('phantom battery + APP-CAD removal', () => {
  it('hasRealBattery requires a model/id, not just a count', () => {
    expect(hasRealBattery({ batteryCount: 1 })).toBe(false);               // count only → ghost
    expect(hasRealBattery({ batteryCount: 1, batteryModel: '—' })).toBe(false);
    expect(hasRealBattery({ batteryCount: 0, batteryModel: 'Powerwall 3' })).toBe(false);
    expect(hasRealBattery({ batteryCount: 1, batteryModel: 'Powerwall 3' })).toBe(true);
    expect(hasRealBattery({ batteryCount: 1, batteryId: 'tesla-powerwall-3' })).toBe(true);
  });

  it('a count-only phantom battery renders no ESS labels/lines on the planset', () => {
    const p = JSON.parse(JSON.stringify(roofProject));
    p.project = p.project || {};
    p.project.batteryCount = 1; p.project.batteryModel = ''; p.project.batteryId = undefined; p.project.batteryKwh = 15;
    const html = generatePermitHTML(p);
    expect(html).not.toContain('BATTERY ENERGY STORAGE SYSTEM');
    expect(html).not.toContain('ENERGY STORAGE SYSTEM');
    expect(html).not.toContain('kWh TOTAL');
  });

  it('APP-CAD preview appendix is not in the default deliverable', () => {
    const html = generatePermitHTML(JSON.parse(JSON.stringify(roofProject)));
    expect(html).not.toContain('CAD PREVIEW APPENDIX');
    expect(html).not.toContain('class="tb-sheet-id">APP-CAD');
  });
});
