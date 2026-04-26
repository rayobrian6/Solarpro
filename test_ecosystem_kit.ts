import { resolveEcosystemKit } from './lib/ecosystems/resolver';

const kit = resolveEcosystemKit('solaredge');
console.log('SolarEdge kit:');
console.log('  inverters:', kit?.inverters?.map((i: any) => ({ id: i.id, model: i.model })));
console.log('  microinverters:', kit?.microinverters?.length ?? 0);
console.log('  optimizers:', kit?.optimizers?.map((o: any) => ({ id: o.id, model: o.model })));
console.log('  batteries:', kit?.batteries?.map((b: any) => ({ id: b.id, model: b.model })));
