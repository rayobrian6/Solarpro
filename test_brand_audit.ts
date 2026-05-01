// Full brand audit: test every brand's BOM pipeline for a 36-panel system
import { sizeSystemFromBrand } from '@/lib/system/sizingEngine';
import { getBrandProfile, getBrandProfileByInverterId } from '@/lib/system/brandProfiles';
import { getRegistryEntryV4, EQUIPMENT_REGISTRY_V4 } from '@/lib/equipment-registry-v4';
import { generateBOMV4 } from '@/lib/bom-engine-v4';

// Note: 'sol-ark' uses hyphen (matches BrandProfile id). 'generac' is battery-only (no inverter BrandProfile).
const BRANDS = ['solaredge', 'enphase', 'sma', 'fronius', 'goodwe', 'sungrow', 'sol-ark', 'growatt', 'solis', 'tesla', 'tigo', 'apsystems', 'hoymiles'];
const PANEL_COUNT = 36;
const PANEL_WATTS = 400;

console.log(`\n${'='.repeat(80)}`);
console.log(`BRAND AUDIT — ${PANEL_COUNT}-panel system @ ${PANEL_WATTS}W/panel`);
console.log(`${'='.repeat(80)}\n`);

for (const brandId of BRANDS) {
  const profile = getBrandProfile(brandId);
  if (!profile) {
    console.log(`❌ ${brandId.toUpperCase()}: NO BRAND PROFILE FOUND`);
    continue;
  }

  console.log(`\n--- ${brandId.toUpperCase()} (topology: ${profile.topology}) ---`);

  // Step 1: Sizing engine
  let sizingResult: any;
  try {
    sizingResult = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: PANEL_COUNT,
      panelWattage: PANEL_WATTS,
      selectedBrand: brandId,
    });
    const inv = sizingResult.inverterModels[0];
    console.log(`  Sizing: ${sizingResult.inverterCount} × ${inv?.equipmentDbId} (${sizingResult.topology})`);
    console.log(`  Strings: ${sizingResult.strings?.length} strings`);
  } catch (e: any) {
    console.log(`  ❌ Sizing FAILED: ${e.message}`);
    continue;
  }

  // Step 2: Verify inverterId is in registry
  const primaryModel = sizingResult.inverterModels[0];
  const invEntry = getRegistryEntryV4(primaryModel?.equipmentDbId);
  if (!invEntry) {
    console.log(`  ❌ Registry: ${primaryModel?.equipmentDbId} NOT FOUND in equipment-registry-v4`);
  } else {
    console.log(`  Registry: ${invEntry.id} (${invEntry.category}, topology=${invEntry.topologyType})`);
  }

  // Step 3: Verify brand inference works (getBrandProfileByInverterId)
  const inferredBrand = getBrandProfileByInverterId(primaryModel?.equipmentDbId);
  if (!inferredBrand) {
    console.log(`  ⚠️  Brand inference: getBrandProfileByInverterId('${primaryModel?.equipmentDbId}') → undefined (stale brand risk)`);
  } else {
    console.log(`  Brand inference: '${primaryModel?.equipmentDbId}' → '${inferredBrand.id}' ✓`);
  }

  // Step 4: Determine optimizerId for BOM
  // 'hybrid' brands (Growatt/Solis/Tigo) are string inverters with battery capability,
  // NOT optimizer-based. Only 'optimizer' topology (SolarEdge) needs STRING_WITH_OPTIMIZER.
  const isOptimizer = profile.topology === 'optimizer';
  let optimizerId: string | undefined;
  if (isOptimizer && invEntry) {
    const defaultOptimizerAcc = invEntry.requiredAccessories?.find((a: any) => a.category === 'optimizer');
    if (defaultOptimizerAcc) {
      const found = EQUIPMENT_REGISTRY_V4.find((e: any) =>
        e.category === 'optimizer' &&
        e.manufacturer === defaultOptimizerAcc.defaultManufacturer
      );
      optimizerId = found?.id;
      console.log(`  Optimizer: ${found?.id ?? 'NOT FOUND'} (default: ${defaultOptimizerAcc.defaultManufacturer} ${defaultOptimizerAcc.defaultModel})`);
    } else {
      console.log(`  ⚠️  No optimizer requiredAccessory in registry for ${primaryModel?.equipmentDbId}`);
    }
  }

  // Step 5: BOM generation
  try {
    const topoType = profile.topology === 'micro' ? 'MICROINVERTER'
      : profile.topology === 'optimizer' ? 'STRING_WITH_OPTIMIZER'
      : 'STRING_INVERTER';

    const bomResult = generateBOMV4({
      inverterId: primaryModel?.equipmentDbId,
      optimizerId,
      panelId: 'qcells-peak-duo-400',
      moduleCount: PANEL_COUNT,
      deviceCount: profile.topology === 'micro' ? PANEL_COUNT : undefined,
      inverterCount: sizingResult.inverterCount,
      stringCount: sizingResult.strings?.length ?? 3,
      systemKw: (PANEL_COUNT * PANEL_WATTS) / 1000,
      topologyType: topoType,
      dcWireGauge: '#10 AWG',
      dcWireLength: 50,
      acWireGauge: '#6 AWG',
      acWireLength: 50,
      conduitType: 'EMT',
      conduitSizeInch: '3/4',
      acOCPD: 60,
      backfeedAmps: 60,
      mainPanelAmps: 200,
      requiresDCDisconnect: true,
      dcOCPD: 20,
      roofType: 'shingle',
      attachmentCount: 18,
      railSections: 9,
      jurisdiction: 'CA',
      interconnectionMethod: 'LOAD_SIDE',
      panelBusRating: 200,
    } as any);

    const stage1 = bomResult.items.filter((i: any) => i.stageId === 'array');
    const stage3 = bomResult.items.filter((i: any) => i.stageId === 'inverter');
    const panelItem = stage1.find((i: any) => i.category === 'solar_panel');
    const inverterItem = stage3.find((i: any) => i.category !== 'battery' && i.category !== 'generator');
    const optimizerItem = stage1.find((i: any) => i.category === 'optimizer' || i.category === 'microinverter');

    const panelOk = panelItem?.quantity === PANEL_COUNT;
    const inverterOk = profile.topology === 'micro'
      ? (inverterItem === undefined || inverterItem?.quantity === 1) // micros go in Stage 1
      : inverterItem?.quantity === sizingResult.inverterCount;
    const microItem = stage1.find((i: any) => i.category === 'microinverter');

    if (profile.topology === 'micro') {
      const microOk = microItem?.quantity === PANEL_COUNT;
      const status = panelOk && microOk ? '✅' : '❌';
      console.log(`  BOM ${status}: Stage1 panels=${panelItem?.quantity}/${PANEL_COUNT}, Stage1 micros=${microItem?.quantity}/${PANEL_COUNT}`);
    } else if (isOptimizer) {
      const optOk = optimizerItem?.quantity === PANEL_COUNT;
      const status = panelOk && inverterOk && optOk ? '✅' : '❌';
      console.log(`  BOM ${status}: Stage1 panels=${panelItem?.quantity}/${PANEL_COUNT}, Stage1 optimizer=${optimizerItem?.model}×${optimizerItem?.quantity}/${PANEL_COUNT}, Stage3 inverter=${inverterItem?.model}×${inverterItem?.quantity}/${sizingResult.inverterCount}`);
      if (!optOk) console.log(`    ⚠️  Optimizer qty mismatch!`);
      if (!inverterOk) console.log(`    ⚠️  Inverter qty mismatch! got ${inverterItem?.quantity}, expected ${sizingResult.inverterCount}`);
    } else {
      const status = panelOk && inverterOk ? '✅' : '❌';
      console.log(`  BOM ${status}: Stage1 panels=${panelItem?.quantity}/${PANEL_COUNT}, Stage3 inverter=${inverterItem?.model}×${inverterItem?.quantity}/${sizingResult.inverterCount}`);
      if (!inverterOk) console.log(`    ⚠️  Inverter qty mismatch! got ${inverterItem?.quantity}, expected ${sizingResult.inverterCount}`);
    }
  } catch (e: any) {
    console.log(`  ❌ BOM generation FAILED: ${e.message}`);
  }
}

console.log(`\n${'='.repeat(80)}`);
console.log('AUDIT COMPLETE');
console.log(`${'='.repeat(80)}\n`);
