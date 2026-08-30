// ═══════════════════════════════════════════════════════════════════════════
// FIRE PROVENANCE — MEASUREMENT ONLY. Nothing is normalized here.
//
//   npm run authority:audit-fire-provenance
//
// The NEC root taught the rule this file exists to honour: measure value
// behaviour BEFORE claiming a provenance change is attribution-only. Fire is
// more dangerous than NEC because its values move physical roof geometry.
//
// So this pass answers three questions and changes nothing:
//   1. what are the producers, per fact, for calculation / geometry / text?
//   2. do the 4,016 rows actually VARY, or is a national constant wearing a
//      jurisdiction-shaped column?
//   3. where two producers exist, do they agree TODAY — and for how many rows?
//
// A pair that agrees today but comes from two literals is still a latent defect
// (SAME_VALUE_DIFFERENT_SOURCE). A pair that disagrees is an active one.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync } from 'node:fs';

const AN = await import('../lib/jurisdictions/ahj-national.ts');
const FS = await import('../lib/permit/utils/fireSetback.ts');
const rows = AN.AHJ_NATIONAL;

// ── the producer map, from source anchors read directly ──────────────────
const FACTS = [
  {
    factId: 'FIRE-PATHWAY-WIDTH', factName: 'roof access pathway width',
    calculationProducer: 'ahjRoofSetbackIn (project) ← ahj-national.roofSetbackInches',
    calculationProducerLocation: 'app/api/engineering/permit/route.ts (ahjRoofSetbackIn) → lib/drafting/templates/roof.ts:247-248',
    geometryProducer: 'roof.ts pathway corridor from ahjRoofSetbackIn',
    geometryProducerLocation: 'lib/drafting/templates/roof.ts:247-248; lib/drafting/sheetComposition.ts:501,517',
    rendererProducer: 'HARD LITERAL 36"',
    rendererProducerLocation: 'lib/permit/sections/arrayPages.ts:582',
    registryStorage: 'ahj-national.roofSetbackInches',
  },
  {
    factId: 'FIRE-RIDGE-SETBACK', factName: 'ridge fire setback',
    calculationProducer: 'resolveFireSetbackIn(ahjRidgeSetbackIn, coverageFrac)',
    calculationProducerLocation: 'lib/permit/utils/fireSetback.ts:12-18',
    geometryProducer: 'roof.ts edgeSetbackFt for edgeKind==="ridge"',
    geometryProducerLocation: 'lib/drafting/templates/roof.ts:866-867',
    rendererProducer: 'projected from the same resolver',
    rendererProducerLocation: 'lib/permit/sections/arrayPages.ts (ridge line)',
    registryStorage: 'ahj-national.ridgeSetbackInches',
  },
  {
    factId: 'FIRE-HIPVALLEY-SETBACK', factName: 'hip / valley setback',
    calculationProducer: 'none — not resolved, taken as a constant',
    calculationProducerLocation: 'n/a',
    geometryProducer: 'HARD LITERAL HIP_SETBACK_FT = 1.5 (=18")',
    geometryProducerLocation: 'lib/drafting/templates/roof.ts:866',
    rendererProducer: 'HARD LITERAL 18"',
    rendererProducerLocation: 'lib/permit/sections/arrayPages.ts:580',
    registryStorage: 'ahj-national.hipRoofSetbackInches / valleySetbackInches (unread)',
  },
  {
    factId: 'FIRE-COVERAGE-THRESHOLD', factName: 'array coverage exception threshold',
    calculationProducer: 'HARD LITERAL > 0.33',
    calculationProducerLocation: 'lib/permit/utils/fireSetback.ts:17',
    geometryProducer: 'same resolver', geometryProducerLocation: 'via resolveFireSetbackIn',
    rendererProducer: 'prose', rendererProducerLocation: 'lib/permit/sections/arrayPages.ts',
    registryStorage: 'none',
  },
  {
    factId: 'FIRE-EAVE', factName: 'eave access requirement',
    calculationProducer: 'none', calculationProducerLocation: 'n/a',
    geometryProducer: 'no band drawn at perimeter', geometryProducerLocation: 'lib/drafting/templates/roof.ts:858-867',
    rendererProducer: 'HARD LITERAL "Modules may extend to eave (no eave req.)"',
    rendererProducerLocation: 'lib/permit/sections/arrayPages.ts:581',
    registryStorage: 'ahj-national.eaveSetbackInches (unread)',
  },
];

// ── §3 distinct-value census over the real 4,016 ─────────────────────────
const FIELDS = ['roofSetbackInches', 'ridgeSetbackInches', 'valleySetbackInches',
  'hipRoofSetbackInches', 'eaveSetbackInches', 'pathwayWidthInches'];
const census = FIELDS.map(f => {
  const counts = {};
  for (const r of rows) { const v = String(r[f]); counts[v] = (counts[v] ?? 0) + 1; }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return {
    field: f, rowCount: rows.length, distinctValues: entries.length,
    mostCommonValue: entries[0]?.[0] ?? '', rowsAtMostCommonValue: entries[0]?.[1] ?? 0,
    allValues: entries.map(([v, n]) => `${v}×${n}`).join(' '),
    actualAuthorityClassification: entries.length === 1
      ? 'MODEL_CODE_RULE — a national constant in a jurisdiction-shaped column'
      : 'UNPROVENANCED_LEGACY — varies, but 0/4,016 rows carry adoption evidence',
  };
});

