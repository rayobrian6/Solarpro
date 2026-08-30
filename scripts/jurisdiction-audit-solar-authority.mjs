// ═══════════════════════════════════════════════════════════════════════════
// WHAT DOES SOLARPRO ACTUALLY KNOW ABOUT THE 4,016 JURISDICTIONS IT HOLDS?
//
//   npm run jurisdiction:audit-solar-authority
//   npm run jurisdiction:audit-solar-authority -- --report
//
// A jurisdiction identity is not a permit requirement. A code citation is not
// an adoption record. A model-code default is not an AHJ rule. This counts, per
// domain, how many of the 4,016 rows carry data that is GOVERNED — meaning the
// jurisdiction itself established it and we can cite where and when — versus
// data that is a statewide value, a model-code default, a helper placeholder or
// nothing at all.
//
// ── THE GRADING RULE ──────────────────────────────────────────────────────
// GOVERNED_JURISDICTION_SPECIFIC requires ALL of:
//   a value · attributable to THIS jurisdiction · an official source we can
//   cite · a retrieval date.
// Anything else is graded honestly below it. A value that is merely PRESENT is
// not governed: the `ahj()` helper fills most fields with national defaults, so
// presence proves only that a default exists.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync } from 'node:fs';

const REPORT = process.argv.includes('--report');

const AN = await import('../lib/jurisdictions/ahj-national.ts');
const rows = AN.AHJ_NATIONAL;

// The `ahj()` helper's own defaults — a field equal to its default was never
// supplied for this jurisdiction.
const HELPER_DEFAULTS = {
  permitAuthority: 'Local Building Department',
  inspectionAuthority: 'Local Building Inspector',
  typicalPermitFee: '$150–$500',
  feeStructure: 'Flat fee or valuation-based',
  rapidShutdownStandard: 'NEC 690.12',
  typicalPlanCheckDays: 10,
  typicalPermitDays: 15,
  interconnectionProgram: 'Net Metering',
  interconnectionDays: 30,
  windSpeedMph: 115,
  groundSnowLoadPsf: 0,
  seismicDesignCategory: 'B',
  pathwayWidthInches: 36,
  ridgeSetbackInches: 18,
  valleySetbackInches: 18,
  eaveSetbackInches: 0,
  hipRoofSetbackInches: 18,
  roofSetbackInches: 36,
};
const DEFAULT_PLANSET_REQS = [
  'Site plan with module layout', 'Single-line diagram (NEC compliant)',
  'Equipment cut sheets', 'Structural calculations', 'Electrical calculations',
];

const has = v => v !== undefined && v !== null && String(v).trim() !== '';
const isDefault = (r, f) => r[f] === HELPER_DEFAULTS[f];
const notDefault = (r, f) => has(r[f]) && !isDefault(r, f);

/** A fact is GOVERNED only with an official source AND a retrieval date. The
 *  AHJ table has exactly one such pair of columns, and it is code-specific. */
const hasProvenance = r => has(r.codeSourceUrl) && has(r.codeRetrievedAtIso);

const DOMAINS = [
  // ── authorities by scope ────────────────────────────────────────────────
  ['PERMIT DEPARTMENT', r => notDefault(r, 'permitAuthority') && hasProvenance(r)],
  ['BUILDING AUTHORITY SCOPE', () => false],      // no per-scope field exists
  ['ELECTRICAL AUTHORITY SCOPE', () => false],
  ['FIRE AUTHORITY SCOPE', () => false],
  ['ZONING AUTHORITY SCOPE', () => false],
  // ── professional ────────────────────────────────────────────────────────
  ['PE/STAMP REQUIREMENT', () => false],          // no field on AhjRecord
  ['STRUCTURAL-REVIEW REQUIREMENT', () => false],
  // ── code adoption ───────────────────────────────────────────────────────
  ['NEC ADOPTION', r => has(r.necVersion) && hasProvenance(r)],
  ['IBC ADOPTION', r => has(r.ibcVersion) && hasProvenance(r)],
  ['IRC ADOPTION', r => has(r.ircVersion) && hasProvenance(r)],
  ['IFC ADOPTION', r => has(r.ifcVersion) && hasProvenance(r)],
  // ── amendments ──────────────────────────────────────────────────────────
  ['LOCAL ELECTRICAL AMENDMENTS', r => (r.localAmendments ?? []).length > 0 && hasProvenance(r)],
  ['LOCAL BUILDING AMENDMENTS', r => (r.localAmendments ?? []).length > 0 && hasProvenance(r)],
  ['LOCAL FIRE AMENDMENTS', r => (r.localAmendments ?? []).length > 0 && hasProvenance(r)],
  // ── fire ────────────────────────────────────────────────────────────────
  ['FIRE ACCESS / PATHWAY RULE', r => notDefault(r, 'pathwayWidthInches') && hasProvenance(r)],
  ['RIDGE SETBACK', r => notDefault(r, 'ridgeSetbackInches') && hasProvenance(r)],
  ['HIP/VALLEY SETBACK', r => (notDefault(r, 'hipRoofSetbackInches') || notDefault(r, 'valleySetbackInches')) && hasProvenance(r)],
  // ── electrical local rules ──────────────────────────────────────────────
  ['WIRING-METHOD AUTHORITY', () => false],       // no field on AhjRecord
  ['DISCONNECT REQUIREMENT', () => false],
  ['INTERCONNECTION / TAP RULE', () => false],
  ['LOCAL LABELING REQUIREMENTS', () => false],
  // ── administrative ──────────────────────────────────────────────────────
  ['SUBMISSION REQUIREMENTS', r => {
    const p = r.planSetRequirements ?? [];
    const custom = p.length > 0 && JSON.stringify(p) !== JSON.stringify(DEFAULT_PLANSET_REQS);
    return custom && hasProvenance(r);
  }],
  ['INSPECTION REQUIREMENTS', r => notDefault(r, 'inspectionAuthority') && hasProvenance(r)],
];

