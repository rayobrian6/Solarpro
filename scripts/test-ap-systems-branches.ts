import { buildSegmentSchedule } from '../lib/segment-schedule';

// AP Systems DS3-S: 2.7A per device, 2 panels per device, max 6 per 20A branch
// AP Systems DS3-L: 3.20A per device, 2 panels per device, max 5 per 20A branch
// AP Systems DS3:   3.7A per device,  2 panels per device, max 4 per 20A branch

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

function test(label: string, panels: number, currentA: number, mpd: number, max20A: number, max30A: number) {
  const devices = Math.ceil(panels / mpd);
  // acOutputCurrentA = total system AC output current (all devices combined)
  const acOutputCurrentA = devices * currentA;
  const result = buildSegmentSchedule({
    ...base,
    moduleCount: devices,
    acOutputCurrentA,
    maxDevicesPerBranch: 16,
    microAcCurrentA: currentA,
    manufacturerMaxPerBranch20A: max20A,
    manufacturerMaxPerBranch30A: max30A,
  });
  const seg = result.find(s => s.segmentType === 'JBOX_TO_COMBINER');
  const branches = seg?.conductorBundle?.find(c => c.color === 'BLK')?.qty ?? 0;
  const ocpd = seg?.ocpdAmps ?? 0;
  const devPerBranch = branches > 0 ? Math.ceil(devices / branches) : 0;
  const panelsPerBranch = devPerBranch * mpd;
  const pass = ocpd <= 30 ? '✓' : '✗ FAIL';
  console.log(`${pass} ${label}: ${panels} panels → ${devices} devices → ${branches} branches × ${devPerBranch} devices (${panelsPerBranch} panels) → ${ocpd}A breaker`);
}

console.log('\n=== AP SYSTEMS DS3-S (2.7A, 2 panels/device, max 6 per 20A, max 8 per 30A) ===');
test('DS3-S  20 panels', 20,  2.7,  2, 6, 8);
test('DS3-S  40 panels', 40,  2.7,  2, 6, 8);
test('DS3-S  60 panels', 60,  2.7,  2, 6, 8);

console.log('\n=== AP SYSTEMS DS3-L (3.20A, 2 panels/device, max 5 per 20A, max 7 per 30A) ===');
test('DS3-L  20 panels', 20,  3.20, 2, 5, 7);
test('DS3-L  40 panels', 40,  3.20, 2, 5, 7);
test('DS3-L  60 panels', 60,  3.20, 2, 5, 7);

console.log('\n=== AP SYSTEMS DS3 (3.7A, 2 panels/device, max 4 per 20A, max 6 per 30A) ===');
test('DS3    20 panels', 20,  3.7,  2, 4, 6);
test('DS3    40 panels', 40,  3.7,  2, 4, 6);
test('DS3    60 panels', 60,  3.7,  2, 4, 6);

console.log('\n=== ENPHASE IQ8+ (1.21A, 1 panel/device, no mfr limit) ===');
test('IQ8+   16 panels', 16,  1.21, 1, 0, 0);
test('IQ8+   34 panels', 34,  1.21, 1, 0, 0);
test('IQ8+   40 panels', 40,  1.21, 1, 0, 0);