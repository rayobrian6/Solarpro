import { resolveBrandEquipment } from './lib/system/brandProfiles/resolveBrandEquipment';

const kit = resolveBrandEquipment('solaredge');
console.log('SolarEdge kit:');
console.log('  inverters:', kit?.stringInverters?.map((i: any) => ({ id: i.id, model: i.model })));
console.log('  microinverters:', kit?.microinverters?.length ?? 0);
console.log('  optimizers:', kit?.optimizers?.map((o: any) => ({ id: o.id, model: o.model })));
console.log('  batteries:', kit?.batteries?.map((b: any) => ({ id: b.id, model: b.model })));