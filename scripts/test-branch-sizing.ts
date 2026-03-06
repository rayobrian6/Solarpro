import { buildSegmentSchedule } from '../lib/segment-schedule';

// Test: 40 panels, IQ8A (1.21A per micro at 240V)
// max devices per 20A breaker = floor(20 / (1.21 × 1.25)) = floor(13.22) = 13
// 40 panels / 13 max = ceil(3.08) = 4 branches, 10 devices each
const result40 = buildSegmentSchedule({
  topology: 'micro',
  moduleCount: 40,
  maxDevicesPerBranch: 16,
  microAcCurrentA: 1.21,
  stringCount: 0,
  stringCurrentA: 0,
  systemVoltageAC: 240,
  acOutputCurrentA: 40 * 1.21,
  mainPanelAmps: 200,
  feederGauge: '#10 AWG',
  egcGauge: '#10 AWG',
  conduitType: 'EMT',
  runLengths: { arrayToJbox:15, jboxToCombiner:30, jboxToInverter:0, combinerToDisco:40, inverterToDisco:0, discoToMeter:60, meterToMsp:0, mspToUtility:10 },
  ambientTempC: 30,
  rooftopTempAdderC: 30,
  maxACVoltageDropPct: 2,
  maxDCVoltageDropPct: 3,
});

const branchSeg40 = result40.find(s => s.segmentType === 'JBOX_TO_COMBINER');
const branches40 = branchSeg40?.conductorBundle?.find(c => c.color === 'BLK')?.qty ?? 0;
console.log('\n=== 40 PANELS (IQ8A @ 1.21A) ===');
console.log(`Branch OCPD:        ${branchSeg40?.ocpdAmps}A       (expected: 20A)`);
console.log(`Branches:           ${branches40}          (expected: 4)`);
console.log(`Devices per branch: ${Math.ceil(40 / branches40)}         (expected: 10)`);
console.log(`Branch current:     ${branchSeg40?.continuousCurrent?.toFixed(2)}A   (expected: 12.10A)`);

// Test: 34 panels, IQ8A
// 34 / 13 = ceil(2.62) = 3 branches, 12+11+11
const result34 = buildSegmentSchedule({
  topology: 'micro',
  moduleCount: 34,
  maxDevicesPerBranch: 16,
  microAcCurrentA: 1.21,
  stringCount: 0,
  stringCurrentA: 0,
  systemVoltageAC: 240,
  acOutputCurrentA: 34 * 1.21,
  mainPanelAmps: 200,
  feederGauge: '#10 AWG',
  egcGauge: '#10 AWG',
  conduitType: 'EMT',
  runLengths: { arrayToJbox:15, jboxToCombiner:30, jboxToInverter:0, combinerToDisco:40, inverterToDisco:0, discoToMeter:60, meterToMsp:0, mspToUtility:10 },
  ambientTempC: 30,
  rooftopTempAdderC: 30,
  maxACVoltageDropPct: 2,
  maxDCVoltageDropPct: 3,
});

const branchSeg34 = result34.find(s => s.segmentType === 'JBOX_TO_COMBINER');
const branches34 = branchSeg34?.conductorBundle?.find(c => c.color === 'BLK')?.qty ?? 0;
console.log('\n=== 34 PANELS (IQ8A @ 1.21A) ===');
console.log(`Branch OCPD:        ${branchSeg34?.ocpdAmps}A       (expected: 20A)`);
console.log(`Branches:           ${branches34}          (expected: 3)`);
console.log(`Devices per branch: ${Math.ceil(34 / branches34)}        (expected: 12)`);
console.log(`Branch current:     ${branchSeg34?.continuousCurrent?.toFixed(2)}A   (expected: 14.52A)`);

// Test: 16 panels, IQ8A — should be 2 branches of 8
const result16 = buildSegmentSchedule({
  topology: 'micro',
  moduleCount: 16,
  maxDevicesPerBranch: 16,
  microAcCurrentA: 1.21,
  stringCount: 0,
  stringCurrentA: 0,
  systemVoltageAC: 240,
  acOutputCurrentA: 16 * 1.21,
  mainPanelAmps: 200,
  feederGauge: '#10 AWG',
  egcGauge: '#10 AWG',
  conduitType: 'EMT',
  runLengths: { arrayToJbox:15, jboxToCombiner:30, jboxToInverter:0, combinerToDisco:40, inverterToDisco:0, discoToMeter:60, meterToMsp:0, mspToUtility:10 },
  ambientTempC: 30,
  rooftopTempAdderC: 30,
  maxACVoltageDropPct: 2,
  maxDCVoltageDropPct: 3,
});

const branchSeg16 = result16.find(s => s.segmentType === 'JBOX_TO_COMBINER');
const branches16 = branchSeg16?.conductorBundle?.find(c => c.color === 'BLK')?.qty ?? 0;
console.log('\n=== 16 PANELS (IQ8A @ 1.21A) ===');
console.log(`Branch OCPD:        ${branchSeg16?.ocpdAmps}A       (expected: 20A)`);
console.log(`Branches:           ${branches16}          (expected: 2)`);
console.log(`Devices per branch: ${Math.ceil(16 / branches16)}         (expected: 8)`);
console.log(`Branch current:     ${branchSeg16?.continuousCurrent?.toFixed(2)}A   (expected: 9.68A)`);

console.log('\n=== RULE SUMMARY ===');
const perDeviceA = 1.21;
const maxFor20A = Math.floor(20 / (perDeviceA * 1.25));
console.log(`IQ8A (1.21A): max ${maxFor20A} devices per 20A breaker`);
console.log(`  floor(20 / (1.21 × 1.25)) = floor(20 / 1.5125) = floor(13.22) = ${maxFor20A}`);
