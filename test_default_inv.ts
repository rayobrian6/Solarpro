import { STRING_INVERTERS } from './lib/equipment-db';
import { SOLAR_PANELS } from './lib/equipment-db';

console.log('STRING_INVERTERS[0]:', STRING_INVERTERS[0]?.id, STRING_INVERTERS[0]?.model);
console.log('First 5 STRING_INVERTERS:', STRING_INVERTERS.slice(0,5).map(i => i.id));

// What happens when user manually switches topology to 'optimizer' via the UI button?
// They get newInverter('optimizer') with inverterId = STRING_INVERTERS[0]?.id
// If that's 'se-7600h', getBrandProfileByInverterId('se-7600h') = 'solaredge' ✓
// If that's something else...

// Also: what does the ecosystem apply do?
// When user selects SE11400H from the ecosystem kit picker,
// what inverterId gets set on config.inverters[0]?

// Check: what is config.inverters[0].inverterId in the scenario where
// user selected 'SolarEdge HD-Wave' ecosystem and it gave them 38 strings?
// 
// In applySizingRecommendation for optimizer topology:
//   primaryModel = rec.inverterModels[0]
//   primaryModel.equipmentDbId = 'se-11400h'
//   newInverters.push({ inverterId: 'se-11400h', type: 'optimizer', ... })
// → config.inverters[0].inverterId = 'se-11400h' ✓
//
// But what if user MANUALLY sets up an optimizer inverter by adding an
// inverter card, selecting 'optimizer' type, and then picking from the
// inverter dropdown? What IDs are in that dropdown?

// What inverters show in the optimizer inverter dropdown?
const stringInvs = STRING_INVERTERS.filter(i => i.manufacturer === 'SolarEdge');
console.log('\nSolarEdge STRING_INVERTERS:');
stringInvs.slice(0,10).forEach(i => console.log(`  ${i.id}: ${i.model}`));

// REAL question: does the user EVER end up with se-p401 as inverterId?
// Only if the optimizer dropdown shows optimizers instead of inverters
// OR if there's a code path that sets inverterId to an optimizer ID
