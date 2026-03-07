// V3 Structural Engine Validation Test
// Test Case: 34 panels, 2x6 rafters, 24" OC, 115mph wind, 20psf snow → must PASS

import { runStructuralCalcV3 } from './lib/structural-engine-v3.ts';

// We'll test via the API route instead since we can't import TS directly
import { execSync } from 'child_process';

const testInput = {
  // Site
  windSpeed: 115,
  windExposure: 'C',
  groundSnowLoad: 20,
  meanRoofHeight: 15,
  roofPitch: 20,

  // Framing - 2x6 rafter @ 24" OC
  framingType: 'rafter',
  rafterSize: '2x6',
  rafterSpacingIn: 24,
  rafterSpanFt: 16,
  rafterSpecies: 'Douglas Fir-Larch',

  // Array - 34 panels
  panelCount: 34,
  panelLengthIn: 73.0,
  panelWidthIn: 41.0,
  panelWeightLbs: 45.0,
  panelOrientation: 'portrait',
  moduleGapIn: 0.5,
  rowGapIn: 6,

  // Racking
  rackingSystemId: 'ironridge-xr100',
  rackingWeightPsf: 4.0,
};

console.log('='.repeat(60));
console.log('V3 STRUCTURAL ENGINE VALIDATION TEST');
console.log('Test: 34 panels, 2x6 rafter, 24" OC, 115mph, 20psf');
console.log('='.repeat(60));
console.log();
console.log('Input:', JSON.stringify(testInput, null, 2));