// Deep audit: simulate exact state when fetchBOM fires for a 36-panel SolarEdge system
import { sizeSystemFromBrand } from '@/lib/system/sizingEngine';
import { getBrandProfileByInverterId, getBrandProfile } from '@/lib/system/brandProfiles';
import { getRegistryEntryV4 } from '@/lib/equipment-registry-v4';

console.log('\n=== SCENARIO 1: Legacy config (inverterId=se-p505, type=optimizer) ===');
{
  const firstInv = { type: 'optimizer', inverterId: 'se-p505', strings: [{panelCount:12},{panelCount:12},{panelCount:12}] };
  const inferredBrand = getBrandProfileByInverterId(firstInv.inverterId)?.id;
  const effectiveBrand = inferredBrand ?? 'enphase'; // stale
  console.log('inferredBrand:', inferredBrand);
  console.log('effectiveBrand:', effectiveBrand);
  
  const sizingResult = sizeSystemFromBrand({
    systemType: 'roof', panelCount: 36, panelWattage: 400,
    selectedBrand: effectiveBrand, selectedInverterId: firstInv.inverterId,
  });
  console.log('sizingResult.inverterCount:', sizingResult.inverterCount);
  console.log('sizingResult.topology:', sizingResult.topology);
  
  // fetchBOM inverterCount IIFE
  const sizingRecommendation = sizingResult;
  const inverterCountSent = (() => {
    if (firstInv.type === 'micro') return 1;
    if (sizingRecommendation?.inverterCount) return sizingRecommendation.inverterCount;
    const _rawCount = 1; // config.inverters.length (1 inverter object with 3 strings)
    const _modules = 36;
    const _physMax = Math.max(1, Math.ceil(_modules / 25));
    if (_rawCount > _physMax) return 1;
    return _rawCount;
  })();
  console.log('inverterCount SENT to BOM API:', inverterCountSent);
  
  const optimizerIdSent = firstInv.type === 'optimizer' ? firstInv.inverterId : undefined;
  console.log('optimizerId SENT:', optimizerIdSent);
  
  const optimizerEntry = optimizerIdSent ? getRegistryEntryV4(optimizerIdSent) : undefined;
  console.log('optimizerEntry category:', optimizerEntry?.category);
  console.log('optimizerEntry model:', optimizerEntry?.model);
}

console.log('\n=== SCENARIO 2: v58.6 config (inverterId=se-11400h, type=optimizer, NO optimizerPeripheralId) ===');
{
  const firstInv = { type: 'optimizer', inverterId: 'se-11400h', strings: [{panelCount:12},{panelCount:12},{panelCount:12}] } as any;
  const inferredBrand = getBrandProfileByInverterId(firstInv.inverterId)?.id;
  const effectiveBrand = inferredBrand ?? 'enphase';
  console.log('inferredBrand:', inferredBrand);
  
  const sizingResult = sizeSystemFromBrand({
    systemType: 'roof', panelCount: 36, panelWattage: 400,
    selectedBrand: effectiveBrand, selectedInverterId: firstInv.inverterId,
  });
  console.log('sizingResult.inverterCount:', sizingResult.inverterCount);
  
  const inverterCountSent = (() => {
    if (firstInv.type === 'micro') return 1;
    if (sizingResult?.inverterCount) return sizingResult.inverterCount;
    return 1;
  })();
  console.log('inverterCount SENT:', inverterCountSent);
  
  // fetchBOM sends optimizerId = optimizerPeripheralId || inverterId
  const optimizerIdSent = firstInv.type === 'optimizer'
    ? (firstInv.optimizerPeripheralId || firstInv.inverterId)
    : undefined;
  console.log('optimizerId SENT:', optimizerIdSent);
  
  const optimizerEntry = optimizerIdSent ? getRegistryEntryV4(optimizerIdSent) : undefined;
  console.log('optimizerEntry category:', optimizerEntry?.category, 'model:', optimizerEntry?.model);
  console.log('→ BOM Stage 1: optimizer block fires?', !!optimizerEntry);
}

console.log('\n=== SCENARIO 3: v58.7 config (inverterId=se-11400h, type=optimizer, optimizerPeripheralId=se-p505) ===');
{
  const firstInv = { type: 'optimizer', inverterId: 'se-11400h', optimizerPeripheralId: 'se-p505', strings: [{panelCount:12},{panelCount:12},{panelCount:12}] } as any;
  const inferredBrand = getBrandProfileByInverterId(firstInv.inverterId)?.id;
  
  const sizingResult = sizeSystemFromBrand({
    systemType: 'roof', panelCount: 36, panelWattage: 400,
    selectedBrand: inferredBrand ?? 'solaredge', selectedInverterId: firstInv.inverterId,
  });
  console.log('sizingResult.inverterCount:', sizingResult.inverterCount);
  
  const optimizerIdSent = firstInv.type === 'optimizer'
    ? (firstInv.optimizerPeripheralId || firstInv.inverterId)
    : undefined;
  console.log('optimizerId SENT:', optimizerIdSent);
  
  const optimizerEntry = optimizerIdSent ? getRegistryEntryV4(optimizerIdSent) : undefined;
  console.log('optimizerEntry category:', optimizerEntry?.category, 'model:', optimizerEntry?.model);
  console.log('→ BOM Stage 1: SE11400H as optimizer?', optimizerEntry?.id === 'se-11400h');
  console.log('→ BOM Stage 1: P505 optimizer?', optimizerEntry?.id === 'se-p505');
}

console.log('\n=== CHECK: What does BOM engine emit for se-11400h as optimizerId? ===');
{
  const se11400h = getRegistryEntryV4('se-11400h');
  console.log('se-11400h category:', se11400h?.category);
  console.log('se-11400h topologyType:', se11400h?.topologyType);
  // Stage 1 optimizer block: fires when norm=STRING_WITH_OPTIMIZER && optimizerEntry
  // optimizerEntry = getRegistryEntryV4('se-11400h') → defined (category=string_inverter)
  // So it WILL fire, using se-11400h model in Stage 1 array × moduleCount (36)!
  console.log('Will Stage 1 optimizer block fire with se-11400h as optimizerId?', !!se11400h);
}
