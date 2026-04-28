import { renderSLDProfessional } from './lib/sld-professional-renderer';

const svg = renderSLDProfessional({
  projectName:             'DEBUG — String Only',
  clientName:              'Test',
  address:                 '123 Test St',
  designer:                'Debug',
  drawingDate:             '2025-01-01',
  drawingNumber:           'T-DBG',
  revision:                'A',
  scale:                   'NOT TO SCALE',
  topologyType:            'STRING_INVERTER',
  ecosystemTopology:       'string',
  selectedBrand:           'fronius',
  optimizerQty:            undefined,
  optimizerModel:          undefined,
  integratedDcDisconnect:  false,
  totalModules:            36,
  totalStrings:            3,
  panelsPerString:         12,
  panelModel:              'Generic 400W',
  panelWatts:              400,
  panelVoc:                49.8,
  panelIsc:                9.84,
  dcWireGauge:             '#10',
  dcConduitType:           'EMT',
  dcOCPD:                  20,
  inverterModel:           'Primo 8.2-1',
  inverterManufacturer:    'Fronius',
  acOutputKw:              8.2,
  acOutputAmps:            34.2,
  acWireGauge:             '#10',
  acConduitType:           'EMT',
  acOCPD:                  45,
  mainPanelAmps:           200,
  backfeedAmps:            45,
  utilityName:             'SCE',
  interconnection:         'Load Side Tap',
  rapidShutdownIntegrated: false,
  hasProductionMeter:      false,
  hasBattery:              false,
  batteryModel:            '',
  batteryKwh:              0,
  acWireLength:            50,
  egcGauge:                '#10 AWG',
  mpptChannels:            2,
  mpptAllocation:          'CH1:2str CH2:1str',
  stringVoc:               49.8 * 12,
  stringIsc:               9.84,
});

// Find all occurrences of 'optimizer' in the SVG
const lower = svg.toLowerCase();
let idx = 0;
let count = 0;
while ((idx = lower.indexOf('optimizer', idx)) !== -1) {
  console.log(`Found 'optimizer' at ${idx}: ...${svg.substring(Math.max(0,idx-30), idx+50)}...`);
  count++;
  idx++;
}
console.log(`Total: ${count} occurrences`);