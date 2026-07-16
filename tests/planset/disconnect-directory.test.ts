import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { buildSheetManifest } from '@/lib/permit/sheetManifest';
import { roofProject } from '../../test-fixtures/roofProject';

// PV-6: the permanent disconnect-directory / emergency placard. One sheet
// satisfies NEC 705.10 (power-source directory) + 690.56(B) (PV disconnect
// plaque) + 690.12(D)/690.56(C) (rapid-shutdown building placard). Content
// adapts to topology, interconnection, rapid shutdown and battery presence.
describe('PV-6 disconnect directory & emergency placard', () => {
  const clone = () => JSON.parse(JSON.stringify(roofProject));

  it('is registered in the sheet manifest right after PV-5', () => {
    const m = buildSheetManifest({ pv1Title: 'X', pv3Title: 'Y' });
    const ids = m.map(s => s.id);
    expect(ids).toContain('PV-6');
    expect(ids.indexOf('PV-6')).toBe(ids.indexOf('PV-5') + 1);
  });

  it('renders the placard with all required blocks', () => {
    const html = generatePermitHTML(clone());
    expect(html).toContain('DISCONNECT DIRECTORY');
    expect(html).toContain('EMERGENCY PLACARD');
    expect(html).toContain('CAUTION — MULTIPLE SOURCES OF POWER');
    expect(html).toContain('DISCONNECTING MEANS &amp; PV EQUIPMENT DIRECTORY');
    expect(html).toContain('SYSTEM RATINGS');
    expect(html).toContain('EMERGENCY SHUTDOWN PROCEDURE');
    expect(html).toContain('RAPID SHUTDOWN');
    expect(html).toContain('PLACARD SPECIFICATION');
    // ratings are single-sourced: 3.96kW AC / 240V ≈ 16.5A
    expect(html).toContain('240 V');
  });

  it('lists the utility + PV sources, and adds energy storage only when a real battery exists', () => {
    const noBatt = generatePermitHTML(clone());
    expect(noBatt).toContain('UTILITY GRID + SOLAR PV');
    expect(noBatt).not.toContain('UTILITY GRID + SOLAR PV + ENERGY STORAGE');

    const p = clone();
    p.project.batteryBrand = 'Tesla';
    p.project.batteryModel = 'Powerwall 3';
    p.project.batteryCount = 1;
    p.project.batteryKwh = 13.5;
    const withBatt = generatePermitHTML(p);
    expect(withBatt).toContain('UTILITY GRID + SOLAR PV + ENERGY STORAGE');
    expect(withBatt).toContain('OPEN ENERGY STORAGE (ESS) / BATTERY DISCONNECT');
  });

  it('gates the rapid-shutdown reference on the NEC edition', () => {
    const p2023 = clone();
    p2023.compliance.jurisdiction.necVersion = 'NEC 2023';
    expect(generatePermitHTML(p2023)).toContain('690.12(D)');

    const p2020 = clone();
    p2020.compliance.jurisdiction.necVersion = 'NEC 2020';
    const html2020 = generatePermitHTML(p2020);
    // the RSD band/spec cites 690.56(C) on pre-2023 cycles
    expect(html2020).toContain('690.56(C)');
  });

  it('shows the interconnection method (supply-side vs load-side)', () => {
    const supply = clone();
    supply.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
    expect(generatePermitHTML(supply)).toContain('SUPPLY-SIDE TAP');
  });
});
