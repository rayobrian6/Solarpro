// Verify the manufacturer=TBD bug is fixed
// Simulates the exact API route flow

import { generateBOMV4 } from '../lib/bom-engine-v4';
import { deriveStructuralBOM, type StructuralBOMItem } from '../lib/bom-system-profiles';
import type { BOMGenerationResultV4, BOMLineItemV4, BOMStageResult, BOMStageId } from '../lib/bom-engine-v4';

const V4_OWNED_CATEGORIES = new Set([
  'solar_panel', 'microinverter', 'optimizer', 'string_inverter',
  'hybrid_inverter', 'inverter', 'battery',
  'generator', 'ats', 'backup_interface',
  'wire', 'trunk_cable', 'terminator', 'conduit',
  'disconnect', 'breaker', 'rapid_shutdown', 'combiner', 'junction_box',
  'meter', 'gateway', 'monitoring', 'label', 'racking',
]);

let _structuralIdCounter = 0;
function nextStructuralId(): string {
  return `bom-struct-${(++_structuralIdCounter).toString().padStart(4, '0')}`;
}

function structuralToV4Item(si: StructuralBOMItem): BOMLineItemV4 {
  return {
    id: nextStructuralId(),
    stageId: si.stageId as BOMStageId,
    stageLabel: 'Stage 5 — Structural',
    category: si.category,
    manufacturer: si.manufacturer,
    model: si.model,
    partNumber: si.partNumber,
    description: si.description,
    quantity: si.quantity,
    unit: (si.unit === 'bag' || si.unit === 'kit') ? 'ea' : si.unit as BOMLineItemV4['unit'],
    necReference: 'IBC 2021',
    derivedFrom: `geometry: ${si.derivedFrom}`,
    formula: si.derivedFrom,
    required: si.required,
  };
}

function injectStructuralIntoV4(v4: BOMGenerationResultV4, items: StructuralBOMItem[]): BOMGenerationResultV4 {
  _structuralIdCounter = 0;
  const v4Categories = new Set(v4.items.map(i => i.category));
  const toAdd: BOMLineItemV4[] = [];
  for (const si of items) {
    if (V4_OWNED_CATEGORIES.has(si.category)) continue;
    if (v4Categories.has(si.category)) continue;
    if (si.quantity <= 0) continue;
    toAdd.push(structuralToV4Item(si));
  }
  const mergedItems = [...v4.items, ...toAdd];
  const stageMap = new Map<BOMStageId, BOMLineItemV4[]>();
  for (const item of mergedItems) {
    if (!stageMap.has(item.stageId)) stageMap.set(item.stageId, []);
    stageMap.get(item.stageId)!.push(item);
  }
  const stages: BOMStageResult[] = v4.stages.map(stage => ({
    ...stage,
    items: stageMap.get(stage.id) ?? stage.items,
    itemCount: (stageMap.get(stage.id) ?? stage.items).length,
  }));
  return { ...v4, items: mergedItems, stages, totalLineItems: mergedItems.length };
}

// Simulate Sol Fence BOM (matches user's CSV)
const v4 = generateBOMV4({
  inverterId: 'enphase-iq8m',
  panelId: 'qcells-peak-duo-400',
  moduleCount: 83,
  stringCount: 7,
  inverterCount: 1,
  systemKw: 33.2,
  systemType: 'fence',
  dcWireGauge: '#10 AWG',
  acWireGauge: '#8 AWG',
  dcWireLength: 50,
  acWireLength: 60,
  conduitType: 'EMT',
  conduitSizeInch: '3/4',
  roofType: 'shingle',
  attachmentCount: 0,
  railSections: 0,
  mainPanelAmps: 200,
  backfeedAmps: 40,
  acOCPD: 40,
  dcOCPD: 20,
  requiresProductionMeter: false,
  requiresACDisconnect: true,
  requiresDCDisconnect: true,
  requiresRapidShutdown: true,
  requiresWarningLabels: true,
  interconnectionMethod: 'LOAD_SIDE',
  panelBusRating: 200,
});

const structural = deriveStructuralBOM({
  systemType: 'fence',
  moduleCount: 83,
  fence: {
    totalPosts: 58,
    postSpacingFt: 8.0,
    postEmbedFt: 3.0,
    postHeightFt: 8.0,
    railCount: 2,
    totalFenceLengthFt: 456,
    segmentCount: 1,
    gateCount: 0,
    gateWidthsFt: [],
    solarSectionCount: 1,
    vinylSectionCount: 0,
    panelWidthFt: 6.96,
    panelHeightFt: 3.45,
  },
});

const merged = injectStructuralIntoV4(v4, structural.items);
const structuralItems = merged.items.filter(i => i.stageId === 'stage-5-structural' || i.stageLabel?.includes('Structural'));

console.log(`\n===== MANUFACTURER FIX VERIFICATION =====\n`);
console.log(`V4 items: ${v4.totalLineItems}`);
console.log(`Structural items derived: ${structural.items.length}`);
console.log(`Final merged: ${merged.totalLineItems}`);
console.log(`Structural items in final: ${structuralItems.length}\n`);

console.log(`Structural BOM line items (checking for manufacturer='TBD' bug):\n`);
let tbdCount = 0;
for (const item of structuralItems) {
  const flag = item.manufacturer === 'TBD' || !item.manufacturer ? ' [BUG: TBD!]' : '';
  if (flag) tbdCount++;
  console.log(`  ${item.manufacturer ?? '(none)'} | ${item.model ?? '-'} | ${item.description?.slice(0, 50) ?? ''} | qty=${item.quantity}${flag}`);
}

console.log(`\n===== RESULT =====`);
if (tbdCount > 0) {
  console.log(`❌ FAIL: ${tbdCount} items still have manufacturer='TBD' or missing`);
  process.exit(1);
} else {
  console.log(`✅ PASS: All ${structuralItems.length} structural items have valid manufacturer values`);
}