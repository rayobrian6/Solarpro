import { renderSLDProfessional } from './lib/sld-professional-renderer';
import * as fs from 'fs';

const svg = renderSLDProfessional({
  projectName:             '123 Oak Street Solar',
  clientName:              'John Smith',
  address:                 '123 Oak Street, Austin TX 78701',
  designer:                'SolarPro Engineering',
  drawingDate:             '2026-03-04',
  drawingNumber:           'SLD-001',
  revision:                'A',
  topologyType:            'STRING_INVERTER',
  totalModules:            20,
  totalStrings:            2,
  panelModel:              'Q.PEAK DUO BLK ML-G10+ 400W',
  panelWatts:              400,
  panelVoc:                49.6,
  panelIsc:                10.18,
  dcWireGauge:             '#10 AWG',
  dcConduitType:           'EMT',
  dcOCPD:                  20,
  inverterModel:           'Primo 8.2-1',
  inverterManufacturer:    'Fronius',
  acOutputKw:              8.2,
  acOutputAmps:            34,
  acWireGauge:             '#8 AWG',
  acConduitType:           'EMT',
  acOCPD:                  40,
  acWireLength:            60,
  backfeedAmps:            40,
  mainPanelAmps:           200,
  utilityName:             'Austin Energy',
  interconnection:         'Backfeed Breaker',
  rapidShutdownIntegrated: true,
  hasProductionMeter:      true,
  hasBattery:              false,
  batteryModel:            '',
  batteryKwh:              0,
  scale:                   'NOT TO SCALE',
});

console.log('SVG length:', svg.length);
console.log('Has SVG tag:', svg.startsWith('<svg'));
console.log('Has title block:', svg.includes('SINGLE LINE DIAGRAM'));
console.log('Has PV Array:', svg.includes('PV ARRAY'));
console.log('Has STRING INVERTER:', svg.includes('STRING INVERTER'));
console.log('Has AC DISCONNECT:', svg.includes('AC DISCONNECT'));
console.log('Has PRODUCTION METER:', svg.includes('PRODUCTION METER'));
console.log('Has MAIN SERVICE PANEL:', svg.includes('MAIN SERVICE PANEL'));
console.log('Has UTILITY GRID:', svg.includes('UTILITY GRID'));
console.log('Has NEC refs:', svg.includes('NEC 690'));
console.log('Has grounding:', svg.includes('GROUNDING'));
console.log('Has notes block:', svg.includes('GENERAL NOTES'));
console.log('Has revision table:', svg.includes('REVISIONS'));
console.log('Has 120% rule:', svg.includes('120%'));

fs.writeFileSync('/workspace/test_sld_output.svg', svg);
console.log('SVG saved to /workspace/test_sld_output.svg');