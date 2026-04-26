import { sizeSystemFromBrand } from './lib/system/sizingEngine';
import { getBrandProfileByInverterId } from './lib/system/brandProfiles';

// The EXACT scenario from the screenshot:
// User has SolarEdge SE11400H system with 36 panels showing 36 inverters at $1,880 each
// 
// In sizingRecommendation useMemo:
//   primary = config.inverters[0]
//   primary.inverterId = ??? 
//   primary.type = 'optimizer'
//   
// The key question: what is primary.inverterId in a MANUALLY configured 36-string optimizer system?
// If user manually set up topology without going through applySizingRecommendation,
// the config may have been set up via the ecosystem picker or topology selector

// Check: what does getBrandProfileByInverterId return for various optimizer-related IDs?
const testIds = [
  'se-11400h',    // central inverter
  'se-p401-r5',   // optimizer peripheral
  'se-p505-r5',   // optimizer peripheral  
  '',             // empty
  'se-7600h',     // smaller SE inverter
  'solaredge',    // brand name itself
];

console.log('getBrandProfileByInverterId results:');
for (const id of testIds) {
  const profile = getBrandProfileByInverterId(id);
  console.log(`  '${id}' → brand: ${profile?.id ?? 'undefined'} (topology: ${profile?.topology ?? 'N/A'})`);
}

// THE CRITICAL SCENARIO:
// What if the user's config.inverters[0].inverterId is an OPTIMIZER peripheral ID
// (like 'se-p401-r5'), not the central inverter ID?
// In that case, getBrandProfileByInverterId('se-p401-r5') = undefined
// And effectiveBrand = config.selectedBrand (which may be 'enphase')
// And sizeSystemFromBrand({selectedBrand:'enphase', selectedInverterId:'se-p401-r5'})
// → Enphase brand wins → 36 micros!

console.log('\n=== Critical test: optimizer peripheral as inverterId ===');
const r = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 400,
  selectedInverterId: 'se-p401-r5', // optimizer peripheral, NOT central inverter
  selectedBrand: 'enphase',          // stale from previous micro config
  batteryEnabled: false,
  batteryMode: 'auto',
  batteryGoal: 'backup',
});
console.log('inverterCount:', r.inverterCount, '← THIS IS THE BUG if = 36');
console.log('brand:', r.brand.id);

// NOW: what does config.inverters[0].inverterId actually contain for a 
// manually set up optimizer system?
// Looking at the applySizingRecommendation code:
//   newInverters.push({
//     inverterId: primaryModel.equipmentDbId,  // 'se-11400h' for SE11400H
//     type: 'optimizer',
//     strings: invStrings,
//   })
// BUT if user set up config manually via the UI (not via applySizingRecommendation),
// they pick from the ecosystem picker which shows optimizers (P-series), not inverters!
// The optimizer picker may set inverterId = 'se-p401-r5' (the optimizer), not 'se-11400h'

console.log('\n=== What if inverterId is set to se-p401-r5 with correct brand inference ===');
const profile = getBrandProfileByInverterId('se-p401-r5');
console.log('Profile for se-p401-r5:', profile?.id ?? 'NOT FOUND');
console.log('→ If not found, effectiveBrand falls back to config.selectedBrand');
