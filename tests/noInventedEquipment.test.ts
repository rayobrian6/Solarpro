// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A DEFAULT MAY NOT BECOME PROJECT TRUTH BECAUSE A FIELD IS EMPTY.
//
// Ray, after the authority audit:
//
//   "Eliminate this class of production fallback: `selectedInverter || MICROINVERTERS[0] ||
//    enphase-iq8plus`. 'No standalone inverter' is legitimate electrical state. Do not substitute
//    any manufacturer equipment when the project has none. Defaults may be suggestions in an
//    equipment-picker UI. They may never become persisted/project engineering truth merely because
//    a field is empty."
//
// This is the live defect's PV half. A DC-coupled Tesla job has no AC inverter, so
// `p.selectedInverter` is legitimately absent — and the project-load path filled it with the first
// microinverter in the catalogue. The invented identity was then read back by
// `lib/permit/utils/helpers.ts` as EVIDENCE that the design is microinverter, which is the
// inference `lib/permit/snapshot/resolution/equipmentSelection.ts` explicitly prohibits.
//
// 🚨 WHY A SOURCE GUARD AND NOT ONLY A BEHAVIOUR TEST. The substitution lives inside a 19,000-line
// client component whose load path cannot be driven in jsdom without a database, a session and a
// paid plan. Ray's own rule — "a helper called directly by a test does not prove a production
// consumer uses it" — cuts both ways: the thing that must be proven here is that the PRODUCTION
// FILE no longer contains the substitution, and reading the production file is the only way to
// prove that. The behavioural half is below it: the marker those paths now emit is honoured
// end-to-end by the renderer.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVERTER_UNSELECTED, isInverterUnselectedMarker } from '@/lib/permit/utils/helpers';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';

const src = (rel: string) => readFileSync(join(__dirname, '..', ...rel.split('/')), 'utf8');

/** Source with comments stripped, so a rule quoted in a comment is not read as code. */
const code = (rel: string) =>
  src(rel).split('\n')
    .filter(l => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

describe('🚨 the project-load paths invent no equipment', () => {
  it('a project with no selected inverter gets NO inverter, not the first in the catalogue', () => {
    const page = code('app/engineering/page.tsx');

    // The exact shape Ray named. Either spelling of the coalesce, either catalogue.
    const substitutions = [
      /selectedInverter\?\.id\s*\|\|\s*\(?\s*MICROINVERTERS\[0\]/,
      /selectedInverter\?\.id\s*\?\?\s*\(?\s*MICROINVERTERS\[0\]/,
      /selectedInverter\?\.id\s*\|\|\s*\(?\s*STRING_INVERTERS\[0\]/,
      /selectedInverter\?\.id\s*\?\?\s*\(?\s*STRING_INVERTERS\[0\]/,
    ];
    for (const re of substitutions) {
      expect(page, `the load path substitutes a catalogue inverter: ${re}`).not.toMatch(re);
    }

    // And the seed path, which resolved an id by picking the first row of whichever catalogue
    // matched the type.
    expect(page, 'the seed path still picks the first microinverter')
      .not.toMatch(/inverterId\s*=\s*MICROINVERTERS\[0\]\?\.id/);
    expect(page, 'the seed path still picks the first string inverter')
      .not.toMatch(/inverterId\s*=\s*STRING_INVERTERS\[0\]\?\.id/);
  });

  it('an unresolvable inverter id yields the UNSELECTED marker, not a manufactured brand', () => {
    const page = code('app/engineering/page.tsx');
    // 🚨 THE INVENTED NAME IS WHAT BECAME AN ARCHITECTURE. `lib/permit/utils/helpers.ts` reads the
    // manufacturer/model STRING to decide micro-vs-string, so a fabricated 'Enphase'/'IQ8+' is not
    // a cosmetic default — it is a topology decision taken by a `??`.
    expect(page, 'the inverter manufacturer is still fabricated from the topology guess')
      .not.toMatch(/inverterManufacturer:\s*invData\?\.manufacturer\s*\?\?\s*\(topology/);
    expect(page, 'the inverter model is still fabricated from the topology guess')
      .not.toMatch(/inverterModel:\s*invData\?\.model\s*\?\?\s*\(topology/);
    // The replacement is the marker the rest of the product already understands.
    expect(page).toContain('INVERTER_UNSELECTED');
  });

  it('the marker the load paths now emit is the one the permit layer recognises', () => {
    expect(isInverterUnselectedMarker(INVERTER_UNSELECTED)).toBe(true);
    // And it cannot be mistaken for a brand by the permit topology resolver, which decides
    // micro-vs-string by searching the model string for manufacturer names.
    for (const brand of ['enphase', 'iq8', 'solaredge', 'fronius', 'tesla']) {
      expect(INVERTER_UNSELECTED.toLowerCase()).not.toContain(brand);
    }
  });
});

describe('🚨 the sheet draws no inverter when none is selected', () => {
  const BASE = {
    projectName: 'NO INVERTER', clientName: 'Ray', address: 'Chicago IL',
    designer: 'SolarPro', drawingDate: '2026-10-01', drawingNumber: 'E-1', revision: 'A',
    scale: 'NOT TO SCALE',
    topologyType: 'STRING_INVERTER', integratedDcDisconnect: false,
    totalModules: 30, totalStrings: 2, deviceCount: 30,
    panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
    dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 20,
    inverterManufacturer: '', inverterModel: INVERTER_UNSELECTED,
    acOutputKw: 0, acOutputAmps: 0, acWireGauge: '#6', acConduitType: 'EMT',
    acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
    mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
    hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
  };

  it('prints the unselected marker and no substituted manufacturer', () => {
    const svg = renderSLDProfessional(BASE as never);
    expect(svg).toContain('INVERTER NOT SELECTED');
    // 🚨 THE WHOLE POINT: nothing on the sheet names a product nobody chose.
    expect(svg).not.toContain('IQ8+');
    expect(svg).not.toContain('SE7600H');
    expect(svg).not.toContain('SolarEdge');
  });
});
