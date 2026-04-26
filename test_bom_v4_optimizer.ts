import { generateBOMV4 } from '@/lib/bom-engine-v4';

console.log('\n=== TEST 1: se-11400h as optimizerId (legacy bug scenario) ===');
const result1 = generateBOMV4({
  inverterId: 'se-11400h',
  optimizerId: 'se-11400h',  // BUG: central inverter passed as optimizerId
  panelId: 'qcells-peak-duo-400',
  moduleCount: 36,
  inverterCount: 1,
  stringCount: 3,
  systemKw: 14.4,
  topologyType: 'STRING_WITH_OPTIMIZER',
  dcWireGauge: '#10 AWG',
  dcWireLength: 50,
  acWireGauge: '#6 AWG',
  acWireLength: 50,
  conduitType: 'EMT',
  conduitSizeInch: '3/4',
  acOCPD: 60,
  backfeedAmps: 60,
  mainPanelAmps: 200,
  requiresDCDisconnect: true,
  dcOCPD: 20,
  roofType: 'shingle',
  attachmentCount: 18,
  railSections: 9,
  jurisdiction: 'CA',
  interconnectionMethod: 'LOAD_SIDE',
  panelBusRating: 200,
} as any);

const stage1 = result1.items.filter(i => i.stageId === 'array');
const stage3 = result1.items.filter(i => i.stageId === 'inverter');
console.log('Stage 1 items:');
stage1.forEach(i => console.log(`  ${i.manufacturer} ${i.model} × ${i.quantity} (category: ${i.category})`));
console.log('Stage 3 items:');
stage3.forEach(i => console.log(`  ${i.manufacturer} ${i.model} × ${i.quantity} (category: ${i.category})`));

const se11400hInStage1 = stage1.find(i => i.model?.includes('SE11400H'));
const p505InStage1 = stage1.find(i => i.model?.includes('P505') || i.category === 'optimizer');
console.log('\nSE11400H in Stage 1 (should be FALSE):', !!se11400hInStage1);
console.log('P505 optimizer in Stage 1 (should be TRUE):', !!p505InStage1);

const inverterStage3 = stage3.find(i => i.model?.includes('SE11400H'));
console.log('SE11400H in Stage 3 (should be TRUE, qty=1):', !!inverterStage3, 'qty:', inverterStage3?.quantity);

console.log('\n=== TEST 2: se-p505 as optimizerId (correct scenario) ===');
const result2 = generateBOMV4({
  inverterId: 'se-11400h',
  optimizerId: 'se-p505',  // CORRECT: peripheral optimizer
  panelId: 'qcells-peak-duo-400',
  moduleCount: 36,
  inverterCount: 1,
  stringCount: 3,
  systemKw: 14.4,
  topologyType: 'STRING_WITH_OPTIMIZER',
  dcWireGauge: '#10 AWG',
  dcWireLength: 50,
  acWireGauge: '#6 AWG',
  acWireLength: 50,
  conduitType: 'EMT',
  conduitSizeInch: '3/4',
  acOCPD: 60,
  backfeedAmps: 60,
  mainPanelAmps: 200,
  requiresDCDisconnect: true,
  dcOCPD: 20,
  roofType: 'shingle',
  attachmentCount: 18,
  railSections: 9,
  jurisdiction: 'CA',
  interconnectionMethod: 'LOAD_SIDE',
  panelBusRating: 200,
} as any);

const stage1b = result2.items.filter(i => i.stageId === 'array');
const stage3b = result2.items.filter(i => i.stageId === 'inverter');
console.log('Stage 1 items:');
stage1b.forEach(i => console.log(`  ${i.manufacturer} ${i.model} × ${i.quantity} (category: ${i.category})`));
console.log('Stage 3 items:');
stage3b.forEach(i => console.log(`  ${i.manufacturer} ${i.model} × ${i.quantity} (category: ${i.category})`));
