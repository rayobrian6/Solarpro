import { buildSegmentSchedule } from '../lib/segment-schedule';

// AP Systems DS3-S 40 panels
const base = {
  topology: 'micro' as const,
  stringCount: 0, stringCurrentA: 0,
  systemVoltageAC: 240, mainPanelAmps: 200,
  feederGauge: '#10 AWG', egcGauge: '#10 AWG',
  conduitType: 'EMT',
  runLengths: { arrayToJbox:15, jboxToCombiner:30, jboxToInverter:0, combinerToDisco:40, inverterToDisco:0, discoToMeter:60, meterToMsp:0, mspToUtility:10 },
  ambientTempC: 30, rooftopTempAdderC: 30,
  maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3,
};

const panels = 40;
const currentA = 2.7;
const devices = Math.ceil(panels / 2); // DS3-S: 2 panels per device
const acOutputCurrentA = devices * currentA;

console.log(`\n=== DEBUG: AP Systems DS3-S ${panels} panels ===`);
console.log(`Devices: ${devices}`);
console.log(`Current per device: ${currentA}A`);
console.log(`Total AC current: ${acOutputCurrentA}A`);
console.log(`Required ampacity (125%): ${(acOutputCurrentA * 1.25).toFixed(1)}A`);

const result = buildSegmentSchedule({
  ...base,
  moduleCount: devices,
  acOutputCurrentA,
  maxDevicesPerBranch: 16,
  microAcCurrentA: currentA,
  manufacturerMaxPerBranch20A: 6,
  manufacturerMaxPerBranch30A: 8,
});

console.log(`\n=== SEGMENTS ===`);
result.forEach(seg => {
  console.log(`\n${seg.segmentType}:`);
  console.log(`  From: ${seg.fromNode} → To: ${seg.toNode}`);
  console.log(`  Wire: ${seg.conductorBundle.map(c => `${c.qty}× ${c.gauge} ${c.color}`).join(', ')}`);
  console.log(`  Conduit: ${seg.conduitSize}`);
  console.log(`  OCPD: ${seg.ocpdAmps}A`);
  console.log(`  Current: ${seg.continuousCurrentA}A`);
});

console.log(`\n=== CONDUIT SCHEDULE MISMATCH ===`);
const segmentsWithConduit = result.filter(s => s.conduitSize !== 'N/A');
console.log(`Segments with conduit: ${segmentsWithConduit.length}`);
console.log(`Total segments: ${result.length}`);