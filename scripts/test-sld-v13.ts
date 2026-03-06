// @ts-nocheck
import { renderSLDProfessional } from '../lib/sld-professional-renderer';
import * as fs from 'fs';
import * as path from 'path';

const svg = renderSLDProfessional({
  projectName: 'Test Project',
  clientName: 'Test Client',
  address: '123 Main St, Anytown CA 90210',
  designer: 'J. Smith',
  drawingDate: '2025-01-01',
  drawingNumber: 'SLD-001',
  revision: 'A',
  topologyType: 'MICROINVERTER',
  totalModules: 34,
  totalStrings: 0,
  panelModel: 'REC400AA',
  panelWatts: 400,
  panelVoc: 49.6,
  panelIsc: 10.5,
  dcWireGauge: '#10 AWG',
  dcConduitType: 'EMT',
  dcOCPD: 20,
  inverterModel: 'IQ8A',
  inverterManufacturer: 'Enphase',
  acOutputKw: 11.56,
  acOutputAmps: 48.2,
  acWireGauge: '#6 AWG',
  acConduitType: 'EMT',
  acOCPD: 60,
  mainPanelAmps: 200,
  backfeedAmps: 60,
  utilityName: 'SCE',
  interconnection: 'LOAD_SIDE',
  rapidShutdownIntegrated: true,
  hasProductionMeter: false,
  hasBattery: false,
  batteryModel: '',
  batteryKwh: 0,
  scale: 'NOT TO SCALE',
  acWireLength: 50,
  deviceCount: 34,
  branchWireGauge: '#10 AWG',
  branchConduitSize: '3/4"',
  branchOcpdAmps: 20,
});

const checks = [
  ['SVG length > 10000', svg.length > 10000],
  ['Has AC COMBINER', svg.includes('AC COMBINER')],
  ['Has COMBINER BUS', svg.includes('COMBINER BUS')],
  ['Has AC DISCONNECT', svg.includes('AC DISCONNECT')],
  ['Has LINE terminals', svg.includes('>LINE<')],
  ['Has LOAD terminals', svg.includes('>LOAD<')],
  ['Has MAIN SERVICE PANEL', svg.includes('MAIN SERVICE PANEL')],
  ['Has MAIN BUS', svg.includes('MAIN BUS')],
  ['Has PV BREAKER', svg.includes('PV BREAKER')],
  ['Has LOAD SIDE TAP', svg.includes('LOAD SIDE TAP')],
  ['Has NEC 705.12', svg.includes('NEC 705.12')],
  ['Has FEEDER LUG', svg.includes('FEEDER')],
  ['Has LOAD LUG', svg.includes('LOAD LUG')],
  ['Has LOAD LUG text', svg.includes('LOAD LUG')],
  ['No BACKFED BREAKER for load-side', !svg.includes('BACKFED BREAKER')],
  ['Has NEC 690.14 (AC Disco)', svg.includes('NEC 690.14')],
  ['Has ROOF J-BOX', svg.includes('ROOF J-BOX')],
  ['Has PV ARRAY', svg.includes('PV ARRAY')],
  ['Has UTILITY METER', svg.includes('UTILITY METER')],
  ['Has UTILITY GRID', svg.includes('UTILITY GRID')],
  ['Has EGC grounding rail', svg.includes('EQUIPMENT GROUNDING')],
];

let passed = 0, failed = 0;
for (const [name, result] of checks) {
  const icon = result ? '✓' : '✗';
  console.log(`  ${icon} ${name}`);
  if (result) passed++; else failed++;
}

console.log(`\n${passed}/${checks.length} checks passed`);

const outDir = path.join(__dirname, '..', 'outputs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'sld-v13-test.svg'), svg);
console.log('\nWritten to outputs/sld-v13-test.svg');

if (failed > 0) process.exit(1);