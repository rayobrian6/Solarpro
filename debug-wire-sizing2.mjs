// Precise debug with actual values from computed-system.ts

const panels = 34;
const inverterAcKw = 0.295;
const branchLimit = 16;
const systemVoltageAC = 240;
const ambientTempC = 40; // default from page.tsx line 392
const rooftopTempAdderC = 30; // line 393
const maxACVoltageDropPct = 2; // line 409

// Actual getTempDerating from computed-system.ts
function getTempDerating(ambientC) {
  if (ambientC <= 25) return 1.04;
  if (ambientC <= 30) return 1.00;
  if (ambientC <= 35) return 0.96;
  if (ambientC <= 40) return 0.91;
  if (ambientC <= 45) return 0.87;
  if (ambientC <= 50) return 0.82;
  if (ambientC <= 55) return 0.76;
  if (ambientC <= 60) return 0.71;
  return 0.58;
}

function getConduitDerating(conductorCount) {
  if (conductorCount <= 3) return 1.00;
  if (conductorCount <= 6) return 0.80;
  if (conductorCount <= 9) return 0.70;
  if (conductorCount <= 20) return 0.50;
  return 0.35;
}

const AMPACITY_75C = {
  '#14 AWG': 15, '#12 AWG': 20, '#10 AWG': 30, '#8 AWG': 50,
  '#6 AWG': 65, '#4 AWG': 85, '#3 AWG': 100, '#2 AWG': 115,
};
const AWG_ORDER = ['#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG', '#3 AWG', '#2 AWG'];

function nextStandardOCPD(amps) {
  const STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
  return STANDARD_OCPD.find(s => s >= amps) ?? 400;
}

// Per-micro AC current
const perMicroCurrentA = (inverterAcKw * 1000) / 240;
console.log(`perMicroCurrentA = ${perMicroCurrentA.toFixed(4)}A`);

// Branch distribution
const microDeviceCount = panels;
const acBranchCount = Math.ceil(microDeviceCount / branchLimit);
const basePerBranch = Math.floor(microDeviceCount / acBranchCount);
const remainder = microDeviceCount % acBranchCount;
const devicesOnBranch0 = 0 < remainder ? basePerBranch + 1 : basePerBranch;
const acBranchCurrentA = devicesOnBranch0 * perMicroCurrentA;
const acBranchOcpdAmps = nextStandardOCPD(acBranchCurrentA * 1.25);

console.log(`acBranchCount=${acBranchCount}, devicesOnBranch0=${devicesOnBranch0}`);
console.log(`acBranchCurrentA=${acBranchCurrentA.toFixed(4)}A, acBranchOcpdAmps=${acBranchOcpdAmps}A`);

// Total AC output
const acOutputCurrentA = microDeviceCount * perMicroCurrentA;
const acContinuousCurrentA = acOutputCurrentA * 1.25;
const acOcpdAmps = nextStandardOCPD(acContinuousCurrentA);
console.log(`acOutputCurrentA=${acOutputCurrentA.toFixed(4)}A, acOcpdAmps=${acOcpdAmps}A`);

// BRANCH_RUN: autoSizeWire(acBranchCurrentA, 50ft, 3 conductors, EMT, ambientTempC=40, 240V, 2%, false, '#10 AWG')
console.log(`\n=== BRANCH_RUN autoSizeWire ===`);
console.log(`continuousCurrent=${acBranchCurrentA.toFixed(4)}A, ambientTempC=${ambientTempC}`);
const branchRequired = acBranchCurrentA * 1.25;
const branchTempDerating = getTempDerating(ambientTempC); // ambient only (not rooftop) for AC runs
const branchConduitDerating = getConduitDerating(3); // 3 conductors
console.log(`requiredAmpacity=${branchRequired.toFixed(4)}A`);
console.log(`tempDerating=${branchTempDerating}, conduitDerating=${branchConduitDerating}`);

