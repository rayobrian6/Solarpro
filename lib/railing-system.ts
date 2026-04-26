// ============================================================
// Rail System Calculations
// IronRidge XR100, Unirac SolarMount, SnapNrack Series 100
// ============================================================

export interface RailSystemSpecs {
  id: string;
  manufacturer: string;
  model: string;
  material: string;
  
  // Rail dimensions
  dimensions: {
    height: number;      // inches
    width: number;       // inches
    weightPerFt: number; // lbs per linear foot
  };
  
  // Span limits
  spans: {
    maxSpan: number;        // inches between mounts
    maxCantilever: number;  // inches (typically L/6 or 12")
    spliceInterval: number; // inches between splices
  };
  
  // Load ratings
  ratings: {
    maxWindSpeed: number;   // mph
    maxSnowLoad: number;    // psf
  };
  
  // Hardware
  hardware: {
    midClamp: string;
    endClamp: string;
    lFoot: string;
    spliceKit: string;
  };
  
  // References
  ulListing: string;
  warranty: string;
  datasheetUrl: string;
}

// Common rail systems
export const RAIL_SYSTEMS: RailSystemSpecs[] = [
  {
    id: 'ironridge-xr100',
    manufacturer: 'IronRidge',
    model: 'XR100',
    material: '6005-T5 Aluminum',
    dimensions: {
      height: 1.81,
      width: 1.97,
      weightPerFt: 0.62,
    },
    spans: {
      maxSpan: 72,
      maxCantilever: 12,
      spliceInterval: 240, // 20 ft
    },
    ratings: {
      maxWindSpeed: 160,
      maxSnowLoad: 50,
    },
    hardware: {
      midClamp: 'IronRidge UFO Mid Clamp',
      endClamp: 'IronRidge UFO End Clamp',
      lFoot: 'IronRidge L-Foot',
      spliceKit: 'IronRidge XR Splice Bar',
    },
    ulListing: 'UL 2703A',
    warranty: '25 years',
    datasheetUrl: 'https://ironridge.com/racking/xr-rail/',
  },
  {
    id: 'unirac-solarmount',
    manufacturer: 'Unirac',
    model: 'SolarMount',
    material: '6005-T5 Aluminum',
    dimensions: {
      height: 1.75,
      width: 1.75,
      weightPerFt: 0.55,
    },
    spans: {
      maxSpan: 72,
      maxCantilever: 12,
      spliceInterval: 240,
    },
    hardware: {
      midClamp: 'SolarMount Mid Clamp',
      endClamp: 'SolarMount End Clamp',
      lFoot: 'SolarMount L-Foot',
      spliceKit: 'SolarMount Splice Kit',
    },
    ratings: {
      maxWindSpeed: 150,
      maxSnowLoad: 50,
    },
    ulListing: 'UL 2703A',
    warranty: '25 years',
    datasheetUrl: 'https://unirac.com/residential/solarmount/',
  },
  {
    id: 'snapnrack-series-100',
    manufacturer: 'SnapNrack',
    model: 'Series 100',
    material: '6005-T5 Aluminum',
    dimensions: {
      height: 1.5,
      width: 1.5,
      weightPerFt: 0.45,
    },
    spans: {
      maxSpan: 72,
      maxCantilever: 12,
      spliceInterval: 240,
    },
    hardware: {
      midClamp: 'Series 100 Mid Clamp',
      endClamp: 'Series 100 End Clamp',
      lFoot: 'Series 100 L-Foot',
      spliceKit: 'Series 100 Splice',
    },
    ratings: {
      maxWindSpeed: 150,
      maxSnowLoad: 50,
    },
    ulListing: 'UL 2703A',
    warranty: '25 years',
    datasheetUrl: 'https://snapnrack.com/products/series-100/',
  },
];

// Default rail system (IronRidge XR100 is most common)
export const DEFAULT_RAIL = RAIL_SYSTEMS[0];

// Helper functions
export function getRailById(id: string): RailSystemSpecs | undefined {
  return RAIL_SYSTEMS.find(r => r.id === id);
}

export function calculateRailSpan(
  snowLoad: number,
  windSpeed: number,
  rail: RailSystemSpecs = DEFAULT_RAIL
): number {
  // Reduce span for high loads
  let span = rail.spans.maxSpan;
  
  // Reduce 6" for every 10 psf over 30 psf snow
  if (snowLoad > 30) {
    span -= Math.floor((snowLoad - 30) / 10) * 6;
  }
  
  // Reduce 6" for every 20 mph over 130 mph wind
  if (windSpeed > 130) {
    span -= Math.floor((windSpeed - 130) / 20) * 6;
  }
  
  // Minimum 36" span
  return Math.max(36, span);
}

export function calculateCantilever(
  span: number,
  rail: RailSystemSpecs = DEFAULT_RAIL
): number {
  // Cantilever is typically L/6 or max 12"
  return Math.min(span / 6, rail.spans.maxCantilever);
}

export function calculateRailLength(
  panelCount: number,
  panelsPerRow: number,
  panelDimension: number, // length or width depending on orientation
  rowCount: number
): { railLengthPerRow: number; totalRails: number; spliceCount: number } {
  // Rail length per row = panels × dimension + overhang
  const overhang = 6; // 6" overhang each end
  const railLengthPerRow = (panelCount / rowCount) * panelDimension + overhang * 2;
  
  // 2 rails per row
  const totalRails = rowCount * 2;
  
  // Splices needed (every 20 ft)
  const railLengthFt = railLengthPerRow / 12;
  const splicesPerRail = Math.ceil(railLengthFt / 20) - 1;
  const spliceCount = splicesPerRail * totalRails;
  
  return {
    railLengthPerRow,
    totalRails,
    spliceCount: Math.max(0, spliceCount),
  };
}

export function calculateMountCount(
  railLengthInches: number,
  spanInches: number,
  rowCount: number
): number {
  // Mounts per rail = ceil(railLength / span) + 1
  const mountsPerRail = Math.ceil(railLengthInches / spanInches) + 1;
  
  // 2 rails per row
  return mountsPerRail * rowCount * 2;
}

export function calculateHardwareCounts(
  panelCount: number,
  panelsPerRow: number,
  rowCount: number
): { midClamps: number; endClamps: number; lFeet: number; mountCount: number } {
  // Mid clamps: between each panel pair, both sides
  const midClampsPerRow = (panelsPerRow - 1) * 2;
  const midClamps = midClampsPerRow * rowCount;
  
  // End clamps: 4 per row (2 rails × 2 ends)
  const endClamps = rowCount * 4;
  
  // L-feet: equal to mount count (calculated separately)
  // This is returned as placeholder
  const lFeet = 0;
  
  // Mount count depends on span
  const mountCount = 0;
  
  return { midClamps, endClamps, lFeet, mountCount };
}

export default {
  systems: RAIL_SYSTEMS,
  default: DEFAULT_RAIL,
  getRailById,
  calculateRailSpan,
  calculateCantilever,
  calculateRailLength,
  calculateMountCount,
  calculateHardwareCounts,
};