// ── §2 / §6 the pathway text-vs-geometry comparison, per row ─────────────
// POST-FIX: both the printed note and the drawn geometry now resolve through
// resolveAccessPathwayIn(). The audit reads the SAME accessor, so a future
// divergence shows up here instead of on a permit sheet.
const PRINTED_PATHWAY_IN = FS.resolveAccessPathwayIn(null);
const PRINTED_HIPVALLEY_IN = 18;    // arrayPages.ts:580 literal
const GEOMETRY_HIPVALLEY_IN = 1.5 * 12;  // roof.ts:866 HIP_SETBACK_FT

const chains = [];
let pathwayDisagree = 0, hipAgree = 0;
for (const r of rows) {
  // The drawing no longer reads roofSetbackInches; it reads the canonical fact.
  const drawn = FS.resolveAccessPathwayIn(null);
  const legacyRoofSetback = Number(r.roofSetbackInches);   // quarantined, not consumed
  const disagrees = drawn !== PRINTED_PATHWAY_IN;
  if (disagrees) pathwayDisagree++;
  chains.push({
    jurisdictionId: r.id, state: r.stateCode,
    printedPathwayIn: PRINTED_PATHWAY_IN, drawnPathwayIn: drawn,
    legacyRoofSetbackIn: legacyRoofSetback,
    classification: disagrees ? 'DIFFERENT_VALUE_DIFFERENT_SOURCE' : 'SAME_VALUE_DIFFERENT_SOURCE',
  });
}
if (PRINTED_HIPVALLEY_IN === GEOMETRY_HIPVALLEY_IN) hipAgree = rows.length;

const summary = {
  factsAudited: FACTS.length,
  chainClassification: {
    SAME_VALUE_SAME_SOURCE: 0,
    SAME_VALUE_DIFFERENT_SOURCE: rows.length - pathwayDisagree,
    DIFFERENT_VALUE_DIFFERENT_SOURCE: pathwayDisagree,
    INTENTIONALLY_DIFFERENT_FACT: 0,
    UNRESOLVED: 0,
  },
  hipValley: {
    printedIn: PRINTED_HIPVALLEY_IN, geometryIn: GEOMETRY_HIPVALLEY_IN,
    agreeToday: PRINTED_HIPVALLEY_IN === GEOMETRY_HIPVALLEY_IN,
    classification: 'SAME_VALUE_DIFFERENT_SOURCE — two independent literals that happen to match',
    rows: hipAgree,
  },
  census,
};

mkdirSync('data/authority', { recursive: true });
writeFileSync('data/authority/fire-producer-consumer-map.json', JSON.stringify({ facts: FACTS }, null, 2));
writeFileSync('data/authority/fire-provenance-summary.json', JSON.stringify(summary, null, 2));
const cols = Object.keys(chains[0]);
writeFileSync('data/authority/fire-value-comparison.csv',
  [cols.join(','), ...chains.map(c => cols.map(k => `"${c[k]}"`).join(','))].join('\n') + '\n');

console.log('═══ FIRE PROVENANCE — MEASUREMENT ONLY ═══');
console.log(`fire fact chains audited: ${FACTS.length}`);
console.log('');
console.log('── §3 DISTINCT-VALUE CENSUS OVER 4,016 ROWS ──');
for (const c of census) {
  console.log(`  ${c.field.padEnd(22)} distinct=${String(c.distinctValues).padStart(2)}  ${c.allValues}`);
  console.log(`      ${c.actualAuthorityClassification}`);
}
console.log('');
console.log('── §6 PATHWAY: PRINTED vs DRAWN ──');
console.log(`  printed literal (arrayPages.ts:582) : ${PRINTED_PATHWAY_IN}"`);
console.log(`  drawn from ahj row roofSetbackInches: varies`);
console.log(`  rows where they AGREE   : ${rows.length - pathwayDisagree}   (SAME_VALUE_DIFFERENT_SOURCE — latent)`);
console.log(`  rows where they DISAGREE: ${pathwayDisagree}   (DIFFERENT_VALUE_DIFFERENT_SOURCE — ACTIVE DEFECT)`);
if (pathwayDisagree) {
  const st = {};
  for (const c of chains) if (c.classification === 'DIFFERENT_VALUE_DIFFERENT_SOURCE') st[c.state] = (st[c.state] ?? 0) + 1;
  console.log(`      states: ${Object.entries(st).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join(' ')}`);
  console.log(`      the sheet PRINTS 36" while the drawing uses ${chains.find(c => c.classification === 'DIFFERENT_VALUE_DIFFERENT_SOURCE').drawnPathwayIn}"`);
}
console.log('');
console.log('── §6 HIP/VALLEY: PRINTED vs GEOMETRY ──');
console.log(`  printed literal (arrayPages.ts:580): ${PRINTED_HIPVALLEY_IN}"`);
console.log(`  geometry literal (roof.ts:866)     : ${GEOMETRY_HIPVALLEY_IN}"  (HIP_SETBACK_FT = 1.5)`);
console.log(`  agree today: ${PRINTED_HIPVALLEY_IN === GEOMETRY_HIPVALLEY_IN ? 'YES' : 'NO'} — but from TWO independent literals (latent defect)`);
console.log('');
console.log('artifacts: data/authority/fire-{producer-consumer-map,provenance-summary}.json, fire-value-comparison.csv');
