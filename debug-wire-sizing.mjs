// Debug script: trace exact wire sizing for 34-panel IQ8+ system
// IQ8+ specs: acOutputKw = 0.295, acOutputCurrentMax = 1.21A

const panels = 34;
const inverterAcKw = 0.295;
const branchLimit = 16;
const systemVoltageAC = 240;

// Per-micro AC current (how computeSystem calculates it)
const perMicroCurrentA = (inverterAcKw * 1000) / 240;
console.log(`perMicroCurrentA = (${inverterAcKw} × 1000) / 240 = ${perMicroCurrentA.toFixed(4)}A`);

// Branch distribution
const microDeviceCount = panels; // 1 micro per panel
const acBranchCount = Math.ceil(microDeviceCount / branchLimit);
console.log(`\nacBranchCount = ceil(${microDeviceCount} / ${branchLimit}) = ${acBranchCount}`);

const basePerBranch = Math.floor(microDeviceCount / acBranchCount);
const remainder = microDeviceCount % acBranchCount;
console.log(`basePerBranch = floor(${microDeviceCount} / ${acBranchCount}) = ${basePerBranch}`);
console.log(`remainder = ${microDeviceCount} % ${acBranchCount} = ${remainder}`);

for (let b = 0; b < acBranchCount; b++) {
  const devicesOnBranch = b < remainder ? basePerBranch + 1 : basePerBranch;
  const branchCurrent = devicesOnBranch * perMicroCurrentA;
  console.log(`  Branch ${b+1}: ${devicesOnBranch} devices × ${perMicroCurrentA.toFixed(4)}A = ${branchCurrent.toFixed(4)}A`);
}

// acBranchCurrentA = largest branch (branch 0)
const devicesOnBranch0 = 0 < remainder ? basePerBranch + 1 : basePerBranch;
const acBranchCurrentA = devicesOnBranch0 * perMicroCurrentA;
console.log(`\nacBranchCurrentA (branch 0, largest) = ${acBranchCurrentA.toFixed(4)}A`);

// BRANCH_RUN wire sizing
const branchRequired = acBranchCurrentA * 1.25;
console.log(`\n=== BRANCH_RUN ===`);
console.log(`continuousCurrent = ${acBranchCurrentA.toFixed(4)}A`);
console.log(`requiredAmpacity = ${acBranchCurrentA.toFixed(4)} × 1.25 = ${branchRequired.toFixed(4)}A`);

// NEC 310.16 @ 75°C
const AMPACITY_75C = {
  '#14 AWG': 15, '#12 AWG': 20, '#10 AWG': 30, '#8 AWG': 50,
  '#6 AWG': 65, '#4 AWG': 85, '#3 AWG': 100,
};
const AWG_ORDER = ['#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG', '#3 AWG'];

// startGauge = '#10 AWG', no derating (ambient = default)
// getTempDerating(25°C) = 1.0 (no derating below 30°C)
// getConduitDerating(3 conductors) = 1.0 (≤3 conductors)
const tempDerating = 1.0;
const conduitDerating = 1.0;

console.log(`tempDerating = ${tempDerating}, conduitDerating = ${conduitDerating}`);

for (const gauge of AWG_ORDER) {
  const tableAmp = AMPACITY_75C[gauge];
  const effective = tableAmp * tempDerating * conduitDerating;
  const pass = effective >= branchRequired;
  console.log(`  ${gauge}: table=${tableAmp}A, effective=${effective}A, required=${branchRequired.toFixed(2)}A → ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
  if (pass) {
    console.log(`  → BRANCH_RUN should be: ${gauge}`);
    break;
  }
}

// COMBINER_TO_DISCO_RUN
const acOutputCurrentA = microDeviceCount * perMicroCurrentA;
const acContinuousCurrentA = acOutputCurrentA * 1.25;
console.log(`\n=== COMBINER_TO_DISCO_RUN ===`);
console.log(`acOutputCurrentA = ${microDeviceCount} × ${perMicroCurrentA.toFixed(4)} = ${acOutputCurrentA.toFixed(4)}A`);
console.log(`continuousCurrent (passed to autoSizeWire) = ${acOutputCurrentA.toFixed(4)}A`);
console.log(`requiredAmpacity = ${acOutputCurrentA.toFixed(4)} × 1.25 = ${(acOutputCurrentA * 1.25).toFixed(4)}A`);

const comboRequired = acOutputCurrentA * 1.25;
for (const gauge of AWG_ORDER) {
  const tableAmp = AMPACITY_75C[gauge];
  const effective = tableAmp * tempDerating * conduitDerating;
  const pass = effective >= comboRequired;
  console.log(`  ${gauge}: table=${tableAmp}A, effective=${effective}A, required=${comboRequired.toFixed(2)}A → ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
  if (pass) {
    console.log(`  → COMBINER_TO_DISCO_RUN should be: ${gauge}`);
    break;
  }
}

// Now check what the ACTUAL input.ambientTempC might be
console.log(`\n=== CHECKING WITH AMBIENT TEMP DERATING ===`);
// Default ambientTempC in page.tsx?
// Let's check what happens with ambientTempC = 30°C (common default)
// getTempDerating(30) = 1.0 (threshold is exactly 30)
// But what if ambientTempC = 35°C?
function getTempDerating(ambientC) {
  if (ambientC <= 30) return 1.00;
  if (ambientC <= 35) return 0.94;
  if (ambientC <= 40) return 0.88;
  if (ambientC <= 45) return 0.82;
  if (ambientC <= 50) return 0.75;
  if (ambientC <= 55) return 0.67;
  if (ambientC <= 60) return 0.58;
  return 0.50;
}

for (const ambC of [25, 30, 35, 40]) {
  const td = getTempDerating(ambC);
  const branchEff10 = 30 * td;
  const branchEff8 = 50 * td;
  const comboEff6 = 65 * td;
  const comboEff3 = 100 * td;
  console.log(`\nambientTempC=${ambC}°C, tempDerating=${td}`);
  console.log(`  BRANCH: #10 AWG effective=${branchEff10.toFixed(1)}A vs required=${branchRequired.toFixed(2)}A → ${branchEff10 >= branchRequired ? 'PASS' : 'FAIL → needs #8 AWG'}`);
  if (branchEff10 < branchRequired) {
    console.log(`  BRANCH: #8 AWG effective=${branchEff8.toFixed(1)}A vs required=${branchRequired.toFixed(2)}A → ${branchEff8 >= branchRequired ? 'PASS' : 'FAIL'}`);
  }
  console.log(`  COMBO:  #6 AWG effective=${comboEff6.toFixed(1)}A vs required=${comboRequired.toFixed(2)}A → ${comboEff6 >= comboRequired ? 'PASS' : 'FAIL → needs larger'}`);
  if (comboEff6 < comboRequired) {
    console.log(`  COMBO:  #3 AWG effective=${comboEff3.toFixed(1)}A vs required=${comboRequired.toFixed(2)}A → ${comboEff3 >= comboRequired ? 'PASS' : 'FAIL'}`);
  }
}

// Check conduit derating for 3 conductors
function getConduitDerating(conductorCount) {
  if (conductorCount <= 3) return 1.00;
  if (conductorCount <= 6) return 0.80;
  if (conductorCount <= 9) return 0.70;
  if (conductorCount <= 20) return 0.50;
  return 0.35;
}
console.log(`\n=== CONDUIT DERATING ===`);
console.log(`3 conductors (L1, L2, N): derating = ${getConduitDerating(3)}`);
// Note: NEC 310.15(C) - neutral counts if it carries unbalanced current
// For single-phase 240V, neutral may not count