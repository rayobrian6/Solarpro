/**
 * Generate a live permit HTML preview without auth
 * Run: npx tsx scripts/gen_permit_html.ts
 * 
 * This works by re-implementing generatePermitHTML using the same
 * logic as the route, but callable standalone.
 */

// We'll use esbuild to bundle the route file's generatePermitHTML function
// then execute it with test data.

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import path from 'path';

const routePath = path.join(process.cwd(), 'app/api/engineering/permit/route.ts');
const outPath = path.join(process.cwd(), 'scripts/permit_bundle.mjs');

console.log('🔨 Bundling permit route with esbuild...');

// Bundle just the TypeScript to JavaScript (no JSX, no Next.js deps)
const result = spawnSync(
  './node_modules/.bin/esbuild',
  [
    routePath,
    '--bundle=false',
    '--format=esm',
    '--platform=node',
    '--target=node20',
    `--outfile=${outPath}`,
  ],
  { encoding: 'utf-8', cwd: process.cwd() }
);

if (result.stderr && result.stderr.includes('error')) {
  console.error('esbuild errors:', result.stderr);
  process.exit(1);
}

// Now patch the bundle to remove Next.js imports and make generatePermitHTML callable
let bundle = readFileSync(outPath, 'utf-8');

// Remove Next.js and fs imports (not needed for HTML generation)
bundle = bundle
  .replace(/^import.*next\/server.*$/gm, '')
  .replace(/^import.*lib\/auth.*$/gm, '')
  .replace(/^import.*child_process.*$/gm, '')
  .replace(/^import.*fs\/promises.*$/gm, '')
  .replace(/^import.*util.*$/gm, '')
  .replace(/^import.*path.*$/gm, '')
  .replace(/^import.*os.*$/gm, '')
  .replace(/^export const dynamic.*$/gm, '')
  .replace(/^export async function POST[\s\S]*$/, ''); // remove the route handler

// Add export for generatePermitHTML
bundle += '\nexport { generatePermitHTML };\n';

writeFileSync(outPath, bundle);
console.log('✅ Bundle patched and written to scripts/permit_bundle.mjs');

// Now dynamically import and run it
const { generatePermitHTML } = await import(outPath);

const testInput = {
  project: {
    projectName: "Smith Residence Solar + Storage",
    clientName: "John & Jane Smith",
    address: "1234 Maple Street, Springfield, IL 62701",
    designer: "SolarPro Engineering",
    date: "2025-08-12",
    notes: "Rooftop solar PV system with battery backup",
    systemType: "grid-tie-battery",
    mainPanelAmps: 200,
    mainPanelBrand: "Square D QO",
    utilityMeter: "ABC-123456",
    utilityName: "Ameren Illinois",
    acDisconnect: true,
    dcDisconnect: false,
    productionMeter: false,
    rapidShutdown: true,
    conduitType: "EMT",
    wireGauge: "#10 AWG",
    wireLength: 75,
    roofType: "shingle",
    mountingSystem: "IronRidge XR100",
    mountingSystemId: "ironridge-xr100",
    roofPitch: 26,
    rafterSize: "2x6",
    rafterSpacing: 24,
    attachmentSpacing: 48,
    interconnectionMethod: "LOAD_SIDE",
    panelBusRating: 200,
    batteryBrand: "Enphase",
    batteryModel: "IQ Battery 5P",
    batteryCount: 2,
    batteryKwh: 10.08,
    batteryBackfeedA: 46,
  },
  system: {
    totalDcKw: 14.4,
    totalAcKw: 11.52,
    totalPanels: 36,
    dcAcRatio: 1.25,
    topology: "micro",
    inverters: [{
      manufacturer: "Enphase",
      model: "IQ8M-72-2-US",
      type: "micro",
      acOutputKw: 0.384,
      maxDcVoltage: 60,
      efficiency: 97.0,
      ulListing: "UL 1741-SA",
      strings: [{
        label: "Array A — South Facing",
        panelCount: 36,
        panelManufacturer: "Q CELLS",
        panelModel: "Q.PEAK DUO BLK ML-G10+ 400",
        panelWatts: 400,
        panelVoc: 41.6,
        panelIsc: 12.26,
        wireGauge: "#10 AWG",
        wireLength: 75,
      }],
    }],
  },
  compliance: {
    overallStatus: "PASS",
    utilityName: "Ameren Illinois",
    jurisdiction: { state: "IL", necVersion: "2020", ahj: "Springfield AHJ" },
    electrical: {
      busbar: { passes: true, backfeedBreaker: 50, availableSlots: 2 },
      acVoltageDrop: 1.8,
      errors: [], warnings: [],
    },
    structural: {
      status: "PASS",
      attachment: { safetyFactor: 2.3, lagBoltCapacity: 1240, totalUpliftPerAttachment: 538, maxAllowedSpacing: 48 },
    },
  },
  rulesResult: {
    rules: [
      { id: "NEC-690.12", title: "Rapid Shutdown Required", severity: "info", status: "pass", message: "IQ8M microinverters provide integrated rapid shutdown compliance per NEC 690.12." },
      { id: "NEC-705.12", title: "120% Busbar Rule", severity: "info", status: "pass", message: "Backfeed breaker 50A + main breaker 200A = 250A ≤ 1.2 × 200A bus = 240A. PASSES." },
      { id: "NEC-690.8", title: "OCPD Sizing", severity: "info", status: "pass", message: "String OCPD sized at 125% of Isc per NEC 690.8." },
    ],
  },
  bom: {
    items: [
      { quantity: 36, description: "Q CELLS Q.PEAK DUO BLK ML-G10+ 400W", partNumber: "Q400-BLK", unitCost: 180, totalCost: 6480, category: "panels", ulListing: "UL 61730" },
      { quantity: 36, description: "Enphase IQ8M-72-2-US Microinverter", partNumber: "IQ8M-72-2-US", unitCost: 165, totalCost: 5940, category: "inverters", ulListing: "UL 1741-SA" },
      { quantity: 2, description: "Enphase IQ Battery 5P (5.04 kWh)", partNumber: "B5P-1p-na", unitCost: 2800, totalCost: 5600, category: "battery", ulListing: "UL 9540" },
      { quantity: 1, description: "Enphase IQ System Controller 3", partNumber: "SC3-1p-na", unitCost: 650, totalCost: 650, category: "equipment", ulListing: "UL 1741" },
      { quantity: 1, description: "Enphase IQ Combiner 5C", partNumber: "ENV-IQ-AM1-240", unitCost: 185, totalCost: 185, category: "equipment", ulListing: "UL 67" },
      { quantity: 200, description: "IronRidge XR100 Rail (per foot)", partNumber: "XR-100-168B", unitCost: 3.5, totalCost: 700, category: "mounting", ulListing: "—" },
      { quantity: 72, description: "IronRidge L-Foot Flashing Kit", partNumber: "LFT-001", unitCost: 8.5, totalCost: 612, category: "mounting", ulListing: "—" },
      { quantity: 72, description: "5/16&quot; × 3&quot; Stainless Lag Bolt", partNumber: "LB-516-3SS", unitCost: 1.25, totalCost: 90, category: "hardware", ulListing: "—" },
    ],
  },
  overrides: {},
};

console.log('🔄 Generating permit HTML...');
const html = generatePermitHTML(testInput);

const outputPath = '/workspace/permit_plan_set_preview.html';
writeFileSync(outputPath, html);
console.log(`✅ Permit HTML generated!`);
console.log(`   Size: ${html.length.toLocaleString()} characters`);
console.log(`   Lines: ${html.split('\n').length}`);
console.log(`   Output: ${outputPath}`);