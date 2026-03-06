import { buildSegmentSchedule } from '../lib/segment-schedule';

const input = {
  topology: 'micro' as const,
  moduleCount: 20,
  acOutputCurrentA: 54,
  stringCount: 0,
  stringCurrentA: 0,
  systemVoltageAC: 240,
  mainPanelAmps: 200,
  conduitType: 'EMT' as const,
  feederGauge: '#3 AWG',
  egcGauge: '#8 AWG',
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

console.log('=== TEST: AP Systems DS3-S 40 panels (20 devices x 2.7A = 54A) ===');
console.log('Expected: COMBINER_TO_DISCO_RUN = #3 AWG (NOT 3/0 AWG)');
console.log('Expected: DISCO_TO_METER_RUN = #3 AWG');
console.log('');

const segments = buildSegmentSchedule(input);

let passed = 0;
let failed = 0;

console.log('All segment types:', segments.map((s: any) => s.segmentType));
console.log('');

segments.forEach((seg: any) => {
  if (seg.segmentType === 'COMBINER_TO_DISCO' || seg.segmentType === 'DISCO_TO_METER') {
    const bundle = seg.conductorBundle || [];
    const mainWire = bundle.find((c: any) => c.color !== 'green' && c.color !== 'bare') || bundle[0];
    const wireGauge = mainWire?.gauge || 'unknown';
    const ok = wireGauge.includes('#3') && !wireGauge.includes('3/0') && !wireGauge.includes('#30');
    console.log(seg.segmentType + ': ' + wireGauge + ' ' + (ok ? '✅ PASS' : '❌ FAIL (expected #3 AWG, got ' + wireGauge + ')'));
    console.log('  Bundle: ' + JSON.stringify(bundle.map((c: any) => c.qty + 'x ' + c.gauge + ' ' + c.color)));
    console.log('  Conduit: ' + seg.conduitSize + ', OCPD: ' + seg.ocpdAmps + 'A');
    ok ? passed++ : failed++;
  }
});

console.log('');
console.log('=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) {
  console.log('❌ FIX NOT WORKING - wire sizing bug still present');
  process.exit(1);
} else {
  console.log('✅ FIX CONFIRMED - wire sizing is correct');
}