// ═══════════════════════════════════════════════════════════════════════════
// NEC PROVENANCE — WHICH JURISDICTIONS WERE AFFECTED BY THE LAUNDERING PATH?
//
//   npm run authority:audit-nec-provenance
//
// READ-ONLY. Changes nothing; generates the artifact that has to stand behind
// the "1,757 of 4,016" figure rather than the figure standing on its own.
//
// ── WHAT "AFFECTED" MEANS HERE ────────────────────────────────────────────
// The containment in c4f6b397 changed WHAT SOLARPRO CLAIMS about where the NEC
// edition came from. It deliberately did NOT change which edition is selected.
// So a row is AFFECTED when its attribution would have been wrong under the old
// classifier — not when its value moves.
//
// The old rule: any value on `compliance.jurisdiction.necVersion` was labelled
// `operator-entry` and published as "NEC <year> was entered for this project by
// the operator". The permit route itself populated that field with a hardcoded
// '2020' skeleton literal, so the label was false for every project that did not
// have a genuine operator entry — which is all of them, since SolarPro has no
// operator-attribution mechanism at all.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync } from 'node:fs';

const AN = await import('../lib/jurisdictions/ahj-national.ts');
const NV = await import('../lib/jurisdictions/necVersions.ts');
const rows = AN.AHJ_NATIONAL;

const norm = v => {
  const m = String(v ?? '').match(/(20\d{2})/);
  return m ? m[1] : null;
};

// The two producers that can supply an edition for a row today.
const stateEditionFor = r => {
  try { return norm(NV.getJurisdiction(r.stateCode, r.county ?? undefined, r.city ?? undefined)?.necVersion); }
  catch { return null; }
};

const out = [];
const tally = {};
const bump = k => { tally[k] = (tally[k] ?? 0) + 1; };

for (const r of rows) {
  const rowEdition = norm(r.necVersion);
  const stateEdition = stateEditionFor(r);
  // Every row is unprovenanced — 0/4,016 carry codeSourceUrl + codeRetrievedAtIso.
  const provenanced = !!(r.codeSourceUrl && r.codeRetrievedAtIso);

  // THE SKELETON LITERAL. The route injected '2020' whenever the client posted no
  // compliance.jurisdiction. That value then became `necFromEnriched`, won
  // precedence over the state table, and was labelled operator-entry.
  const SKELETON = '2020';

  let category, oldAttribution, actualOrigin, newClass, valueChanged = false;
  if (provenanced) {
    category = 'UNAFFECTED_GOVERNED';
    oldAttribution = 'ahj-registry-retrieval';
    actualOrigin = 'governed retrieval';
    newClass = 'ahj-registry-retrieval';
  } else {
    // Under the OLD path a skeleton-defaulted project reached codeAuthority with
    // necVersionEnriched = '2020' and was stamped operator-entry.
    category = 'FALSE_OPERATOR_ATTRIBUTION';
    oldAttribution = "operator-entry — \"was entered for this project by the operator\"";
    actualOrigin = 'route skeleton literal necVersion:\'2020\'';
    newClass = 'state-adoption-table (skeleton removed) or project-record-unprovenanced';
    // Did the SELECTED edition move? Only if the state table disagrees with the
    // skeleton, because the skeleton no longer wins.
    valueChanged = stateEdition !== null && stateEdition !== SKELETON;
    if (valueChanged) category = 'FALSE_OPERATOR_ATTRIBUTION_VALUE_ALSO_CORRECTED';
  }

  bump(category);
  out.push({
    jurisdictionId: r.id,
    jurisdictionName: r.ahjName,
    state: r.stateCode,
    rowNecValue: rowEdition ?? '',
    stateTableEdition: stateEdition ?? '',
    skeletonEdition: provenanced ? '' : '2020',
    oldAttribution,
    actualOrigin,
    newCanonicalSourceClass: newClass,
    valueChangedByContainment: valueChanged ? 'yes' : 'no',
    attributionChangedByContainment: provenanced ? 'no' : 'yes',
    category,
  });
}

const affected = out.filter(r => r.attributionChangedByContainment === 'yes');
const valueMoved = out.filter(r => r.valueChangedByContainment === 'yes');

mkdirSync('data/authority', { recursive: true });
const cols = Object.keys(out[0]);
writeFileSync('data/authority/nec-provenance-laundering.csv',
  [cols.join(','), ...out.map(r => cols.map(c => `"${String(r[c]).replace(/"/g, '""')}"`).join(','))].join('\n') + '\n');
writeFileSync('data/authority/nec-provenance-summary.json', JSON.stringify({
  totalJurisdictions: rows.length,
  affectedByAttribution: affected.length,
  unaffected: rows.length - affected.length,
  selectedValueAlsoMoved: valueMoved.length,
  categories: tally,
}, null, 2));

console.log('═══ NEC PROVENANCE LAUNDERING — reproducible proof ═══');
console.log(`TOTAL CURRENT JURISDICTIONS:            ${rows.length}`);
console.log(`AFFECTED BY NEC PROVENANCE-LAUNDERING:  ${affected.length}`);
console.log(`UNAFFECTED:                             ${rows.length - affected.length}`);
console.log(`SUM:                                    ${affected.length + (rows.length - affected.length)}`);
console.log('');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(48)} ${String(v).padStart(5)}`);
}
console.log(`  ${'CATEGORY SUM'.padEnd(48)} ${String(Object.values(tally).reduce((a, b) => a + b, 0)).padStart(5)}`);
console.log('');
console.log('── attribution vs value (§2: containment corrects attribution, not selection) ──');
console.log(`  attributions corrected : ${affected.length}`);
console.log(`  SELECTED EDITIONS MOVED: ${valueMoved.length}`
  + (valueMoved.length ? '   ⚠ these are rows where the state table disagrees with the removed skeleton' : ''));
console.log('');
console.log('artifacts: data/authority/nec-provenance-{laundering.csv,summary.json}');
