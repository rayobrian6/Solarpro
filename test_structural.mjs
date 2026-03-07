import { runStructuralCalc } from './lib/structural-calc.ts';

// Test case: Standard 2x6 truss at 24" OC, 14' span, 115 mph wind, 20 psf snow
const input = {
  windSpeed: 115,
  windExposure: 'C',
  groundSnowLoad: 20,
  roofType: 'shingle',
  roofPitch: 20,
  rafterSpacing: 24,
  rafterSpan: 14,
  rafterSize: '2x6',
  rafterSpecies: 'Douglas Fir-Larch',
  panelLength: 70.9,
  panelWidth: 41.7,
  panelWeight: 44.1,
  panelCount: 20,
  rackingWeight: 4.0,
  attachmentSpacing: 48,
  railSpan: 48,
  rowSpacing: 12,
  arrayTilt: 0,
  systemType: 'roof'
};

const result = runStructuralCalc(input);
console.log('=== STANDARD 2x6 TRUSS TEST ===');
console.log('Status:', result.status);
console.log('Errors:', result.errors.length);
console.log('Warnings:', result.warnings.length);
console.log('');
console.log('=== RAFTER RESULT ===');
console.log('Utilization:', (result.rafter.utilizationRatio * 100).toFixed(1) + '%');
console.log('Bending Moment:', result.rafter.bendingMoment.toFixed(0), 'ft-lbs');
console.log('Allowable Moment:', result.rafter.allowableBendingMoment.toFixed(0), 'ft-lbs');
console.log('Fb base:', result.rafter.Fb_base, 'psi');
console.log('Fb prime:', result.rafter.Fb_prime.toFixed(0), 'psi');
console.log('Cd:', result.rafter.Cd);
console.log('Cr:', result.rafter.Cr);
console.log('Total Load:', result.rafter.totalLoadPsf.toFixed(1), 'psf');
console.log('Line Load:', result.rafter.lineLoad.toFixed(1), 'plf');
console.log('Deflection:', result.rafter.deflection.toFixed(3), '"');
console.log('Allowable Defl:', result.rafter.allowableDeflection.toFixed(3), '"');
console.log('');
console.log('=== ATTACHMENT RESULT ===');
console.log('Safety Factor:', result.attachment.safetyFactor.toFixed(2));
console.log('Uplift per Attach:', result.attachment.upliftPerAttachment.toFixed(0), 'lbs');
console.log('Lag Bolt Capacity:', result.attachment.lagBoltCapacity.toFixed(0), 'lbs');
console.log('');
if (result.errors.length > 0) {
  console.log('=== ERRORS ===');
  result.errors.forEach(e => console.log(e.code + ':', e.message));
}
if (result.warnings.length > 0) {
  console.log('=== WARNINGS ===');
  result.warnings.forEach(w => console.log(w.code + ':', w.message));
}
