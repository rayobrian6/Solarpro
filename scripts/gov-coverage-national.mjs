// ═══════════════════════════════════════════════════════════════════════════
// NATIONAL COVERAGE — the government universe against SolarPro's registry.
//
//   npm run gov:coverage-national
//   npm run gov:coverage-national -- --report
//
// ── WHY THIS IS A DIFFERENT QUESTION FROM THE 4,016-ROW PROBE ─────────────
// The resolver dry-run asks "can the canonical resolver recover the registry we
// already have". That is a regression check, and it can only ever find problems
// in rows we hold. It is structurally incapable of telling us what is MISSING.
//
// This asks the opposite, and it is the one that matters for national release:
//
//     which legally relevant governments have NO permitting-authority record?
//
// ── THREE COVERAGES, NEVER ONE NUMBER ─────────────────────────────────────
//   LEGAL GOVERNMENT COVERAGE   do we know the government exists?
//   PERMITTING AUTHORITY COVERAGE  do we hold a record of who issues permits?
//   CODE AUTHORITY COVERAGE     do we hold governed evidence of adopted codes?
//
// They are different proofs and collapsing them is how "97% coverage" comes to
// mean nothing. A GEOID is not a permit office.
//
// ── THE DENOMINATOR IS DELIBERATELY NOT "ALL 39,093 GOVERNMENTS" ──────────
// Not every government issues building permits. Illinois has 1,427 active
// townships and they do not. Counting them as missing AHJs would invent a
// 96%-missing crisis out of a modelling error. So the denominator is the set of
// governments the DELEGATION POLICY actually points at for building permits —
// which is the honest national question.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'node:fs';

const REPORT = process.argv.includes('--report');

const U = await import('../lib/jurisdictions/legalGovernmentUniverse.ts');
const AN = await import('../lib/jurisdictions/ahj-national.ts');
const GI = await import('../lib/jurisdictions/legalGovernmentIdentity.ts');

const universe = U.loadUniverse();
const rows = AN.AHJ_NATIONAL;

// What the registry can answer for, by stable identity.
const held = new Map();
for (const r of rows) {
  if (!r.legalIdentity) continue;
  const k = GI.governmentKey(r.legalIdentity);
  held.set(k, [...(held.get(k) ?? []), r]);
}

/** Map a universe entity to the identity key the registry would use. */
const keyOf = e => e.placeGeoid ? `place:${e.placeGeoid}`
  : e.cousubGeoid ? `cousub:${e.cousubGeoid}`
  : e.countyFips ? `county:${e.countyFips}`
  : `state:${e.stateFips}`;

// ── WHICH GOVERNMENTS PLAUSIBLY ISSUE BUILDING PERMITS? ──────────────────
// ASK THE DELEGATION POLICY. Do not re-derive it.
//
// A first version of this script decided plausibility with its own heuristic
// ("towns count where the state has no county government"). That is a SECOND
// implementation of the one fact this campaign exists to single-source, and it
// immediately disagreed with the policy: Massachusetts retains 5 county
// governments, so the heuristic excluded all 293 MA towns — while the governed
// MA delegation rule says the TOWN administers. The coverage number would have
// under-reported New England by design.
//
// So plausibility is now read from `resolveDelegation`, per state, for both
// territory cases. If the policy changes, this follows automatically.
const DP = await import('../lib/jurisdictions/delegationPolicy.ts');
const policy = DP.baselinePolicy();

const STATE_CODE = new Map();
for (const e of universe) {
  if (e.entityKind === 'state') continue;
  if (!STATE_CODE.has(e.stateFips)) STATE_CODE.set(e.stateFips, e.stateFips);
}
// Which entity TYPE the policy names for each state and territory case.
const delegateFor = (stateCode, incorporated) =>
  DP.resolveDelegation(policy, { state: stateCode, scope: 'building', incorporated })?.rule.delegate ?? null;

const KIND_BY_DELEGATE = {
  place: ['incorporated-place', 'independent-city', 'consolidated-government'],
  county: ['county', 'county-equivalent', 'municipio', 'borough'],
  'county-subdivision': ['town', 'township', 'mcd'],
  state: ['state'],
  consolidated: ['consolidated-government'],
};

