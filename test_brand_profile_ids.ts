import { getBrandProfile } from '@/lib/system/brandProfiles';
import { getRegistryEntryV4 } from '@/lib/equipment-registry-v4';

const BRANDS = ['enphase','sma','fronius','goodwe','sungrow','solark','growatt','solis','tesla','tigo','apsystems','hoymiles','generac'];

for (const b of BRANDS) {
  const p = getBrandProfile(b);
  if (!p) { console.log(`${b}: NO PROFILE`); continue; }
  console.log(`\n${b.toUpperCase()} (topology:${p.topology})`);
  console.log(`  supportedInverterModels:`);
  for (const m of p.supportedInverterModels) {
    const reg = getRegistryEntryV4(m.equipmentDbId);
    const status = reg ? '✅' : '❌ MISSING FROM REGISTRY';
    console.log(`    ${status} ${m.equipmentDbId} (${m.acKw}kW)`);
  }
}
