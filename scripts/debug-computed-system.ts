// Debug script — run with: npx ts-node --project tsconfig.test.json scripts/debug-computed-system.ts
import { computeSystem } from '../lib/computed-system';

const cs = computeSystem({
  topology: 'micro',
  totalPanels: 34,
  panelWatts: 400,
  panelVoc: 41.6,
  panelIsc: 12.26,
  panelVmp: 34.5,
  panelImp: 11.59,
  panelTempCoeffVoc: -0.26,
  panelTempCoeffIsc: 0.05,
  panelMaxSeriesFuse: 20,
  panelModel: 'Test Panel 400W',
  panelManufacturer: 'Test',
  inverterManufacturer: 'Enphase',
  inverterModel: 'IQ8+',
  inverterAcKw: 0.295,
  inverterMaxDcV: 60,
  inverterMpptVmin: 16,
  inverterMpptVmax: 60,
  inverterMaxInputCurrentPerMppt: 15,
  inverterMpptChannels: 1,
  inverterAcCurrentMax: 1.21,
  inverterModulesPerDevice: 1,
  inverterBranchLimit: 16,
  designTempMin: -10,
  ambientTempC: 30,
  rooftopTempAdderC: 10,
  runLengths: {},
  conduitType: 'EMT',
  mainPanelAmps: 200,
  mainPanelBrand: 'Square D',
  panelBusRating: 200,
  interconnectionMethod: 'LOAD_SIDE',
  branchCount: 3,
  maxACVoltageDropPct: 2,
  maxDCVoltageDropPct: 3,
});

console.log('\n=== COMPUTED SYSTEM DEBUG ===\n');
console.log('isMicro:', cs.isMicro);
console.log('acBranchCount:', (cs as any).acBranchCount);
console.log('microBranches count:', cs.microBranches?.length);
console.log('segmentInterconnectionPass:', cs.segmentInterconnectionPass);
console.log('\n=== RUNS ===');
for (const run of cs.runs) {
  console.log(`\n[${run.id}]`);
  console.log(`  label: ${run.label}`);
  console.log(`  wireGauge: ${run.wireGauge}`);
  console.log(`  egcGauge: ${run.egcGauge}`);
  console.log(`  conduitSize: ${run.conduitSize}`);
  console.log(`  conduitType: ${run.conduitType}`);
  console.log(`  conductorCount: ${run.conductorCount}`);
  console.log(`  neutralRequired: ${run.neutralRequired}`);
  console.log(`  ocpdAmps: ${run.ocpdAmps}`);
  console.log(`  conductorBundle: ${run.conductorBundle ? JSON.stringify(run.conductorBundle) : 'MISSING!'}`);
  console.log(`  conductorCallout: ${run.conductorCallout ?? 'none'}`);
  console.log(`  overallPass: ${run.overallPass}`);
}

console.log('\n=== SEGMENT SCHEDULE ===');
for (const seg of cs.segmentSchedule) {
  console.log(`\n[${seg.segmentType}] ${seg.fromNode} → ${seg.toNode}`);
  console.log(`  conductorBundle: ${JSON.stringify(seg.conductorBundle)}`);
  console.log(`  conduitSize: ${seg.conduitSize}`);
  console.log(`  ocpdAmps: ${seg.ocpdAmps}`);
}

console.log('\n=== INTERCONNECTION ===');
console.log('interconnectionMethod input: LOAD_SIDE');
console.log('segmentInterconnectionPass:', cs.segmentInterconnectionPass);
console.log('segments:', cs.segments?.map((s: any) => s.type));