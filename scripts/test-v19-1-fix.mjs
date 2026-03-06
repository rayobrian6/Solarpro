// Direct test of the v19.1 fix - AP Systems 40 panel wire sizing
// Tests that COMBINER_TO_DISCO_RUN shows #3 AWG, not 3/0 AWG

import { computeSystem } from '../lib/computed-system.ts';

// We'll test via the segment-schedule which is what the UI uses
import { buildSegmentSchedule } from '../lib/segment-schedule.ts';

const input = {
  topology: 'micro',
  moduleCount: 20,           // 20 DS3-S devices (2 panels each = 40 panels)
  acOutputCurrentA: 54,      // 20 devices × 2.7A = 54A
  stringCount: 0,
  stringCurrentA: 0,
  systemVoltageAC: 240,
  mainPanelAmps: 200,
  conduitType: 'EMT',
  ambientTempC: 30,
  rooftopTempAdderC: 30,
  maxACVoltageDropPct: 2,
  maxDCVoltageDropPct: 3,
  maxDevicesPerBranch: 16,
  microAcCurrentA: 2.7,
  manufacturerMaxPerBranch20A: 6,
  manufacturerMaxPerBranch30A: 8,
  runLengths: {
    arrayToJbox: 15,
    jboxToCombiner: 30,
    jboxToInverter: 0,
    combinerToDisco: 40,
    inverterToDisco: 0,
    discoToMeter: 60,
    meterToMsp: 0,
    mspToUtility: 10
  }
};

console.log('=== TEST: AP Systems DS3-S 40 panels (20 devices × 2.7A = 54A) ===');
console.log('Expected: COMBINER_TO_DISCO_RUN = #3 AWG (NOT 3/0 AWG)');
console.log('Expected: DISCO_TO_METER_RUN = #3 AWG');
console.log('');

const segments = buildSegmentSchedule(input);

let passed = 0;
let failed = 0;

segments.forEach(seg => {
  const mainWire = seg.conductorBundle?.find(c => c.color === 'black' || c.color === 'red' || c.color === 'hot');
  const wireGauge = mainWire?.gauge || seg.conductorBundle?.[0]?.gauge || 'unknown';
  
  if (seg.segmentType === 'COMBINER_TO_DISCO_RUN') {
    const ok = wireGauge === '#3 AWG' || wireGauge === '#3';
    console.log(`COMBINER_TO_DISCO_RUN: ${wireGauge} ${ok ? '✅ PASS' : '❌ FAIL (expected #3 AWG)'}`);
    console.log(`  Full bundle: ${JSON.stringify(seg.conductorBundle)}`);
    console.log(`  Conduit: ${seg.conduitSize}, OCPD: ${seg.ocpdAmps}A`);
    ok ? passed++ : failed++;
  }
  
  if (seg.segmentType === 'DISCO_TO_METER_RUN') {
    const ok = wireGauge === '#3 AWG' || wireGauge === '#3';
    console.log(`DISCO_TO_METER_RUN: ${wireGauge} ${ok ? '✅ PASS' : '❌ FAIL (expected #3 AWG)'}`);
    console.log(`  Full bundle: ${JSON.stringify(seg.conductorBundle)}`);
    ok ? passed++ : failed++;
  }
});

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);