const counts = DOMAINS.map(([name, pred]) => [name, rows.filter(pred).length]);

// ── FULL SOLAR REQUIREMENT PROFILE (§15) ─────────────────────────────────
const fullProfile = rows.filter(r =>
  r.legalIdentity
  && notDefault(r, 'permitAuthority')
  && has(r.necVersion) && has(r.ibcVersion) && has(r.ifcVersion)
  && hasProvenance(r));

// ── SOURCE DISTRIBUTION (§5) — where does each planset-critical fact come from?
function necSource(r) {
  if (hasProvenance(r) && has(r.necVersion)) return 'jurisdiction-governed';
  if (has(r.necVersion)) return r.dataProvenance === 'curated'
    ? 'unprovenanced curated row' : 'unprovenanced bulk-expansion row';
  return 'unknown';
}
function fireSource(r) {
  const anyCustom = ['pathwayWidthInches', 'ridgeSetbackInches', 'valleySetbackInches',
    'hipRoofSetbackInches', 'roofSetbackInches'].some(f => notDefault(r, f));
  if (anyCustom && hasProvenance(r)) return 'jurisdiction-governed';
  if (anyCustom) return 'unprovenanced row value (set by applyCodeBasis or the row)';
  return 'model-code default from the ahj() helper';
}
function deptSource(r) {
  if (notDefault(r, 'permitAuthority') && hasProvenance(r)) return 'jurisdiction-governed';
  if (notDefault(r, 'permitAuthority')) return 'unprovenanced value';
  return 'helper placeholder ("Local Building Department")';
}
const dist = (fn) => {
  const d = {};
  for (const r of rows) { const k = fn(r); d[k] = (d[k] ?? 0) + 1; }
  return d;
};

console.log('═══ SOLAR AUTHORITY COVERAGE — the 4,016 SolarPro already holds ═══');
console.log(`CURRENT JURISDICTIONS AUDITED: ${rows.length}`);
console.log('');
console.log('── GOVERNED (value + attributable to this jurisdiction + source + retrieval date) ──');
for (const [name, n] of counts) {
  console.log(`  ${name.padEnd(34)} ${String(n).padStart(6)}`);
}
console.log('');
console.log(`  ${'FULL SOLAR REQUIREMENT PROFILES'.padEnd(34)} ${String(fullProfile.length).padStart(6)}`);
console.log('');
console.log('── SOURCE DISTRIBUTION ──');
console.log('NEC EDITION');
for (const [k, v] of Object.entries(dist(necSource))) console.log(`  ${k.padEnd(46)} ${String(v).padStart(5)}`);
console.log('FIRE SETBACKS / PATHWAYS');
for (const [k, v] of Object.entries(dist(fireSource))) console.log(`  ${k.padEnd(46)} ${String(v).padStart(5)}`);
console.log('PERMIT DEPARTMENT');
for (const [k, v] of Object.entries(dist(deptSource))) console.log(`  ${k.padEnd(46)} ${String(v).padStart(5)}`);
console.log('');
console.log('── FIELDS THE SHAPE CANNOT EVEN REPRESENT ──');
const shapeKeys = new Set();
for (const r of rows) for (const k of Object.keys(r)) shapeKeys.add(k);
for (const need of ['peStampRequired', 'structuralReviewRequired', 'wiringMethods',
  'disconnectRequirements', 'labelingRequirements', 'buildingAuthority', 'electricalAuthority',
  'fireAuthority', 'zoningAuthority', 'submissionForms', 'inspectionStages']) {
  console.log(`  ${need.padEnd(30)} ${shapeKeys.has(need) ? 'present' : 'ABSENT FROM AhjRecord'}`);
}

if (REPORT) {
  mkdirSync('data/authority', { recursive: true });
  const unprov = rows.filter(r => !hasProvenance(r)).map(r => ({
    id: r.id, state: r.stateCode, name: r.ahjName,
    necVersion: r.necVersion ?? '', hasIdentity: !!r.legalIdentity,
    permitAuthority: r.permitAuthority ?? '',
    why: 'no codeSourceUrl + codeRetrievedAtIso — every value on this row is unprovenanced',
  }));
  const csv = (list) => {
    const cols = Object.keys(list[0]);
    return [cols.join(','), ...list.map(r => cols.map(c => `"${String(r[c]).replace(/"/g, '""')}"`).join(','))].join('\n') + '\n';
  };
  writeFileSync('data/authority/unprovenanced-solar-facts.csv', csv(unprov));
  writeFileSync('data/authority/jurisdiction-solar-coverage.json', JSON.stringify({
    auditedRows: rows.length,
    governedByDomain: Object.fromEntries(counts),
    fullSolarRequirementProfiles: fullProfile.length,
    sourceDistribution: { nec: dist(necSource), fire: dist(fireSource), permitDepartment: dist(deptSource) },
    unprovenancedRows: unprov.length,
  }, null, 2));
  console.log('');
  console.log(`artifacts: data/authority/{jurisdiction-solar-coverage.json,unprovenanced-solar-facts.csv}`);
  console.log(`unprovenanced rows: ${unprov.length} / ${rows.length}`);
}
