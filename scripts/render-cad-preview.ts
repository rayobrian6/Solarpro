// Local render harness — drives the schematic CAD renderer with mock roof+panel
// data so the SVG can be inspected without the full permit/DB/auth pipeline.
// Run: npx tsx scripts/render-cad-preview.ts  → writes scratch SVG to stdout/file.
import { buildSchemSVG } from '../lib/permit/utils/drawing';
import { drawRoofPlan } from '../lib/drafting/templates/roof';
import * as fs from 'fs';

// Center on Granite City IL (Ray's test address). 1° lat ≈ 364,000 ft; we just
// need internally-consistent lat/lng for the projector.
// drawRoofPlan uses "fake-degree" CAD encoding where 1 unit ≈ 1 ft. Mock the
// roof in that space (NOT real lat/lng) so the panel-size math is correct.
const cLat = 38.7009, cLng = -90.1487;
const ftToLat = (ft: number) => ft;
const ftToLng = (ft: number) => ft;

// A 64' x 31' hip roof → 4 planes (ridge runs E-W down the middle).
const halfW = ftToLng(32), halfH = ftToLat(15.5);
const ridgeFrac = 0.55; // ridge offset toward center
const N = cLat + halfH, S = cLat - halfH, E = cLng + halfW, Wd = cLng - halfW;
const rN = cLat + halfH * (1 - ridgeFrac), rS = cLat - halfH * (1 - ridgeFrac);
const rE = cLng + halfW * (1 - ridgeFrac), rWd = cLng - halfW * (1 - ridgeFrac);

const roofPlanes: any[] = [
  { id: 'p1', pitch: 18.43, azimuth: 180, vertices: [{ lat: S, lng: Wd }, { lat: S, lng: E }, { lat: rS, lng: rE }, { lat: rS, lng: rWd }] }, // S
  { id: 'p2', pitch: 18.43, azimuth: 270, vertices: [{ lat: S, lng: Wd }, { lat: rS, lng: rWd }, { lat: rN, lng: rWd }, { lat: N, lng: Wd }] }, // W
  { id: 'p3', pitch: 18.43, azimuth: 0,   vertices: [{ lat: N, lng: Wd }, { lat: rN, lng: rWd }, { lat: rN, lng: rE }, { lat: N, lng: E }] }, // N
  { id: 'p4', pitch: 18.43, azimuth: 90,  vertices: [{ lat: N, lng: E }, { lat: rN, lng: rE }, { lat: rS, lng: rE }, { lat: S, lng: E }] }, // E
];

// 52 panels in two bands (N and S slopes) — a realistic hip layout.
const panelPos: any[] = [];
let id = 0;
const cols = 11, rowsPerBand = 2;
for (let band = 0; band < 2; band++) {
  const bandLat = band === 0 ? cLat - halfH * 0.45 : cLat + halfH * 0.18;
  for (let r = 0; r < rowsPerBand; r++) {
    for (let c = 0; c < cols && id < 44; c++) {
      panelPos.push({
        id: `pan-${id++}`,
        lat: bandLat + ftToLat(r * 6 - 3),
        lng: cLng - halfW * 0.62 + ftToLng(c * 5.6),
        orientation: 'portrait', row: band * 2 + r, col: c,
      });
    }
  }
}
// 8 more on the E/W gable returns
for (let k = 0; k < 8 && id < 52; k++) {
  panelPos.push({
    id: `pan-${id++}`,
    lat: cLat + ftToLat((k % 4) * 6 - 9),
    lng: (k < 4 ? cLng - halfW * 0.85 : cLng + halfW * 0.78),
    orientation: 'portrait', row: 6 + (k % 4), col: k < 4 ? 0 : 12,
  });
}

const schemSvg = buildSchemSVG(
  roofPlanes, panelPos, 52, 22.36, 66, 40, 1000, 640,
  '3 MELVIN DR APT A, GRANITE CITY, IL 62040', 'Granite City',
);

// drawRoofPlan (the actual PV-2B renderer) — needs DraftingInput + CADModel.
const input: any = {
  project: {
    panelPositions: panelPos,
    roofPlanes,
    roofPitch: 18.43, mountingSystem: 'ROOF TECH RT-MINI', roofType: 'SHINGLE',
    rafterSpacing: 24, attachmentSpacing: 48, ahjRoofSetbackIn: 18, ahjRidgeSetbackIn: 18,
    panelLengthIn: 66, panelWidthIn: 40,
  },
  layout: { panels: panelPos },
  engineering: { totalPanels: 52, totalDcKw: 22.36, panelWatts: 430 },
};
const cad: any = {
  totalPanels: 52, totalDcKw: 22.36, systemType: 'roof',
  roof: { planes: roofPlanes.map(p => ({ ...p, polygon: p.vertices })) },
};

let roofPlanSvg = '';
try {
  roofPlanSvg = drawRoofPlan(input, null, cad, null);
} catch (e) {
  roofPlanSvg = `<!-- drawRoofPlan error: ${(e as Error).message} -->`;
  console.log('drawRoofPlan ERROR:', (e as Error).message);
}

const base = process.argv[2] || 'scratch-cad';
fs.writeFileSync(base + '-schem.svg', schemSvg);
fs.writeFileSync(base + '-roofplan.svg', roofPlanSvg);
console.log('WROTE', base + '-schem.svg', schemSvg.length, '|', base + '-roofplan.svg', roofPlanSvg.length, 'bytes');
