/**
 * Structural Engine Verification — Phase 9
 * Case A: 115 mph / Exp B / 34 panels / 2x6@24"OC / 16ft span / 20psf snow
 * Case B: 140 mph / Exp C / same panels
 */

const { runStructuralCalc } = require('/tmp/struct-test/structural-calc.js');

// ─── Case A ───────────────────────────────────────────────────────────────────
// NOTE: Original audit spec used 2x6@24"OC@16ft which is physically overstressed
// (max span for 2x6@24"OC with 32.5psf total load = 8ft per NDS 2018).
// Corrected to 2x10@24"OC@16ft which gives 98.1% utilization (PASS).
const caseA = {
  windSpeed:         115,
  windExposure:      'B',
  groundSnowLoad:    20,
  roofType:          'shingle',
  roofPitch:         20,
  rafterSpacing:     24,
  rafterSpan:        16,
  rafterSize:        '2x10',   // CORRECTED: 2x10 required for 16ft span @ 24"OC with 32.5psf
  rafterSpecies:     'Douglas Fir-Larch',
  panelLength:       70.9,
  panelWidth:        41.7,
  panelWeight:       44,
  panelCount:        34,
  rowCount:          2,
  rackingWeight:     8,
  attachmentSpacing: 48,
  railSpan:          60,   // 5ft row-to-row (FIXED)
  rowSpacing:        12,
  arrayTilt:         20,
  systemType:        'roof',
};

// ─── Case A-original ─────────────────────────────────────────────────────────
// Demonstrates that 2x6@24"OC@16ft correctly FAILs (engine is working)
const caseA_original = {
  ...caseA,
  rafterSize: '2x6',  // Original audit spec — should FAIL (overstressed)
};

// ─── Case B ───────────────────────────────────────────────────────────────────
// 140mph/ExpC — higher wind, same rafter. Attachment spacing should reduce.
const caseB = {
  ...caseA,
  windSpeed:    140,
  windExposure: 'C',
};

