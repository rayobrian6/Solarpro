import { sizeSystemFromBrand } from '../lib/system/sizingEngine';

const r = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 44,
  selectedBrand: 'ecoflow',
  panelWattage: 400,
  panelVoc: 41.6,
  panelVmp: 34.5,
  panelIsc: 11.6,
  panelTempCoeffVoc: -0.29,
  designTempMin: -10,
});

console.log('Inverter:', r.inverterModels[0]?.equipmentDbId);
console.log('Qty:', r.inverterModels[0]?.qty);
console.log('AC kW:', r.inverterModels[0]?.acKw);
console.log('DC kW:', (44 * 0.4).toFixed(2));
console.log('DC/AC:', ((44 * 0.4) / (r.inverterModels[0]?.acKw ?? 1)).toFixed(3));
console.log('Strings:', r.strings.map(s => s.panelCount));
console.log('String count:', r.strings.length);
console.log('Warnings:', r.warnings?.map(w => w.code));
