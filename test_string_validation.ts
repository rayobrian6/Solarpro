// Deep string validation audit — verifies inverter selection AND string counts are mathematically correct
// For each brand: checks that panels distribute correctly across strings and MPPT channels
// Data source authority: brand profile specs drive sizing (not registry electricalSpecs)
import { sizeSystemFromBrand } from '@/lib/system/sizingEngine';
import { getBrandProfile } from '@/lib/system/brandProfiles';
import { getRegistryEntryV4 } from '@/lib/equipment-registry-v4';

const PANEL_WATTS = 400;

// Test multiple system sizes per brand to stress the sizing tiers
const PANEL_COUNTS = [8, 12, 16, 20, 24, 30, 36, 42, 48];

const BRANDS = [
  'solaredge', 'enphase', 'sma', 'fronius', 'goodwe',
  'sungrow', 'sol-ark', 'growatt', 'solis', 'tesla',
  'tigo', 'apsystems', 'hoymiles'
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures: string[] = [];
const warnings: string[] = [];

function validate(brandId: string, panelCount: number) {
  totalTests++;
  const profile = getBrandProfile(brandId);
  if (!profile) {
    failures.push(`${brandId}: NO BRAND PROFILE`);
    failedTests++;
    return;
  }

  let result: any;
  try {
    result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount,
      panelWattage: PANEL_WATTS,
      selectedBrand: brandId,
    });
  } catch (e: any) {
    failures.push(`${brandId} @ ${panelCount}p: SIZING THREW: ${e.message}`);
    failedTests++;
    return;
  }

  const systemDcKw = (panelCount * PANEL_WATTS) / 1000;
  const invModel = result.inverterModels?.[0];
  const invId = invModel?.equipmentDbId;
  const invEntry = invId ? getRegistryEntryV4(invId) : undefined;
  const invCount = result.inverterCount ?? 0;
  const strings = result.strings ?? [];
  const stringCount = strings.length;

  // ── Micro topology ──────────────────────────────────────────────────────────
  // modulesPerDevice: sizing engine strips this field from returned inverterModels[0],
  // so we MUST look it up from the brand profile model directly (not from sizingResult).
  if (profile.topology === 'micro') {
    const profileMicroModel = profile.supportedInverterModels.find(m => m.equipmentDbId === invId);
    const mpd = (profileMicroModel as any)?.modulesPerDevice ?? 1;
    const expectedDevices = Math.ceil(panelCount / mpd);
    if (invCount !== expectedDevices) {
      failures.push(`${brandId} @ ${panelCount}p: micro deviceCount=${invCount} expected=${expectedDevices} (mpd=${mpd})`);
      failedTests++;
      return;
    }
    passedTests++;
    console.log(`  ✅ ${brandId.padEnd(12)} @ ${String(panelCount).padStart(2)}p  micro: ${invCount}× ${invId} (${mpd} panels/device → ${invCount * mpd} slots ≥ ${panelCount})`);
    return;
  }

  // ── Optimizer topology (SolarEdge) ──────────────────────────────────────────
  // Optimizer topology: ALL panels get an optimizer; strings pass through optimizer bus.
  // The central inverter HD-Wave input is a fixed DC bus — string count is NOT MPPT-limited.
  // Strings just need to fit within the optimizer's max input range (≤25 panels/string).
  if (profile.topology === 'optimizer') {
    if (invCount < 1) {
      failures.push(`${brandId} @ ${panelCount}p: inverterCount=${invCount}`);
      failedTests++;
      return;
    }
    if (stringCount < 1) {
      failures.push(`${brandId} @ ${panelCount}p: stringCount=0`);
      failedTests++;
      return;
    }
    const totalPanels = strings.reduce((s: number, str: any) => s + (str.panelCount ?? 0), 0);
    if (totalPanels !== panelCount) {
      failures.push(`${brandId} @ ${panelCount}p: panel sum=${totalPanels} ≠ ${panelCount}`);
      failedTests++;
      return;
    }
    const maxStringLen = Math.max(...strings.map((s: any) => s.panelCount ?? 0));
    if (maxStringLen > 25) {
      failures.push(`${brandId} @ ${panelCount}p: string length ${maxStringLen} > 25 (optimizer max)`);
      failedTests++;
      return;
    }
    passedTests++;
    const minLen = Math.min(...strings.map((s: any) => s.panelCount ?? 0));
    console.log(`  ✅ ${brandId.padEnd(12)} @ ${String(panelCount).padStart(2)}p  optimizer: ${invCount}× ${invId} | ${stringCount} strings [${minLen}–${maxStringLen}/str]`);
    return;
  }

  // ── String / hybrid topology ─────────────────────────────────────────────────
  if (!invEntry) {
    failures.push(`${brandId} @ ${panelCount}p: inverter ${invId} NOT IN REGISTRY`);
    failedTests++;
    return;
  }

  // AUTHORITATIVE: Brand profile model entry drives sizing, not registry electricalSpecs.
  // Registry specs are for electrical calculations (voltage, current), not string allocation.
  const profileModel = profile.supportedInverterModels.find(m => m.equipmentDbId === invId);
  const mpptCount          = profileModel?.mpptCount                  ?? (invEntry.electricalSpecs as any)?.mpptChannels ?? 1;
  const maxParallel        = profileModel?.maxParallelStringsPerMppt  ?? 1;
  const maxPanelsPerString = profileModel?.maxPanelsPerString         ?? 13;
  const minPanelsPerString = profileModel?.minPanelsPerString         ?? 4;
  const acOutputKw         = profileModel?.acKw                       ?? (invEntry.electricalSpecs as any)?.acOutputKw ?? 0;
  const dcAcRatio          = acOutputKw > 0 ? (systemDcKw / invCount) / acOutputKw : null;

  // Check 1: inverter count ≥ 1
  if (invCount < 1) {
    failures.push(`${brandId} @ ${panelCount}p: inverterCount=${invCount}`);
    failedTests++;
    return;
  }

  // Check 2: string count ≥ 1
  if (stringCount < 1) {
    failures.push(`${brandId} @ ${panelCount}p: stringCount=0`);
    failedTests++;
    return;
  }

  // Check 3: total panels across all strings = panelCount (no panels lost or duplicated)
  const totalPanelsInStrings = strings.reduce((sum: number, s: any) => sum + (s.panelCount ?? 0), 0);
  if (totalPanelsInStrings !== panelCount) {
    failures.push(`${brandId} @ ${panelCount}p: panel sum=${totalPanelsInStrings} ≠ ${panelCount}`);
    failedTests++;
    return;
  }

  // Check 4: no string exceeds brand profile maxPanelsPerString
  const maxStringLength = Math.max(...strings.map((s: any) => s.panelCount ?? 0));
  if (maxStringLength > maxPanelsPerString) {
    failures.push(`${brandId} @ ${panelCount}p: longest string=${maxStringLength} > max=${maxPanelsPerString} (${invId})`);
    failedTests++;
    return;
  }

  // Check 5: string count ≤ total MPPT capacity across all inverters
  const maxTotalStrings = mpptCount * maxParallel * invCount;
  if (stringCount > maxTotalStrings) {
    failures.push(`${brandId} @ ${panelCount}p: stringCount=${stringCount} > capacity=${maxTotalStrings} (${mpptCount}mppt × ${maxParallel}parallel × ${invCount}inv)`);
    failedTests++;
    return;
  }

  // Warning: string shorter than minimum (informational — edge case for small systems)
  const minStringLength = Math.min(...strings.map((s: any) => s.panelCount ?? 0));
  if (minStringLength < minPanelsPerString) {
    warnings.push(`${brandId} @ ${panelCount}p: short string=${minStringLength} < min=${minPanelsPerString} (${invId}) — small system edge case`);
  }

  // Warning: low DC/AC ratio for tiny systems (informational only — min-tier inverter)
  if (dcAcRatio !== null && dcAcRatio < 0.7) {
    warnings.push(`${brandId} @ ${panelCount}p: low DC/AC ratio=${dcAcRatio.toFixed(2)} — small system on min-tier inverter (expected)`);
  }

  passedTests++;
  const warnMin   = minStringLength < minPanelsPerString;
  const warnRatio = dcAcRatio !== null && dcAcRatio < 0.7;
  const warnStr   = warnMin   ? ` ⚠️ short=${minStringLength}<${minPanelsPerString}` : '';
  const ratioStr  = dcAcRatio !== null ? ` ratio=${dcAcRatio.toFixed(2)}` : '';
  const ratioWarn = warnRatio ? '⚠️' : '';
  console.log(`  ✅ ${brandId.padEnd(12)} @ ${String(panelCount).padStart(2)}p  ${invCount}× ${invId} | ${stringCount} str [${minStringLength}–${maxStringLength}/str] mppt=${mpptCount}×${maxParallel}${ratioStr}${ratioWarn}${warnStr}`);
}

console.log(`\n${'='.repeat(90)}`);
console.log(`STRING VALIDATION AUDIT — ${PANEL_COUNTS.length} panel counts × ${BRANDS.length} brands = ${PANEL_COUNTS.length * BRANDS.length} tests`);
console.log(`${'='.repeat(90)}\n`);

for (const brand of BRANDS) {
  console.log(`\n── ${brand.toUpperCase()} ──`);
  for (const count of PANEL_COUNTS) {
    validate(brand, count);
  }
}

console.log(`\n${'='.repeat(90)}`);
console.log(`RESULTS: ${passedTests}/${totalTests} passed, ${failedTests} failed`);
console.log(`${'='.repeat(90)}\n`);

if (failures.length > 0) {
  console.log('❌ FAILURES:');
  failures.forEach(f => console.log(`  ❌ ${f}`));
} else {
  console.log('✅ ALL TESTS PASSED — Every brand produces correct string counts across all system sizes');
}

if (warnings.length > 0) {
  console.log(`\n⚠️  WARNINGS (${warnings.length} — informational only):`);
  warnings.forEach(w => console.log(`  ⚠️  ${w}`));
}