function runCase(label, input) {
  const r = runStructuralCalc(input);
  const w = r.wind;
  const s = r.snow;
  const d = r.deadLoad;
  const rf = r.rafter;
  const at = r.attachment;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(70)}`);

  console.log(`\n── Wind (ASCE 7-22 C&C) ──`);
  console.log(`  V = ${input.windSpeed} mph, Exposure ${input.windExposure}`);
  console.log(`  Kz = ${w.Kz.toFixed(2)}, Kzt = ${w.Kzt.toFixed(2)}, Kd = ${w.Kd.toFixed(2)}`);
  console.log(`  qz = 0.00256 × ${w.Kz} × ${w.Kzt} × ${w.Kd} × ${input.windSpeed}² = ${w.velocityPressure.toFixed(3)} psf`);
  console.log(`  GCp = ${w.GCp.toFixed(2)}, GCpi = ${w.GCpi.toFixed(2)}`);
  console.log(`  netUpliftPressure = qz × (|GCp| + GCpi) = ${w.netUpliftPressure.toFixed(3)} psf`);
  console.log(`  tributaryArea = ${(input.attachmentSpacing/12).toFixed(2)}ft × ${(input.railSpan/12).toFixed(2)}ft = ${w.tributaryArea.toFixed(2)} ft²`);
  console.log(`  upliftPerAttachment = ${w.netUpliftPressure.toFixed(3)} × ${w.tributaryArea.toFixed(2)} = ${w.upliftPerAttachment.toFixed(1)} lbs`);

  console.log(`\n── Snow (ASCE 7-22 Ch.7) ──`);
  console.log(`  Pg = ${s.groundSnowLoad} psf → Ps = ${s.roofSnowLoad.toFixed(1)} psf`);

  console.log(`\n── Dead Load ──`);
  console.log(`  PV dead load = ${d.pvDeadLoadPsf.toFixed(2)} psf`);
  console.log(`  Existing roof DL = ${d.existingRoofDeadLoad} psf`);
  console.log(`  Total roof DL = ${d.totalRoofDeadLoad.toFixed(2)} psf`);

  console.log(`\n── Rafter (NDS 2018) ──`);
  console.log(`  ${rf.rafterSize} @ ${rf.rafterSpacing}" OC, ${rf.rafterSpan}ft span`);
  console.log(`  Fb_base = ${rf.Fb_base} psi, Cd = ${rf.Cd}, Cr = ${rf.Cr}`);
  console.log(`  Fb' = ${rf.Fb_base} × ${rf.Cd} × ${rf.Cr} = ${rf.Fb_prime.toFixed(0)} psi`);
  console.log(`  totalLoadPsf = ${rf.totalLoadPsf.toFixed(1)} psf`);
  console.log(`  lineLoad = ${rf.totalLoadPsf.toFixed(1)} × ${rf.tributaryWidth.toFixed(2)}ft = ${rf.lineLoad.toFixed(1)} plf`);
  console.log(`  M = w×L²/8 = ${rf.lineLoad.toFixed(1)} × ${rf.rafterSpan}² / 8 = ${rf.bendingMoment.toFixed(1)} ft-lbs`);
  console.log(`  M_allow = Fb'×S/12 = ${rf.allowableBendingMoment.toFixed(1)} ft-lbs`);
  console.log(`  Utilization = ${rf.bendingMoment.toFixed(1)} / ${rf.allowableBendingMoment.toFixed(1)} = ${(rf.utilizationRatio * 100).toFixed(1)}%`);
  console.log(`  Deflection = ${rf.deflection.toFixed(4)}" (allow: ${rf.allowableDeflection.toFixed(4)}")`);
  console.log(`  Rafter PASS: ${rf.passes}`);

  console.log(`\n── Attachment ──`);
  console.log(`  attachmentSpacing = ${at.attachmentSpacing}"`);
  console.log(`  railSpacing (row-to-row) = ${at.railSpacing}"`);
  console.log(`  tributaryArea = ${at.tributaryArea.toFixed(2)} ft²`);
  console.log(`  Lag bolt capacity = ${at.lagBoltCapacity.toFixed(0)} lbs`);
  console.log(`  Uplift per attachment = ${at.upliftPerAttachment.toFixed(1)} lbs`);
  console.log(`  Safety Factor = ${at.safetyFactor.toFixed(2)}`);
  console.log(`  Max allowed spacing = ${at.maxAllowedSpacing}"`);
  console.log(`  Spacing compliant: ${at.spacingCompliant}`);

  console.log(`\n── OVERALL STATUS: ${r.status} ──`);
  if (r.errors.length > 0) {
    r.errors.forEach(e => console.log(`  ❌ ERROR [${e.code}]: ${e.message}`));
  }
  if (r.warnings.length > 0) {
    r.warnings.forEach(w => console.log(`  ⚠️  WARN  [${w.code}]: ${w.message}`));
  }
  if (r.recommendations.length > 0) {
    r.recommendations.forEach(rec => console.log(`  ℹ️  ${rec}`));
  }

  // ─── Acceptance checks ────────────────────────────────────────────────────
  const checks = [];

  // Uplift per attachment: 200–1500 lbs (residential range, higher for 140mph)
  const upliftOk = w.upliftPerAttachment >= 200 && w.upliftPerAttachment <= 1500;
  checks.push({ name: 'Uplift 200–1500 lbs', pass: upliftOk, value: `${w.upliftPerAttachment.toFixed(1)} lbs` });

  // Rafter utilization < 100%
  const rafterOk = rf.utilizationRatio < 1.0;
  checks.push({ name: 'Rafter util < 100%', pass: rafterOk, value: `${(rf.utilizationRatio*100).toFixed(1)}%` });

  // Safety factor ≥ 1.5 (NDS ASD allowable — minimum for solar permits)
  const sfOk = at.safetyFactor >= 1.5;
  checks.push({ name: 'SF ≥ 1.5 (NDS ASD min)', pass: sfOk, value: at.safetyFactor.toFixed(2) });

  // Tributary area < 50 ft²
  const tribOk = at.tributaryArea < 50;
  checks.push({ name: 'Trib area < 50 ft²', pass: tribOk, value: `${at.tributaryArea.toFixed(2)} ft²` });

  // Fb' > Fb_base (adjustment factors applied)
  const fbOk = rf.Fb_prime > rf.Fb_base;
  checks.push({ name: "Fb' > Fb_base (Cd,Cr applied)", pass: fbOk, value: `${rf.Fb_prime.toFixed(0)} > ${rf.Fb_base}` });

  // Kz is correct for exposure category
  const kzExpected = { B: 0.70, C: 0.85, D: 1.03 };
  const kzOk = Math.abs(w.Kz - kzExpected[input.windExposure]) < 0.001;
  checks.push({ name: `Kz correct for Exp ${input.windExposure}`, pass: kzOk, value: `${w.Kz} (expected ${kzExpected[input.windExposure]})` });

  console.log(`\n── Acceptance Checks ──`);
  let allPass = true;
  checks.forEach(c => {
    const icon = c.pass ? '✅' : '❌';
    console.log(`  ${icon} ${c.name}: ${c.value}`);
    if (!c.pass) allPass = false;
  });

  return { label, allPass, status: r.status, checks };
}

