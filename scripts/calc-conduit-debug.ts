// Debug conduit fill calculation - why was 3/0 being selected?

// Conductor areas in sq inches (THWN-2)
const CONDUCTOR_AREA_IN2: Record<string, number> = {
  '#14 AWG': 0.0097, '#12 AWG': 0.0133, '#10 AWG': 0.0211, '#8 AWG': 0.0366,
  '#6 AWG': 0.0507, '#4 AWG': 0.0824, '#3 AWG': 0.0973, '#2 AWG': 0.1158,
  '#1 AWG': 0.1562, '#1/0 AWG': 0.1855, '#2/0 AWG': 0.2223, '#3/0 AWG': 0.2679, '#4/0 AWG': 0.3237
};

// EMT conduit areas (40% fill limit)
const EMT_CONDUIT: Array<{size: string, area: number}> = [
  { size: '1/2"', area: 0.122 }, { size: '3/4"', area: 0.213 },
  { size: '1"', area: 0.346 }, { size: '1-1/4"', area: 0.598 },
  { size: '1-1/2"', area: 0.814 }, { size: '2"', area: 1.342 },
  { size: '2-1/2"', area: 2.343 }, { size: '3"', area: 3.538 },
];

function getSmallestConduit(totalArea: number): {size: string, fillPct: number} {
  for (const c of EMT_CONDUIT) {
    const fillPct = (totalArea / c.area) * 100;
    if (fillPct <= 40) return { size: c.size, fillPct };
  }
  return { size: '3"', fillPct: 100 };
}

function getEGCGauge(ocpdAmps: number): string {
  if (ocpdAmps <= 15) return '#14 AWG';
  if (ocpdAmps <= 20) return '#12 AWG';
  if (ocpdAmps <= 60) return '#10 AWG';
  if (ocpdAmps <= 100) return '#8 AWG';
  if (ocpdAmps <= 200) return '#6 AWG';
  return '#4 AWG';
}

const AWG_ORDER = ['#14 AWG','#12 AWG','#10 AWG','#8 AWG','#6 AWG','#4 AWG','#3 AWG','#2 AWG',
  '#1 AWG','#1/0 AWG','#2/0 AWG','#3/0 AWG','#4/0 AWG'];

const AMPACITY_90C: Record<string, number> = {
  '#14 AWG': 25, '#12 AWG': 30, '#10 AWG': 40, '#8 AWG': 55,
  '#6 AWG': 75, '#4 AWG': 95, '#3 AWG': 110, '#2 AWG': 130,
  '#1 AWG': 150, '#1/0 AWG': 170, '#2/0 AWG': 195, '#3/0 AWG': 225, '#4/0 AWG': 260
};
const AMPACITY_75C: Record<string, number> = {
  '#14 AWG': 20, '#12 AWG': 25, '#10 AWG': 35, '#8 AWG': 50,
  '#6 AWG': 65, '#4 AWG': 85, '#3 AWG': 100, '#2 AWG': 115,
  '#1 AWG': 130, '#1/0 AWG': 150, '#2/0 AWG': 175, '#3/0 AWG': 200, '#4/0 AWG': 230
};

const totalCurrentA = 54;
const requiredAmpacity = totalCurrentA * 1.25; // 67.5A
const ocpdAmps = 70; // nextStandardOCPD(67.5) = 70A
const egcGauge = getEGCGauge(ocpdAmps); // #8 AWG for 70A OCPD? Let's check
console.log(`OCPD: ${ocpdAmps}A, EGC gauge: ${egcGauge}`);
console.log(`Required ampacity: ${requiredAmpacity}A`);
console.log('');

for (const conductorCount of [2, 3]) {
  console.log(`=== conductorCount = ${conductorCount} ===`);
  
  for (const gauge of ['#4 AWG', '#3 AWG', '#2 AWG', '#1 AWG', '#1/0 AWG', '#2/0 AWG', '#3/0 AWG']) {
    const amp90 = AMPACITY_90C[gauge];
    const amp75 = AMPACITY_75C[gauge];
    const effectiveAmpacity = Math.min(amp90, amp75); // no derating at 30°C
    const ampPass = effectiveAmpacity >= requiredAmpacity;
    
    const hotArea = (CONDUCTOR_AREA_IN2[gauge] ?? 0) * conductorCount;
    const egcArea = CONDUCTOR_AREA_IN2[egcGauge] ?? 0;
    const totalArea = hotArea + egcArea;
    const conduit = getSmallestConduit(totalArea);
    const fillPass = conduit.fillPct <= 40;
    
    const selected = ampPass && fillPass;
    console.log(`  ${gauge}: amp=${effectiveAmpacity}A(${ampPass?'✅':'❌'}), area=${totalArea.toFixed(4)}in², conduit=${conduit.size}(${conduit.fillPct.toFixed(1)}%)(${fillPass?'✅':'❌'}) ${selected?'→ SELECTED':''}` );
    if (selected) break;
  }
  console.log('');
}