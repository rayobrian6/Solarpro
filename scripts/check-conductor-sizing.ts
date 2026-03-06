// @ts-nocheck
import { computeSystem } from '../lib/computed-system';

const result = computeSystem({
  topology: 'micro',
  totalPanels: 34,
  panelId: 'REC400AA',
  inverterId: 'IQ8A',
  inverterType: 'micro',
  panelWatts: 400,
  panelVoc: 49.6,
  panelVmp: 41.2,
  panelIsc: 10.5,
  panelImp: 9.7,
  inverterAcKw: 0.349,        // PER-DEVICE kW (IQ8A = 349W)
  inverterAcCurrentMax: 1.21, // PER-DEVICE amps
  inverterBranchLimit: 16,
  inverterModulesPerDevice: 1,
  inverterMaxDcVoltage: 60,
  conduitType: 'EMT',
  mainPanelAmps: 200,
  panelBusRating: 200,
  interconnectionMethod: 'LOAD_SIDE',
  branchCount: 3,
  ambientTempC: 30,
  rooftopTempAdderC: 33,
  runLengths: {},
});

console.log('=== CONDUCTOR SIZING CHECK ===');
console.log(`Topology: ${result.topology}`);
console.log(`Total AC output: ${result.acOutputCurrentA.toFixed(2)}A`);
console.log(`Branch current: ${result.acBranchCurrentA.toFixed(2)}A`);
console.log(`Branch OCPD: ${result.acBranchOcpdAmps}A`);
console.log(`AC OCPD (feeder): ${result.acOcpdAmps}A`);
console.log('');
console.log('Runs:');
result.runs.forEach(r => {
  console.log(`  ${r.id}:`);
  console.log(`    Wire: ${r.wireGauge} | OCPD: ${r.ocpdAmps}A | conduit: ${r.conduitSize} ${r.conduitType}`);
  console.log(`    continuousCurrent: ${r.continuousCurrent}A | requiredAmpacity: ${r.requiredAmpacity}A`);
  if (r.conductorBundle && r.conductorBundle.length > 0) {
    r.conductorBundle.forEach((c: any) => {
      console.log(`    Bundle: ${c.qty}x ${c.gauge} ${c.insulation} ${c.color} (carrying: ${c.isCurrentCarrying})`);
    });
  }
});