// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL vs LEGACY AHJ RESOLVER — DRY RUN, NOTHING IS WIRED.
//
//   npm run ahj:resolver-dryrun
//   npm run ahj:resolver-dryrun -- --report
//
// Answers ONE operational question before N8 is wired:
//   if the canonical resolver replaced the legacy one today, which projects
//   would change, and would any lose their AHJ?
//
// ── WHAT THIS CORPUS IS, AND WHAT IT IS NOT ───────────────────────────────
// There is no corpus of real customer projects available offline, so the corpus
// is SYNTHESISED FROM THE REGISTRY ITSELF: one probe per row, whose legal
// geography is what the Census would report for a parcel inside that
// jurisdiction. That covers all 4,016 jurisdictions we hold — far broader than
// the handful of fixtures — but it has a specific and important limit:
//
//   The geography is derived FROM the row, so this measures "can the canonical
//   resolver find the row we already believe is correct". It does NOT test
//   whether that row is the right answer for a real parcel. Boundary truth for a
//   real address comes only from a live geocode.
//
// So this is a REGRESSION probe, not a correctness proof. Its job is to catch
// mass unresolution before wiring, and it is reported as such. The real-address
// cases are checked separately, against live boundary evidence.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'node:fs';

const REPORT = process.argv.includes('--report');

import { readFileSync } from 'node:fs';

// Authoritative county FIPS, so the simulated geography is as complete as the
// GEOCODER would make it in production. This matters: a registry row lacking a
// bound identity does not make the PARCEL's geography unknown — the Census still
// returns its state and county. Without this the probe reports BOUNDARY_UNRESOLVED
// (geography incomplete) where production would report
// BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING (geography fine, registry has no row),
// and those are different pieces of work.
const COUNTY_FIPS = new Map();
{
  const txt = readFileSync(new URL('../data/census/national_county2020.txt', import.meta.url), 'utf8');
  const lines = txt.split('\n').filter(Boolean);
  const hdr = lines[0].split('|');
  for (const ln of lines.slice(1)) {
    const r = Object.fromEntries(ln.split('|').map((v, i) => [hdr[i], v]));
    const key = r.STATE + '|' + r.COUNTYNAME.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[.'’]/g, '').replace(/\s+(county|parish|borough|census area|municipality|municipio|city and borough)$/, '').trim();
    if (!COUNTY_FIPS.has(key)) COUNTY_FIPS.set(key, r.STATEFP + r.COUNTYFP);
  }
}
const countyFipsFor = (state, county) => COUNTY_FIPS.get(
  state + '|' + String(county ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’]/g, '').replace(/\s+county$/, '').trim()) ?? null;

const AN = await import('../lib/jurisdictions/ahj-national.ts');
const LG = await import('../lib/jurisdictions/legalGeography.ts');
const DP = await import('../lib/jurisdictions/delegationPolicy.ts');
const AA = await import('../lib/jurisdictions/ahjAuthority.ts');
const RL = await import('../lib/jurisdictions/ahjRegistryLookup.ts');
const CA = await import('../lib/permit/snapshot/codeAuthority.ts');

const { AHJ_NATIONAL } = AN;
const registry = RL.createAhjNationalLookup();
const policy = DP.baselinePolicy();
const PROV = { source: 'census-tiger', retrievedAtIso: '2026-08-30T00:00:00Z' };

/** The legal geography the Census would report for a parcel inside this row's
 *  jurisdiction. Built from the row's OWN identity — see the header caveat. */
function geographyFor(row) {
  const li = row.legalIdentity;
  // State + county come from the GEOCODER in production, not from our row, so
  // they are populated even when the row itself has no bound identity.
  const cFips = li?.countyFips ?? countyFipsFor(row.stateCode, row.county);
  const stateFips = li?.stateFips ?? (cFips ? cFips.slice(0, 2) : null);
  const g = {
    ...LG.emptyLegalGeography(),
    coordinate: LG.facet({ lat: 1, lng: 2 }, 'VERIFIED', 'geocoded', PROV),
    state: LG.facet({ code: row.stateCode, fips: stateFips, name: row.stateName }, 'VERIFIED', 'census', PROV),
    county: LG.facet(
      { name: row.county, fips: cFips },
      cFips ? 'VERIFIED' : 'UNKNOWN', 'census', PROV),
  };
  const isCountyRow = row.ahjType === 'county' || String(row.city).toLowerCase() === 'unincorporated';
  // The geocoder always returns the county subdivision, so the probe must too —
  // otherwise the New England rules (which delegate to the TOWN) are starved of
  // the entity they name and report AUTHORITY_SCOPE_UNRESOLVED for the wrong
  // reason. A synthetic MCD stands in; the probe is testing DELEGATION here, not
  // which particular town.
  g.countySubdivision = cFips
    ? LG.facet({ name: `${row.county} township`, geoid: `${cFips}99999` }, 'VERIFIED', 'census', PROV)
    : LG.unknownFacet();
  g.incorporatedPlace = isCountyRow
    // Proven OUTSIDE every incorporated place — a real determination, not a null.
    ? LG.facet(null, 'VERIFIED', 'no incorporated place contains this coordinate', PROV)
    : LG.facet({ name: row.city, geoid: li?.placeGeoid ?? null }, 'VERIFIED', `inside ${row.city}`, PROV);
  return LG.deriveBoundaryFacets(g);
}

const rows = [];
const tally = {};
const bump = k => { tally[k] = (tally[k] ?? 0) + 1; };