for (const gauge of AWG_ORDER) {
  const tableAmp = AMPACITY_75C[gauge];
  const effective = tableAmp * branchTempDerating * branchConduitDerating;
  const pass = effective >= branchRequired;
  console.log(`  ${gauge}: table=${tableAmp}A × ${branchTempDerating} × ${branchConduitDerating} = ${effective.toFixed(2)}A vs ${branchRequired.toFixed(2)}A → ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
  if (pass) {
    console.log(`  *** BRANCH_RUN result: ${gauge} ***`);
    break;
  }
}

// COMBINER_TO_DISCO_RUN: autoSizeWire(acOutputCurrentA, 20ft, 3 conductors, EMT, ambientTempC=40, 240V, 2%, false, '#10 AWG')
console.log(`\n=== COMBINER_TO_DISCO_RUN autoSizeWire ===`);
console.log(`continuousCurrent=${acOutputCurrentA.toFixed(4)}A, ambientTempC=${ambientTempC}`);
const comboRequired = acOutputCurrentA * 1.25;
const comboTempDerating = getTempDerating(ambientTempC);
const comboConduitDerating = getConduitDerating(3);
console.log(`requiredAmpacity=${comboRequired.toFixed(4)}A`);
console.log(`tempDerating=${comboTempDerating}, conduitDerating=${comboConduitDerating}`);

for (const gauge of AWG_ORDER) {
  const tableAmp = AMPACITY_75C[gauge];
  const effective = tableAmp * comboTempDerating * comboConduitDerating;
  const pass = effective >= comboRequired;
  console.log(`  ${gauge}: table=${tableAmp}A × ${comboTempDerating} × ${comboConduitDerating} = ${effective.toFixed(2)}A vs ${comboRequired.toFixed(2)}A → ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
  if (pass) {
    console.log(`  *** COMBINER_TO_DISCO_RUN result: ${gauge} ***`);
    break;
  }
}

// Now check what happens if voltage drop also fails for #6 AWG on combiner
// calcVoltageDrop(41.79A, 20ft, '#6 AWG', 240V, 2 conductors)
const CMIL = {
  '#10 AWG': 10380, '#8 AWG': 16510, '#6 AWG': 26240, '#4 AWG': 41740,
  '#3 AWG': 52620, '#2 AWG': 66360,
};
function calcVoltageDrop(currentA, onewayFt, gauge, voltageV, conductorCount = 2) {
  const cmil = CMIL[gauge] ?? 10380;
  const resistivity = 12.9;
  const resistance = (resistivity * onewayFt * conductorCount) / cmil;
  const dropV = currentA * resistance;
  return (dropV / voltageV) * 100;
}

console.log(`\n=== VOLTAGE DROP CHECK (maxACVoltageDropPct=${maxACVoltageDropPct}%) ===`);
for (const gauge of ['#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG', '#3 AWG']) {
  const vd = calcVoltageDrop(acOutputCurrentA, 20, gauge, 240, 2);
  console.log(`  COMBINER ${gauge}: VD=${vd.toFixed(3)}% vs max=${maxACVoltageDropPct}% → ${vd <= maxACVoltageDropPct ? 'PASS ✓' : 'FAIL ✗'}`);
}

for (const gauge of ['#10 AWG', '#8 AWG', '#6 AWG']) {
  const vd = calcVoltageDrop(acBranchCurrentA, 50, gauge, 240, 2);
  console.log(`  BRANCH   ${gauge}: VD=${vd.toFixed(3)}% vs max=${maxACVoltageDropPct}% → ${vd <= maxACVoltageDropPct ? 'PASS ✓' : 'FAIL ✗'}`);
}

// Combined check: ampacity AND voltage drop must both pass
console.log(`\n=== COMBINED CHECK (ampacity AND voltage drop) ===`);
console.log(`BRANCH_RUN (${acBranchCurrentA.toFixed(2)}A, 50ft, 3 cond, 40°C):`);
for (const gauge of AWG_ORDER) {
  const tableAmp = AMPACITY_75C[gauge];
  const effective = tableAmp * branchTempDerating * branchConduitDerating;
  const ampPass = effective >= branchRequired;
  const vd = calcVoltageDrop(acBranchCurrentA, 50, gauge, 240, 2);
  const vdPass = vd <= maxACVoltageDropPct;
  console.log(`  ${gauge}: amp=${ampPass ? 'PASS' : 'FAIL'} (${effective.toFixed(1)}A≥${branchRequired.toFixed(1)}A), VD=${vdPass ? 'PASS' : 'FAIL'} (${vd.toFixed(3)}%≤${maxACVoltageDropPct}%) → ${ampPass && vdPass ? '✓ SELECTED' : '✗'}`);
  if (ampPass && vdPass) break;
}

console.log(`COMBINER_TO_DISCO_RUN (${acOutputCurrentA.toFixed(2)}A, 20ft, 3 cond, 40°C):`);
for (const gauge of AWG_ORDER) {
  const tableAmp = AMPACITY_75C[gauge];
  const effective = tableAmp * comboTempDerating * comboConduitDerating;
  const ampPass = effective >= comboRequired;
  const vd = calcVoltageDrop(acOutputCurrentA, 20, gauge, 240, 2);
  const vdPass = vd <= maxACVoltageDropPct;
  console.log(`  ${gauge}: amp=${ampPass ? 'PASS' : 'FAIL'} (${effective.toFixed(1)}A≥${comboRequired.toFixed(1)}A), VD=${vdPass ? 'PASS' : 'FAIL'} (${vd.toFixed(3)}%≤${maxACVoltageDropPct}%) → ${ampPass && vdPass ? '✓ SELECTED' : '✗'}`);
  if (ampPass && vdPass) break;
}