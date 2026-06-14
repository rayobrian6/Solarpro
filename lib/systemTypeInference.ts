/**
 * lib/systemTypeInference.ts
 * Phase 2F: Infer the best system type from project/property characteristics.
 *
 * Uses heuristics based on available data:
 *   - Address/climate zone → roof most likely in urban/suburban
 *   - Property acreage → ground for large lots
 *   - Commercial → roof or carport
 *   - Agricultural → fence/bifacial vertical
 *
 * This is a lightweight inference — actual satellite imagery analysis
 * would require an external API (Google Solar, Picterra, etc.)
 * and is deferred to a future phase.
 */

export type InferredSystemType = 'roof' | 'ground' | 'fence';

export interface SystemTypeInference {
  /** Recommended system type */
  type: InferredSystemType;
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** Reason for the inference */
  reason: string;
  /** Data source */
  source: 'address-lookup' | 'ecosystem' | 'manual';
}

/**
 * Infer system type from project data.
 * Currently uses simple heuristics; will be enhanced with satellite data.
 */
export function inferSystemType(input: {
  stateCode?: string;
  city?: string;
  lat?: number;
  lng?: number;
  propertyType?: string;
  currentType?: string;
}): SystemTypeInference {
  const { stateCode, lat, lng, propertyType, currentType } = input;

  // Agricultural/rural properties → fence (bifacial vertical)
  if (propertyType === 'agricultural' || propertyType === 'farm') {
    return {
      type: 'fence',
      confidence: 'medium',
      reason: 'Agricultural properties benefit from vertical bifacial fence mounts — dual-side harvesting, no land use impact.',
      source: 'ecosystem',
    };
  }

  // Commercial properties → roof (flat roof is ideal)
  if (propertyType === 'commercial' || propertyType === 'industrial') {
    return {
      type: 'roof',
      confidence: 'high',
      reason: 'Commercial buildings typically have large flat roofs ideal for solar arrays.',
      source: 'ecosystem',
    };
  }

  // Southwest / sunbelt states → ground is viable (high irradiance)
  const sunbeltStates = ['AZ', 'NM', 'NV', 'TX', 'CA', 'FL', 'CO', 'UT'];
  if (stateCode && sunbeltStates.includes(stateCode)) {
    return {
      type: 'roof',
      confidence: 'medium',
      reason: `Roof mount is standard for residential in ${stateCode}. Ground mount is viable given high irradiance — consider if roof space is limited.`,
      source: 'address-lookup',
    };
  }

  // Default: roof is most common for residential
  return {
    type: 'roof',
    confidence: 'medium',
    reason: 'Roof mount is the most common residential solar installation type. Choose ground or fence if roof space is limited.',
    source: 'ecosystem',
  };
}
