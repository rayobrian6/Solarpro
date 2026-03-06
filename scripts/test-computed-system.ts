import { computeSystem, type ComputedSystemInput } from '../lib/computed-system';

// AP Systems DS3-S 40 panels = 20 devices × 2.7A = 54A
const input: ComputedSystemInput = {
  topology: 'micro',
  totalPanels: 40,
  panelWatts: 400,
  panelVoc: 49.6,
  panelIsc: 10.5,
  panelVmp: 41.2,
  panelImp: 9.72,
  panelTempCoeffVoc: -0.26,
  panelTempCoeffIsc: 0.05,
  panelMaxSeriesFuse: 20,
  panelModel: 'Generic 400W',
  panelManufacturer: 'Generic',
  inverterManufacturer: 'AP Systems',
  inverterModel: 'DS3-S',
  inverterAcKw: 0.648,  // 2.7A × 240V / 1000 = 0.648 kW
  inverterMaxDcV: 60,
  inverterMpptVmin: 16,
  inverterMpptVmax: 60,
  inverterMaxInputCurrentPerMppt: 13,
  inverterMpptChannels: 2,
  inverterAcCurrentMax: 2.7,
  inverterModulesPerDevice: 2,
  inverterBranchLimit: 16,
  manufacturerMaxPerBranch20A: 6,
  manufacturerMaxPerBranch30A: 8,
  designTempMin: -10,
  ambientTempC: 30,
  rooftopTempAdderC: 30,
  runLengths: {
    ROOF_RUN: 15,
    BRANCH_RUN: 30,
    COMBINER_TO_DISCO_RUN: 40,
    DISCO_TO_METER_RUN: 60,
    MSP_TO_UTILITY_RUN: 10,
  },
  conduitType: 'EMT',
  mainPanelAmps: 200,
  mainPanelBrand: 'Square D',
  panelBusRating: 200,
  maxACVoltageDropPct: 2,
  maxDCVoltageDropPct: 3,
};

console.log('=== computeSystem() for AP Systems DS3-S 40 panels ===');
console.log('20 devices × 2.7A = 54A, 240V, EMT, 30°C ambient');
console.log('');

try {
  const result = computeSystem(input);

  console.log('All runs:');
  result.runs.forEach((run: any) => {
    console.log(`\n  ${run.id}:`);
    console.log(`    wireGauge: ${run.wireGauge}`);
    console.log(`    conductorCount: ${run.conductorCount}`);
    console.log(`    neutralRequired: ${run.neutralRequired}`);
    console.log(`    conduitSize: ${run.conduitSize}`);
    console.log(`    ocpdAmps: ${run.ocpdAmps}A`);
    console.log(`    continuousCurrent: ${run.continuousCurrent}A`);
    console.log(`    conductorCallout: ${run.conductorCallout}`);
  });

  console.log('\n=== KEY CHECKS ===');
  const combToDisco = result.runs.find((r: any) => r.id === 'COMBINER_TO_DISCO_RUN');
  const discoToMeter = result.runs.find((r: any) => r.id === 'DISCO_TO_METER_RUN');

  if (combToDisco) {
    const gauge = combToDisco.wireGauge;
    const notOversized = !['#3/0 AWG','#2/0 AWG','#1/0 AWG','#1 AWG','#2 AWG'].includes(gauge);
    const conductorCountOk = combToDisco.conductorCount === 3;
    const neutralOk = combToDisco.neutralRequired === true;
    console.log(`COMBINER_TO_DISCO_RUN wire: ${gauge} ${notOversized ? '✅ not oversized' : '❌ OVERSIZED!'}`);
    console.log(`  conductorCount=3: ${conductorCountOk ? '✅' : '❌ (got ' + combToDisco.conductorCount + ')'}`);
    console.log(`  neutralRequired=true: ${neutralOk ? '✅' : '❌ (got ' + combToDisco.neutralRequired + ')'}`);
  } else {
    console.log('COMBINER_TO_DISCO_RUN: NOT FOUND');
    console.log('Available:', result.runs.map((r: any) => r.id).join(', '));
  }

  if (discoToMeter) {
    const gauge = discoToMeter.wireGauge;
    const notOversized = !['#3/0 AWG','#2/0 AWG','#1/0 AWG','#1 AWG','#2 AWG'].includes(gauge);
    const conductorCountOk = discoToMeter.conductorCount === 3;
    console.log(`\nDISCO_TO_METER_RUN wire: ${gauge} ${notOversized ? '✅ not oversized' : '❌ OVERSIZED!'}`);
    console.log(`  conductorCount=3: ${conductorCountOk ? '✅' : '❌ (got ' + discoToMeter.conductorCount + ')'}`);
  } else {
    console.log('\nDISCO_TO_METER_RUN: NOT FOUND');
  }

} catch (e: any) {
  console.error('ERROR:', e.message);
  console.error(e.stack);
}