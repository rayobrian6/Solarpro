import { sizeSystemFromBrand } from '@/lib/system/sizingEngine';

const result = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 400,
  selectedBrand: 'solaredge',
  selectedInverterId: 'se-11400h',
});

console.log('=== SIZING RESULT ===');
console.log('inverterCount:', result.inverterCount);
console.log('topology:', result.topology);
console.log('inverterModels:', JSON.stringify(result.inverterModels, null, 2));
console.log('strings count:', result.strings?.length);
console.log('strings:', JSON.stringify(result.strings?.slice(0,3), null, 2));