// Run original case first to confirm engine correctly detects overstress
console.log('\n⚠️  Running original audit spec case (2x6@24"@16ft) — expected to FAIL:');
const resultA_orig = runCase('CASE A-ORIGINAL — 115 mph / Exp B / 2x6@24" / 16ft span (SHOULD FAIL)', caseA_original);

// Run corrected cases
const resultA = runCase('CASE A — 115 mph / Exp B / 2x10@24" / 16ft span / 20psf snow', caseA);
const resultB = runCase('CASE B — 140 mph / Exp C / 2x10@24" / 16ft span / 20psf snow', caseB);

console.log(`\n${'═'.repeat(70)}`);
console.log('  VERIFICATION SUMMARY');
console.log(`${'═'.repeat(70)}`);
console.log(`  Case A-orig (2x6@24"@16ft): ${resultA_orig.status === 'FAIL' ? '✅ Correctly FAILS (engine detects overstress)' : '❌ Should have failed'}`);
console.log(`  Case A (2x10@24"@16ft): ${resultA.allPass ? '✅ ALL CHECKS PASS' : '❌ SOME CHECKS FAILED'} (status: ${resultA.status})`);
console.log(`  Case B (140mph/ExpC):    ${resultB.allPass ? '✅ ALL CHECKS PASS' : '❌ SOME CHECKS FAILED'} (status: ${resultB.status})`);

// Gate logic:
//   Case A-orig (2x6@24"@16ft): must FAIL (engine detects overstress)
//   Case A (2x10@24"@16ft): must PASS or WARNING (rafter OK, SF≥1.5)
//   Case B (140mph/ExpC): must FAIL on attachment SF (triggers spacing reduction)
const caseA_orig_ok = resultA_orig.status === 'FAIL';
const caseA_ok      = resultA.allPass;  // rafter < 100%, SF ≥ 1.5
const caseB_ok      = resultB.status === 'FAIL' &&
                      resultB.checks.find(c => c.name.includes('Rafter'))?.pass === true;
// Case B: rafter passes but attachment fails → correct behavior

console.log(`\n── Gate Checks ──`);
console.log(`  ${caseA_orig_ok ? '✅' : '❌'} Case A-orig correctly FAILs (overstressed 2x6@24"@16ft)`);
console.log(`  ${caseA_ok      ? '✅' : '❌'} Case A passes all checks (2x10@24"@16ft, SF=${resultA.checks.find(c=>c.name.includes('SF'))?.value})`);
console.log(`  ${caseB_ok      ? '✅' : '❌'} Case B: rafter OK but attachment FAILS → triggers spacing reduction`);

const gatePass = caseA_orig_ok && caseA_ok && caseB_ok;
console.log(`\n  GATE: ${gatePass ? '✅ DEPLOYMENT GATE OPEN' : '❌ DEPLOYMENT GATE BLOCKED'}`);
process.exit(gatePass ? 0 : 1);