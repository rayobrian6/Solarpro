#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// Stage 3A — Backfill verified datasheet URLs onto 17 Tier-1 equipment rows.
// All URLs were pre-verified (HTTP 200) before approval.
// Works only on lib/equipment-db.ts.
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';

const FILE = path.resolve(__dirname, '..', 'lib', 'equipment-db.ts');

const DATASHEETS: Array<{ id: string; url: string; note?: string }> = [
  // Tesla
  { id: 'tesla-powerwall-2',
    url: 'https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/2/Datasheet/en-us/Powerwall-2-Datasheet.pdf' },
  { id: 'tesla-powerwall-3',
    url: 'https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/3/Datasheet/en-us/Powerwall-3-Datasheet.pdf' },
  { id: 'tesla-backup-gateway-2',
    url: 'https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/2/InstallManual/BackupGateway/2/en-us/GUID-C93D57B7-CA13-4E04-9449-1EAB073A485B.html',
    note: 'HTML specs page (no standalone PDF published)' },
  { id: 'tesla-wall-connector-gen3',
    url: 'https://nwsolar.com/wp-content/uploads/2022/10/Tesla_Wall_Connector_Datasheet_EN-NA.pdf' },

  // Enphase
  { id: 'enphase-iq-battery-10t',
    url: 'https://enphase.com/sites/default/files/2021-10/IQ-Battery-10T-DS-EN-US-10-19-2021.pdf' },
  { id: 'enphase-iq-battery-3t',
    url: 'https://enphase.com/sites/default/files/2021-10/IQ-Battery-3T-DS-EN-US-10-19-2021.pdf' },
  { id: 'enphase-iq-battery-5p',
    url: 'https://assets.ctfassets.net/k6ot5nj1c6f9/2nqAdKtPMi5IirhnfQMeH3/58f82b1f4342baee1df92a71a6fe0b5b/IQ_Battery-5P-DSH-00010-2.0-EN-US-2023-07-26__1_.pdf' },
  { id: 'enphase-iq-combiner-5',
    url: 'https://enphase.com/download/iq-combiner-5-data-sheet' },
  { id: 'enphase-iq-gateway',
    url: 'https://enphase.com/sites/default/files/2021-07/IQ-Envoy-DS-EN-US-06-30-2021.pdf' },
  { id: 'enphase-iq-system-controller-3',
    url: 'https://enphase.com/download/iq-system-controller-3m-data-sheet' },
  { id: 'enphase-iq-sc3-ats',
    url: 'https://enphase.com/download/iq-system-controller-3m-data-sheet',
    note: 'Shared datasheet with IQ System Controller 3' },
  { id: 'enphase-iq-ev-charger',
    url: 'https://enphase.com/download/iq-ev-charger-2-data-sheet' },

  // SolarEdge (Krannich mirror — SolarEdge CDN blocks anonymous requests)
  { id: 'solaredge-home-hub-7600',
    url: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/SolarEdge/se-home-hub-inverter-single-phase-inverter-made-in-usa-datasheet-nam.pdf',
    note: 'Shared Home Hub single-phase datasheet (covers 7600 & 10000)' },
  { id: 'solaredge-home-hub-10000',
    url: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/SolarEdge/se-home-hub-inverter-single-phase-inverter-made-in-usa-datasheet-nam.pdf',
    note: 'Shared Home Hub single-phase datasheet (covers 7600 & 10000)' },
  { id: 'solaredge-home-battery-10',
    url: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Inverters/SolarEdge/se-solaredge-home-battery-made-in-the-usa-datasheet-nam.pdf' },

  // APsystems
  { id: 'apsystems-ecu-r',
    url: 'https://global.apsystems.com/wp-content/uploads/2022/09/APsystems-Energy-Communication-Unit-ECU-R-datasheet_Rev3.4_2022-08-30.pdf' },

  // Hoymiles (NAZ distributor mirror — Hoymiles gates direct downloads)
  { id: 'hoymiles-dtu-pro-s',
    url: 'https://www.solar-electric.com/lib/wind-sun/Hoymiles_Datasheet_DTU-Pro-S.pdf' },
];

let src = fs.readFileSync(FILE, 'utf8');
let added = 0;
let replaced = 0;
let failed = 0;
const failures: string[] = [];

for (const { id, url, note } of DATASHEETS) {
  const idNeedle = `id: '${id}'`;
  const idx = src.indexOf(idNeedle);
  if (idx === -1) {
    failures.push(`[NOT FOUND] ${id}`);
    failed++;
    continue;
  }

  // Grab a working window covering the whole row (up to ~1500 chars).
  const blockStart = idx;
  // Find the end of this row: locate the closing `},` that matches.
  // Simpler: grab next 1500 chars and ensure we land on a closing.
  const winLen = 1500;
  const window = src.slice(idx, idx + winLen);

  // Check if datasheetUrl already exists in the window.
  const dsExist = /datasheetUrl:\s*'[^']*'/.exec(window);
  if (dsExist) {
    // Replace the existing one (handles empty or stale URLs).
    const oldLine = dsExist[0];
    const newLine = `datasheetUrl: '${url}'`;
    if (oldLine === newLine) continue; // already correct
    const mutated = window.replace(oldLine, newLine);
    src = src.slice(0, blockStart) + mutated + src.slice(blockStart + winLen);
    replaced++;
    continue;
  }

  // Otherwise add a new datasheetUrl line. Insert before the row-closing `},`.
  // Find the first top-level closing of THIS row: scan for `\n  },` pattern.
  const closePattern = /\n  \},/;
  const closeMatch = window.match(closePattern);
  if (!closeMatch || closeMatch.index === undefined) {
    failures.push(`[NO ROW CLOSE] ${id}`);
    failed++;
    continue;
  }
  const closeIdxInWin = closeMatch.index;
  const indent = '    ';
  const noteLine = note ? `${indent}// v47.400 datasheet: ${note}\n` : '';
  const insertion = `\n${noteLine}${indent}datasheetUrl: '${url}',`;

  const before = window.slice(0, closeIdxInWin);
  const after  = window.slice(closeIdxInWin);
  const mutated = before + insertion + after;

  src = src.slice(0, blockStart) + mutated + src.slice(blockStart + winLen);
  added++;
}

fs.writeFileSync(FILE, src, 'utf8');

console.log(`Added new:  ${added}`);
console.log(`Replaced:   ${replaced}`);
console.log(`Failures:   ${failed}`);
if (failures.length) {
  for (const f of failures) console.log(`   ${f}`);
}
console.log(`Total:      ${added + replaced} / ${DATASHEETS.length}`);
console.log('Done.');