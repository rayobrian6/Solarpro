import { getBrandProfileByInverterId } from './lib/system/brandProfiles';

// This is exactly what the sizingRecommendation useMemo does:
// const inferredBrand = primary?.inverterId
//   ? getBrandProfileByInverterId(primary.inverterId)?.id
//   : undefined;
// const effectiveBrand = inferredBrand ?? (isMicroUiType ? 'enphase' : config.selectedBrand);

const inverterId = 'se-11400h';
const inferredBrand = getBrandProfileByInverterId(inverterId)?.id;
console.log('inferredBrand for se-11400h:', inferredBrand);
// If this is 'solaredge', effectiveBrand = 'solaredge' → sizing returns 1
// If this is undefined, effectiveBrand = config.selectedBrand (potentially 'enphase')

// Now check: what does sizeSystemFromBrand do with selectedBrand='enphase' but selectedInverterId='se-11400h'?
// The key is: does the brand selection happen BEFORE or AFTER selectedInverterId lookup?
