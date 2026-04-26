import { getBrandProfileByInverterId, getBrandProfile } from './lib/system/brandProfiles';

// Simulate the fix
const invId = 'se-p505';
const payloadBrand = 'solaredge';

const brandProf = getBrandProfileByInverterId(invId)
  ?? (payloadBrand ? getBrandProfile(payloadBrand) : undefined);

console.log('brandProf:', brandProf?.id);
const models = brandProf?.supportedInverterModels ?? [];
console.log('models:', models.map(m => m.equipmentDbId));

const central = models.length > 0 ? models[models.length - 1].equipmentDbId : null;
console.log('central inverter selected:', central);
// Should be 'se-11400h' (last = highest tier)

// Test for se-p401 too
const brandProf2 = getBrandProfileByInverterId('se-p401')
  ?? getBrandProfile('solaredge');
const models2 = brandProf2?.supportedInverterModels ?? [];
const central2 = models2.length > 0 ? models2[models2.length - 1].equipmentDbId : null;
console.log('\nFor se-p401:', central2);
