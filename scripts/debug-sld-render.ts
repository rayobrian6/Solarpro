import { renderSLDProfessional } from '../lib/sld-professional-renderer';
import { computeSystem } from '../lib/computed-system';
import * as fs from 'fs';

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

const svg = renderSLDProfessional({
  projectName: 'Test System',
  clientName: 'Test Client',
  address: '123 Main St',
  designer: 'SolarPro Engineering',
  drawingDate: '2026-03-06',
  drawingNumber: 'SLD-001',
  revision: 'A',
  topologyType: 'MICROINVERTER',
  totalModules: 34,
  totalStrings: 0,
  panelModel: 'Test Panel 400W',
  panelWatts: 400,
  panelVoc: 41.6,
  panelIsc: 12.26,
  dcWireGauge: '#10 AWG',
  dcConduitType: 'EMT',
  dcOCPD: 0,
  inverterModel: 'IQ8+',
  inverterManufacturer: 'Enphase',
  acOutputKw: 10.03,
  acOutputAmps: 42,
  acWireGauge: '#6 AWG',
  acConduitType: 'EMT',
  acOCPD: 50,
  acWireLength: 60,
  backfeedAmps: 50,
  mainPanelAmps: 200,
  utilityName: 'Test Utility',
  interconnection: 'Load Side Tap',
  rapidShutdownIntegrated: true,
  hasProductionMeter: false,
  hasBattery: false,
  batteryModel: '',
  batteryKwh: 0,
  scale: 'NOT TO SCALE',
  deviceCount: 34,
  microBranches: cs.microBranches,
  branchWireGauge: cs.runs?.find(r => r.id === 'BRANCH_RUN')?.wireGauge,
  branchConduitSize: cs.runs?.find(r => r.id === 'BRANCH_RUN')?.conduitSize,
  branchOcpdAmps: cs.runs?.find(r => r.id === 'BRANCH_RUN')?.ocpdAmps,
  runs: cs.runs,
});

fs.writeFileSync('/workspace/debug_sld_output.svg', svg);
console.log('SVG written to debug_sld_output.svg, length:', svg.length);

// Extract all text elements to see what's being rendered
const textMatches = svg.match(/<text[^>]*>([^<]*)<\/text>/g) || [];
console.log('\n=== TEXT ELEMENTS IN SLD ===');
textMatches.forEach(t => {
  const content = t.replace(/<[^>]*>/g, '').trim();
  if (content) console.log(' ', content);
});