import { sizeSystemFromBrand } from './lib/system/sizingEngine';
import { getBrandProfileByInverterId } from './lib/system/brandProfiles';

// What does getBrandProfileByInverterId return for se-11400h?
const profile = getBrandProfileByInverterId('se-11400h');
console.log('Profile for se-11400h:', profile?.id, '| topology:', profile?.topology);

// Now simulate what the API route does:
// The page sends inverterId='se-11400h' for optimizer topology
// The API route calls sizeSystemFromBrand({ selectedInverterId: 'se-11400h' })
// WITHOUT selectedBrand — it must infer the brand from the inverterId
const result = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 420,
  selectedInverterId: 'se-11400h',
  // NOTE: selectedBrand is NOT passed (API route doesn't send it)
  batteryEnabled: false,
  batteryMode: 'auto',
  batteryGoal: 'backup',
});
console.log('\nAPI route sizing result:');
console.log('  brand:', result.brand.id);
console.log('  topology:', result.topology);
console.log('  inverterCount:', result.inverterCount);
console.log('  inverterModels:', JSON.stringify(result.inverterModels));
