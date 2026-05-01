import { runRulesEngine } from '../lib/rules-engine';

// Simulated SE7600H + Silfab 405W x 36 (4 strings of 9)
const input = {
  electrical: {
    inverters: [{
      type: 'string',
      acOutputKw: 7.6,
      maxDcVoltage: 600,
      mpptVoltageMin: 100,
      mpptVoltageMax: 600,
      mpptChannels: 1,
      maxInputCurrentPerMppt: 20,
      maxShortCircuitCurrent: 24,
      acOutputCurrentMax: 32,
      maxParallelStringsPerMppt: 2,
      nominalDcVoltage: 400,
      strings: [
        { panelCount: 9, panelVoc: 41.6, panelIsc: 12.26, panelImp: 11.59, panelVmp: 34.5, panelWatts: 405, tempCoeffVoc: -0.26, tempCoeffIsc: 0.05, maxSeriesFuseRating: 20, wireGauge: '10', wireLength: 50, conduitType: 'EMT' },
        { panelCount: 9, panelVoc: 41.6, panelIsc: 12.26, panelImp: 11.59, panelVmp: 34.5, panelWatts: 405, tempCoeffVoc: -0.26, tempCoeffIsc: 0.05, maxSeriesFuseRating: 20, wireGauge: '10', wireLength: 50, conduitType: 'EMT' },
        { panelCount: 9, panelVoc: 41.6, panelIsc: 12.26, panelImp: 11.59, panelVmp: 34.5, panelWatts: 405, tempCoeffVoc: -0.26, tempCoeffIsc: 0.05, maxSeriesFuseRating: 20, wireGauge: '10', wireLength: 50, conduitType: 'EMT' },
        { panelCount: 9, panelVoc: 41.6, panelIsc: 12.26, panelImp: 11.59, panelVmp: 34.5, panelWatts: 405, tempCoeffVoc: -0.26, tempCoeffIsc: 0.05, maxSeriesFuseRating: 20, wireGauge: '10', wireLength: 50, conduitType: 'EMT' },
      ],
    }],
    mainPanelAmps: 200,
    systemVoltage: 240,
    wireGauge: '6',
    wireLength: 50,
    conduitType: 'EMT',
    rapidShutdown: true,
    acDisconnect: true,
    dcDisconnect: true,
    necVersion: '2023' as const,
    designTempMin: -10,
    designTempMax: 40,
    rooftopTempAdder: 30,
    interconnection: { method: 'LOAD_SIDE' as const, busRating: 200, mainBreaker: 200 },
  },
  structural: {
    windSpeed: 115,
    windExposure: 'C' as const,
    groundSnowLoad: 20,
    roofPitch: 6/12,
    rafterSpacing: 24,
    rafterSpan: 12,
    rafterSize: '2x6',
    rafterSpecies: 'DF-L',
    attachmentSpacing: 48,
    panelCount: 36,
    panelLength: 75,
    panelWidth: 42,
    panelWeight: 45,
    rackingWeight: 4.0,
    mountingSystemId: 'ironridge-xr100',
    roofDeadLoadPsf: 15,
    framingType: 'rafter' as const,
  },
  engineeringMode: 'AUTO' as const,
  overrides: [],
};

const result = runRulesEngine(input as any);
console.log('OVERALL STATUS:', result.overallStatus);
console.log('errorCount:', result.errorCount, 'warningCount:', result.warningCount);
console.log('');
console.log('=== ALL RULES ===');
result.rules.forEach((r: any, i: number) => {
  console.log(`[${i}] ${r.severity.toUpperCase()} | ${r.ruleId} | ${r.title}`);
  console.log(`     msg: ${r.message}`);
  console.log(`     value=${r.value} limit=${r.limit}`);
});
console.log('');
console.log('=== ELECTRICAL RESULT STATUS:', result.electricalResult.status);
console.log('=== ELECTRICAL ERRORS:');
result.electricalResult.errors?.forEach((e: any) => console.log(' -', e.code, ':', e.message));
console.log('=== STRUCTURAL STATUS:', result.structuralResult.status);