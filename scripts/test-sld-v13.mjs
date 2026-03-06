// Quick render test for SLD V13 — Professional Conductor Landing
import { renderSLDProfessional } from '../lib/sld-professional-renderer.js';

// We'll use a dynamic import since this is ESM
async function main() {
  // Use the compiled JS via ts-node
  const { execSync } = await import('child_process');
  const { writeFileSync } = await import('fs');

  const result = execSync(
    `node -e "
const { renderSLDProfessional } = require('./lib/sld-professional-renderer');
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
  branchConduitSize: '3/4\&quot;',
  branchOcpdAmps: 20,
});
console.log('SVG length:', svg.length);
console.log('Has AC COMBINER:', svg.includes('AC COMBINER'));
console.log('Has COMBINER BUS:', svg.includes('COMBINER BUS'));
console.log('Has AC DISCONNECT:', svg.includes('AC DISCONNECT'));
console.log('Has LINE:', svg.includes('LINE'));
console.log('Has LOAD:', svg.includes('LOAD'));
console.log('Has MAIN SERVICE PANEL:', svg.includes('MAIN SERVICE PANEL'));
console.log('Has MAIN BUS:', svg.includes('MAIN BUS'));
console.log('Has PV BREAKER:', svg.includes('PV BREAKER'));
console.log('Has LOAD SIDE TAP:', svg.includes('LOAD SIDE TAP'));
console.log('Has NEC 705.12:', svg.includes('NEC 705.12'));
console.log('Has FEEDER LUG:', svg.includes('FEEDER'));
console.log('Has LOAD LUG:', svg.includes('LOAD LUG'));
require('fs').writeFileSync('/workspace/outputs/sld-v13-test.svg', svg);
console.log('Written to outputs/sld-v13-test.svg');
"
    `,
    { cwd: '/workspace', encoding: 'utf8' }
  );
  console.log(result);
}

main().catch(console.error);