// Simulate the rules engine for the reported scenario
// 36 panels, Qcells 400W, SE7600H x2, optimizer topology

import { runRulesEngine } from '../lib/rules-engine';

// Build input matching the screenshot
const input = {
  electrical: {
    designTempMin: -10,
    designTempMax: 40,
    rooftopTempAdder: 30,
    necVersion: '2020',
    inverters: [
      {
        type: 'optimizer' as const,
        acOutputKw: 7.6,
        acOutputCurrentMax: 32,
        maxDcVoltage: 480,
        mpptVoltageMin: 200,
        mpptVoltageMax: 480,
        nominalDcVoltage: 400,
        mpptChannels: 1,
        maxInputCurrentPerMppt: 20.0,
        maxParallelStringsPerMppt: 2,
        strings: [
          { panelCount: 9, panelVoc: 45.29, panelIsc: 11.2, panelImp: 10.61, panelVmp: 37.7, panelWatts: 400, tempCoeffVoc: -0.26, tempCoeffIsc: 0.04, maxSeriesFuseRating: 20, wireGauge: '10 AWG', wireLength: 50, conduitType: 'EMT' },
          { panelCount: 9, panelVoc: 45.29, panelIsc: 11.2, panelImp: 10.61, panelVmp: 37.7, panelWatts: 400, tempCoeffVoc: -0.26, tempCoeffIsc: 0.04, maxSeriesFuseRating: 20, wireGauge: '10 AWG', wireLength: 50, conduitType: 'EMT' },
        ],
      },
      {
        type: 'optimizer' as const,
        acOutputKw: 7.6,
        acOutputCurrentMax: 32,
        maxDcVoltage: 480,
        mpptVoltageMin: 200,
        mpptVoltageMax: 480,
        nominalDcVoltage: 400,
        mpptChannels: 1,
        maxInputCurrentPerMppt: 20.0,
        maxParallelStringsPerMppt: 2,
        strings: [
          { panelCount: 9, panelVoc: 45.29, panelIsc: 11.2, panelImp: 10.61, panelVmp: 37.7, panelWatts: 400, tempCoeffVoc: -0.26, tempCoeffIsc: 0.04, maxSeriesFuseRating: 20, wireGauge: '10 AWG', wireLength: 50, conduitType: 'EMT' },
          { panelCount: 9, panelVoc: 45.29, panelIsc: 11.2, panelImp: 10.61, panelVmp: 37.7, panelWatts: 400, tempCoeffVoc: -0.26, tempCoeffIsc: 0.04, maxSeriesFuseRating: 20, wireGauge: '10 AWG', wireLength: 50, conduitType: 'EMT' },
        ],
      },
    ],
    mainPanelAmps: 200,
    systemVoltage: 240,
    wireGauge: '10 AWG',
    wireLength: 50,
    conduitType: 'EMT',
    rapidShutdown: true,
    acDisconnect: true,
    dcDisconnect: true,
    interconnection: { method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 },
  } as any,
  structural: {
    installationType: 'roof_residential',
    windSpeed: 115,
    groundSnowLoad: 20,
    exposureCategory: 'C',
    roofType: 'shingle',
    rafterSize: '2x6',
    rafterSpacing: 24,
    spanLength: 12,
    attachmentSpacing: 48,
    moduleCount: 36,
    moduleWeight: 44,
  } as any,
  engineeringMode: 'AUTO' as const,
  overrides: [] as any[],
};

const result = runRulesEngine(input);
console.log('='.repeat(80));
console.log('OVERALL STATUS:', result.overallStatus);
console.log('ERROR COUNT:', result.errorCount);
console.log('WARNING COUNT:', result.warningCount);
console.log('='.repeat(80));
console.log('\nRULES WITH SEVERITY = ERROR:');
result.rules.filter(r => r.severity === 'error').forEach(r => {
  console.log(`  - ${r.ruleId}: ${r.title}`);
  console.log(`    ${r.message}`);
  console.log(`    autoFixed: ${r.autoFixed}`);
});
console.log('\nALL RULES:');
result.rules.forEach(r => {
  console.log(`  [${r.severity.toUpperCase()}] ${r.ruleId}: ${r.title} — value=${r.value} limit=${r.limit}`);
});
