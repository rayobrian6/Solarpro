// Check if voltage drop forces upsize from #4 to #3

// Voltage drop formula: VD = (2 × K × I × L) / CM
// K = 12.9 for copper (resistivity)
// For 3-phase or split-phase: use 2×L for single-phase
// CM = circular mils

const CM: Record<string, number> = {
  '#14 AWG': 4110, '#12 AWG': 6530, '#10 AWG': 10380, '#8 AWG': 16510,
  '#6 AWG': 26240, '#4 AWG': 41740, '#3 AWG': 52620, '#2 AWG': 66360,
  '#1 AWG': 83690, '#1/0 AWG': 105600, '#2/0 AWG': 133100, '#3/0 AWG': 167800, '#4/0 AWG': 211600
};

const K = 12.9; // copper
const I = 54;   // amps
const systemVoltage = 240;
const maxVDropPct = 2.0;

// Run lengths to check
const runLengths = [
  { name: 'COMBINER_TO_DISCO (40ft)', L: 40 },
  { name: 'DISCO_TO_METER (60ft)', L: 60 },
  { name: 'COMBINER_TO_DISCO + DISCO_TO_METER (100ft total)', L: 100 },
];

console.log(`Current: ${I}A, System: ${systemVoltage}V, Max VDrop: ${maxVDropPct}%`);
console.log(`Max allowed VDrop: ${(systemVoltage * maxVDropPct / 100).toFixed(2)}V`);
console.log('');

for (const run of runLengths) {
  console.log(`=== ${run.name} ===`);
  for (const [gauge, cm] of Object.entries(CM)) {
    const vdrop = (2 * K * I * run.L) / cm;
    const vdropPct = (vdrop / systemVoltage) * 100;
    const pass = vdropPct <= maxVDropPct;
    if (['#6 AWG', '#4 AWG', '#3 AWG', '#2 AWG'].includes(gauge)) {
      console.log(`  ${gauge}: VDrop=${vdrop.toFixed(2)}V (${vdropPct.toFixed(2)}%) ${pass ? '✅' : '❌'}`);
    }
  }
  console.log('');
}