for (const row of AHJ_NATIONAL) {
  const isCountyRow = row.ahjType === 'county' || String(row.city).toLowerCase() === 'unincorporated';
  const geo = geographyFor(row);

  // ── LEGACY: the function production binds with today ────────────────────
  const legacy = CA.resolveAhjRecordTraced({
    stateCode: row.stateCode,
    county: row.county,
    city: isCountyRow ? null : row.city,
    address: null,
    boundary: {
      resolved: true,
      unincorporated: isCountyRow,
      incorporatedPlace: isCountyRow ? null : row.city,
    },
  });

  // ── CANONICAL: geography -> delegation -> entity -> registry by identity ─
  const canonical = AA.resolveScopeAuthority('building', geo, policy, registry);

  const legacyId = legacy.record?.id ?? null;
  const canonicalId = canonical.ahjRecordId ?? null;

  let category;
  if (canonicalId && legacyId && canonicalId === legacyId) category = 'SAME_RESULT';
  // Checked BEFORE the missing-record branch: when the delegation policy names a
  // TOWN and the registry row claims the COUNTY, the row cannot be the authority
  // for this parcel in the first place. Reporting that as "record missing" would
  // hide the actual finding, which is that the row asserts a county building
  // department in a state whose counties are not governments.
  else if (canonical.entity?.type === 'county-subdivision' && isCountyRow) {
    category = 'ROW_IS_NOT_THE_AUTHORITY';
  }
  else if (canonical.status === 'BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING') {
    category = row.legalIdentity ? 'MISSING_IDENTITY_IN_REGISTRY' : 'MISSING_IDENTITY';
  } else if (canonical.status === 'AUTHORITY_SCOPE_UNRESOLVED' || canonical.status === 'BOUNDARY_UNRESOLVED') {
    category = 'DELEGATION_UNKNOWN';

  } else if (canonicalId && !legacyId) category = 'EXPECTED_CORRECTION';
  else if (canonicalId && legacyId && canonicalId !== legacyId) {
    // Both bound, but to different rows. If they resolve to the same GOVERNMENT
    // it is a duplicate-row choice, not a change of authority.
    const a = AHJ_NATIONAL.find(r => r.id === canonicalId);
    const b = AHJ_NATIONAL.find(r => r.id === legacyId);
    const sameGov = a?.legalIdentity && b?.legalIdentity
      && JSON.stringify([a.legalIdentity.placeGeoid, a.legalIdentity.countyFips])
       === JSON.stringify([b.legalIdentity.placeGeoid, b.legalIdentity.countyFips]);
    category = sameGov ? 'SAME_GOVERNMENT_DIFFERENT_ROW' : 'DIFFERENT_AUTHORITY';
  } else category = 'REGRESSION';

  bump(category);
  if (category !== 'SAME_RESULT') {
    rows.push({
      id: row.id, state: row.stateCode, county: row.county, city: row.city,
      hasIdentity: !!row.legalIdentity,
      legacy: legacyId, legacyMethod: legacy.matchMethod,
      canonical: canonicalId, canonicalStatus: canonical.status,
      category, basis: canonical.basis?.slice(0, 180) ?? null,
    });
  }
}

console.log('═══ CANONICAL vs LEGACY — DRY RUN (nothing wired) ═══');
console.log(`corpus: ${AHJ_NATIONAL.length} synthetic probes, one per registry jurisdiction`);
console.log('');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  const pct = ((v / AHJ_NATIONAL.length) * 100).toFixed(2);
  console.log(`  ${k.padEnd(32)} ${String(v).padStart(5)}  ${pct.padStart(6)}%`);
}
console.log('');
const same = tally.SAME_RESULT ?? 0;
console.log(`AGREEMENT: ${same} / ${AHJ_NATIONAL.length} (${((same / AHJ_NATIONAL.length) * 100).toFixed(2)}%)`);
const wouldLose = (tally.MISSING_IDENTITY ?? 0) + (tally.MISSING_IDENTITY_IN_REGISTRY ?? 0)
  + (tally.DELEGATION_UNKNOWN ?? 0) + (tally.REGRESSION ?? 0);
console.log(`WOULD LOSE THEIR AHJ IF WIRED TODAY: ${wouldLose}`
  + `  (${((wouldLose / AHJ_NATIONAL.length) * 100).toFixed(2)}%)`);
console.log('');

for (const cat of ['REGRESSION', 'DIFFERENT_AUTHORITY', 'DELEGATION_UNKNOWN',
  'MISSING_IDENTITY', 'MISSING_IDENTITY_IN_REGISTRY', 'SAME_GOVERNMENT_DIFFERENT_ROW', 'EXPECTED_CORRECTION']) {
  const ex = rows.filter(r => r.category === cat);
  if (!ex.length) continue;
  console.log(`── ${cat} (${ex.length}) ──`);
  for (const r of ex.slice(0, 6)) {
    console.log(`   ${r.state} ${r.id.padEnd(40)} legacy=${String(r.legacy).padEnd(28)} canonical=${r.canonical ?? r.canonicalStatus}`);
  }
  if (ex.length > 6) console.log(`   … ${ex.length - 6} more`);
  console.log('');
}

if (REPORT) {
  writeFileSync('data/census/resolver-dryrun-report.json',
    JSON.stringify({ corpus: AHJ_NATIONAL.length, tally, differences: rows }, null, 2));
  console.log('report written: data/census/resolver-dryrun-report.json');
}
