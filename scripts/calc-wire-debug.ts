// Debug the wire sizing math directly

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
const ambientC = 30;
const rooftopTempAdderC = 30;
const ambientForFeeder = ambientC; // feeder is NOT on rooftop

// Temp derating for 30°C ambient (NEC 310.15 Table)
function getTempDerating(ambC: number): number {
  if (ambC <= 10) return 1.29;
  if (ambC <= 15) return 1.22;
  if (ambC <= 20) return 1.15;
  if (ambC <= 25) return 1.08;
  if (ambC <= 30) return 1.00;
  if (ambC <= 35) return 0.91;
  if (ambC <= 40) return 0.82;
  if (ambC <= 45) return 0.71;
  if (ambC <= 50) return 0.58;
  return 0.41;
}

const requiredAmpacity = totalCurrentA * 1.25;
const tempDerating = getTempDerating(ambientForFeeder);
const conduitDerating = 1.0; // 3 CCC = 1.0

console.log(`Total current: ${totalCurrentA}A`);
console.log(`Required ampacity (×1.25): ${requiredAmpacity}A`);
console.log(`Ambient temp: ${ambientForFeeder}°C`);
console.log(`Temp derating: ${tempDerating}`);
console.log(`Conduit derating (3 CCC): ${conduitDerating}`);
console.log('');
console.log('Wire sizing check:');

const AWG_ORDER = ['#14 AWG','#12 AWG','#10 AWG','#8 AWG','#6 AWG','#4 AWG','#3 AWG','#2 AWG','#1 AWG','#1/0 AWG','#2/0 AWG','#3/0 AWG','#4/0 AWG'];

for (const gauge of AWG_ORDER) {
  const amp90 = AMPACITY_90C[gauge] ?? 0;
  const amp75 = AMPACITY_75C[gauge] ?? 0;
  const derated = amp90 * tempDerating * conduitDerating;
  const effectiveAmpacity = Math.min(derated, amp75); // AC = cap at 75°C
  const pass = effectiveAmpacity >= requiredAmpacity;
  console.log(`  ${gauge}: 90°C=${amp90}A, derated=${derated.toFixed(1)}A, effective(capped@75°C)=${effectiveAmpacity.toFixed(1)}A ${pass ? '✅ PASS' : '❌'}`);
  if (pass) {
    console.log(`  → SELECTED: ${gauge}`);
    break;
  }
}