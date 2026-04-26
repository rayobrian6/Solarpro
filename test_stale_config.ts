import { sizeSystemFromBrand } from './lib/system/sizingEngine';
import { getBrandProfileByInverterId } from './lib/system/brandProfiles';

// SCENARIO: User has 36 optimizer inverter cards each with 1 string of 1 panel
// This is the "stale config" state — never had applySizingRecommendation run
// config.inverters = [
//   { inverterId: 'se-11400h', type: 'optimizer', strings: [{ panelCount: 1 }] },
//   ... x36
// ]
// config.inverters[0].inverterId = 'se-11400h'
// firstInv.type = 'optimizer' 
// totalPanels = sum of all panels = 36 x 1 = 36
// systemPanelCount = 36 (from config fallback)
// sizingRecommendation computation:
// primary = config.inverters[0] = { inverterId: 'se-11400h', type: 'optimizer', strings: [{panelCount:1}] }
// panelData = SOLAR_PANELS.find(p => p.id === primary.strings[0].panelId)
// If panelId = '' or default panel, panelWattage = 400

// The sizing engine is called with:
// panelCount: systemPanelCount (36)
// selectedInverterId: primary.inverterId ('se-11400h')
// selectedBrand: getBrandProfileByInverterId('se-11400h')?.id = 'solaredge'

console.log('=== Simulating sizingRecommendation useMemo for stale 36-optimizer config ===');
console.log('Brand for se-11400h:', getBrandProfileByInverterId('se-11400h')?.id);

const rec = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 400,
  selectedInverterId: 'se-11400h',
  selectedBrand: 'solaredge',
  batteryEnabled: false,
  batteryMode: 'auto',
  batteryGoal: 'backup',
});
console.log('inverterCount:', rec.inverterCount, '← used by fetchBOM IIFE');
console.log('topology:', rec.topology);

// Now trace what fetchBOM actually sends:
const inverterCountSent = rec.inverterCount; // should be 1
console.log('\nfetchBOM sends inverterCount:', inverterCountSent);

// BUT WAIT - what if the sizing rec call uses the WRONG panelWattage?
// panelData = SOLAR_PANELS.find(p => p.id === primary.strings[0].panelId)
// If the panelId is e.g. 'qcells-peak-duo-400', panelWattage = 400 ✓
// If panelId is undefined/empty, panelData = null, panelWattage = 400 ✓
// So panelWattage = 400 in all cases

// WHAT IF the issue is that config.inverters[0].inverterId is NOT 'se-11400h'?
// What if after a topology switch, inverterId is stale?
console.log('\n=== What if inverterId is a stale string inverter ID? ===');
const rec2 = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 400,
  selectedInverterId: 'fronius-primo-8.2', // stale from a previous string config
  selectedBrand: undefined, // if selectedBrand is also stale
  batteryEnabled: false,
  batteryMode: 'auto',
  batteryGoal: 'backup',
});
console.log('inverterCount (fronius, no brand):', rec2.inverterCount, '| brand:', rec2.brand.id);

console.log('\n=== What if inverterId is empty / undefined? ===');
const rec3 = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 400,
  selectedInverterId: '',
  selectedBrand: 'solaredge',
  batteryEnabled: false,
  batteryMode: 'auto',
  batteryGoal: 'backup',
});
console.log('inverterCount (empty ID, solaredge brand):', rec3.inverterCount, '| brand:', rec3.brand.id);

console.log('\n=== What if selectedBrand = "enphase" (stale) with se-11400h? ===');
const rec4 = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 400,
  selectedInverterId: 'se-11400h',
  selectedBrand: 'enphase', // stale brand from previous micro setup
  batteryEnabled: false,
  batteryMode: 'auto',
  batteryGoal: 'backup',
});
console.log('inverterCount (se-11400h, enphase brand):', rec4.inverterCount, '| brand:', rec4.brand.id);

console.log('\n=== What if no selectedInverterId, selectedBrand="enphase"? ===');
const rec5 = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 400,
  selectedInverterId: undefined,
  selectedBrand: 'enphase',
  batteryEnabled: false,
  batteryMode: 'auto',
  batteryGoal: 'backup',
});
console.log('inverterCount (no ID, enphase brand):', rec5.inverterCount, '| brand:', rec5.brand.id);
// If this returns 36, THAT is the bug! Enphase micro = 1 inverter per panel
