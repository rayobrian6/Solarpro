// ============================================================
// Roof Tech RT-MINI Mounting System
// ICC-ES ESR-3575 Structural Data
// ============================================================
//
// The RT-MINI is a rail-less direct-attach mounting system for
// rooftop solar. Key features:
//   - Integrated EPDM flashing (no separate flashing needed)
//   - 2 lag bolts per mount (stainless steel)
//   - Direct attachment to rafters (not deck-only)
//   - ICC-ES evaluated for uplift and shear
//
// ============================================================

export interface MountingSystemSpecs {
  id: string;
  manufacturer: string;
  model: string;
  type: 'rail-based' | 'rail-less';
  
  // Fastener specifications
  fasteners: {
    type: string;           // e.g., "5/16&quot; x 3&quot; stainless lag bolt"
    countPerMount: number;  // lag bolts per mount
    minEmbedment: number;   // inches into rafter
    material: string;       // stainless steel, etc.
  };
  
  // Capacities per ICC-ES report
  capacities: {
    pullOutPerLag: number;    // lbs per lag bolt (withdrawal)
    shearPerLag: number;      // lbs per lag bolt (shear)
    upliftPerLag: number;     // lbs per lag bolt (uplift)
    // Note: These are ICC-ES ALLOWABLE values (ASD), not ultimate
  };
  
  // Spacing limits from manufacturer
  spacing: {
    maxMountSpacing: number;  // inches between mounts
    minEdgeDistance: number;  // inches from roof edge
    minRafterOffset: number;  // inches from rafter center
  };
  
  // Roof compatibility
  compatibleRoofTypes: string[];
  
  // References
  iccEsReport: string;
  datasheetUrl: string;
}

// RT-MINI specifications from ICC-ES ESR-3575
export const RT_MINI_SPECS: MountingSystemSpecs = {
  id: 'rooftech-rt-mini',
  manufacturer: 'Roof Tech',
  model: 'RT-MINI',
  type: 'rail-less',
  
  fasteners: {
    type: '5/16" x 3" stainless steel lag bolt',
    countPerMount: 2,
    minEmbedment: 2.5,  // inches into rafter
    material: '304 Stainless Steel',
  },
  
  capacities: {
    // ICC-ES ESR-3575 allowable capacities (ASD)
    // These are per lag bolt values for Douglas Fir-Larch
    pullOutPerLag: 450,   // lbs
    shearPerLag: 350,     // lbs
    upliftPerLag: 450,    // lbs
  },
  
  spacing: {
    maxMountSpacing: 48,   // inches (rail-less)
    minEdgeDistance: 6,    // inches
    minRafterOffset: 0.75, // inches from rafter center
  },
  
  compatibleRoofTypes: [
    'shingle',
    'tile',  // with appropriate flashing method
  ],
  
  iccEsReport: 'ESR-3575',
  datasheetUrl: 'https://www.roof-tech.com/rt-mini',
};

// Mount spacing table derived from ICC-ES data
// Rows: Wind speed (mph), Columns: Exposure category
// Values: Maximum mount spacing in inches
export const RT_MINI_SPACING_TABLE: Record<number, Record<string, number>> = {
  // Wind speed: { Exposure B, C, D }
  85:  { B: 48, C: 48, D: 48 },
  90:  { B: 48, C: 48, D: 48 },
  100: { B: 48, C: 48, D: 42 },
  110: { B: 48, C: 42, D: 36 },
  115: { B: 42, C: 36, D: 30 },
  120: { B: 36, C: 36, D: 30 },
  130: { B: 36, C: 30, D: 24 },
  140: { B: 30, C: 30, D: 24 },
  150: { B: 30, C: 24, D: 24 },
  160: { B: 24, C: 24, D: 24 },
};

// Helper function to get mount spacing from table
export function getRTMiniMountSpacing(
  windSpeed: number,
  exposure: 'B' | 'C' | 'D'
): number {
  // Find closest wind speed in table
  const speeds = Object.keys(RT_MINI_SPACING_TABLE).map(Number).sort((a, b) => a - b);
  
  // Find first speed >= input
  const applicableSpeed = speeds.find(s => s >= windSpeed) || speeds[speeds.length - 1];
  
  return RT_MINI_SPACING_TABLE[applicableSpeed][exposure] || 36;
}

// Calculate required mount count
export function calculateRTMiniMountCount(
  arrayLengthInches: number,
  rowCount: number,
  windSpeed: number,
  exposure: 'B' | 'C' | 'D'
): number {
  const spacing = getRTMiniMountSpacing(windSpeed, exposure);
  
  // Mounts per row = ceil(arrayLength / spacing) + 1 (for ends)
  const mountsPerRow = Math.ceil(arrayLengthInches / spacing) + 1;
  
  // Total = mounts per row × rows
  return mountsPerRow * rowCount;
}

// Export all for convenience
export default {
  specs: RT_MINI_SPECS,
  spacingTable: RT_MINI_SPACING_TABLE,
  getMountSpacing: getRTMiniMountSpacing,
  calculateMountCount: calculateRTMiniMountCount,
};