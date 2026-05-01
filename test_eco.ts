import { resolveBrandEquipment } from './lib/system/brandProfiles/resolveBrandEquipment';

const kit = resolveBrandEquipment('solaredge');
console.log('SolarEdge kit:');
console.log('  inverters:', kit?.stringInverters?.map((i: any) => i.id));
console.log('  microinverters:', kit?.microinverters?.map((m: any) => m.id));
console.log('  optimizers:', kit?.optimizers?.map((o: any) => o.id));