/** Build the set of plausible kinds per state FIPS, from the policy. */
const PLAUSIBLE_KINDS = new Map();
for (const fips of STATE_CODE.keys()) {
  // The policy is keyed by USPS code; the universe by FIPS. Resolve the USPS
  // code from any registry row in that state, falling back to '*' rules.
  const anyRow = rows.find(r => r.legalIdentity?.stateFips === fips);
  const usps = anyRow?.stateCode ?? '';
  const kinds = new Set();
  for (const inc of [true, false]) {
    const d = delegateFor(usps, inc);
    for (const k of (KIND_BY_DELEGATE[d] ?? [])) kinds.add(k);
  }
  PLAUSIBLE_KINDS.set(fips, kinds);
}

function isPlausibleBuildingAuthority(e) {
  if (!U.canHoldAuthority(e)) return false;
  const kinds = PLAUSIBLE_KINDS.get(e.stateFips);
  if (!kinds || !kinds.has(e.entityKind)) return false;
  // A county-level entity is only county-level when it is not also a place/MCD row.
  if (['county', 'county-equivalent', 'municipio', 'borough'].includes(e.entityKind)) {
    return !e.cousubGeoid && !e.placeGeoid;
  }
  return true;
}

const plausible = universe.filter(isPlausibleBuildingAuthority);

const byState = {};
let covered = 0;
const missingByKind = {};
for (const e of plausible) {
  const st = e.stateFips;
  const s = (byState[st] ??= { plausible: 0, covered: 0, missing: 0, byKind: {} });
  s.plausible++;
  const k = keyOf(e);
  if (held.has(k)) { covered++; s.covered++; }
  else {
    s.missing++;
    missingByKind[e.entityKind] = (missingByKind[e.entityKind] ?? 0) + 1;
    s.byKind[e.entityKind] = (s.byKind[e.entityKind] ?? 0) + 1;
  }
}

// ── permitting-authority + code-authority coverage of what we DO hold ────
const HELPER_DEFAULT_AUTHORITY = 'Local Building Department';
const withRealAuthority = rows.filter(r => String(r.permitAuthority ?? '').trim() !== HELPER_DEFAULT_AUTHORITY);
const withCodeEvidence = rows.filter(r => r.codeSourceUrl && r.codeRetrievedAtIso);

console.log('═══ NATIONAL COVERAGE — universe vs registry ═══');
console.log(`universe entities        ${universe.length}`);
console.log(`  active governments     ${universe.filter(U.canHoldAuthority).length}`);
console.log(`  statistical only       ${universe.filter(U.isStatisticalOnly).length}`);
console.log(`registry rows            ${rows.length}`);
console.log(`  with legal identity    ${[...held.values()].reduce((a, b) => a + b.length, 0)}`);
console.log('');
console.log('── LEGAL GOVERNMENT COVERAGE ──');
console.log(`  plausible building authorities nationally : ${plausible.length}`);
console.log(`  of those, SolarPro holds a record for     : ${covered}   (${((covered / plausible.length) * 100).toFixed(2)}%)`);
console.log(`  MISSING                                   : ${plausible.length - covered}`);
console.log('');
console.log('  missing by government kind:');
for (const [k, v] of Object.entries(missingByKind).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(28)} ${String(v).padStart(6)}`);
}
console.log('');
console.log('── PERMITTING AUTHORITY COVERAGE (of rows we hold) ──');
console.log(`  naming a specific permit authority : ${withRealAuthority.length} / ${rows.length}`);
console.log(`  carrying the helper placeholder    : ${rows.length - withRealAuthority.length}`);
console.log('');
console.log('── CODE AUTHORITY COVERAGE (of rows we hold) ──');
console.log(`  with adoption source + retrieval date : ${withCodeEvidence.length} / ${rows.length}`);
console.log('');
console.log('── WORST-COVERED STATES (missing plausible authorities) ──');
const worst = Object.entries(byState).sort((a, b) => b[1].missing - a[1].missing).slice(0, 12);
for (const [st, v] of worst) {
  const kinds = Object.entries(v.byKind).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`).join(' ');
  console.log(`  ${st}  ${String(v.covered).padStart(4)}/${String(v.plausible).padEnd(6)} missing ${String(v.missing).padStart(5)}   ${kinds}`);
}

if (REPORT) {
  writeFileSync('data/census/national-coverage-report.json', JSON.stringify({
    universeEntities: universe.length,
    activeGovernments: universe.filter(U.canHoldAuthority).length,
    registryRows: rows.length,
    plausibleBuildingAuthorities: plausible.length,
    covered, missing: plausible.length - covered,
    missingByKind, byState,
    permittingAuthorityNamed: withRealAuthority.length,
    codeAuthorityEvidenced: withCodeEvidence.length,
  }, null, 2));
  console.log('');
  console.log('report written: data/census/national-coverage-report.json');
}
