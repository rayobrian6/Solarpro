// ═══════════════════════════════════════════════════════════════════════════
// STABLE LEGAL-GEOGRAPHY IDENTITY FOR THE AHJ REGISTRY
//
//   npm run ahj:backfill-identities              DRY RUN (default) + summary
//   npm run ahj:backfill-identities -- --report  write the full JSON report
//   npm run ahj:backfill-identities -- --write   apply to lib/jurisdictions/ahj-national.ts
//
// ── WHAT THIS PROVES, AND WHAT IT DOES NOT ────────────────────────────────
// It proves WHICH LEGAL GOVERNMENT a registry row represents, by binding it to
// an authoritative Census legal-geography identity (place GEOID / county FIPS /
// MCD GEOID). That is `legalIdentityVerified`.
//
// It does NOT prove that government administers building permits, or which
// codes it has adopted. That is `permittingAuthorityVerified`, a separate and
// currently unmeasured dimension. A GEOID is not a permit office. Do not let a
// coverage number from this script be read as AHJ coverage.
//
// ── WHY FAIL-CLOSED IS THE WHOLE DESIGN ───────────────────────────────────
// American place names repeat relentlessly — Springfield, Washington, Franklin,
// Madison, Union, Georgetown. Eleven incorporated place names occur TWICE inside
// a single state. A wrong GEOID silently binds a package to the wrong
// government, which is precisely the defect class this campaign exists to end,
// so an unprovable identity is recorded as AMBIGUOUS and left unbound. A blank
// is honest; a guess is not.
//
// ── A CDP IS NOT A GOVERNMENT ─────────────────────────────────────────────
// The place file holds 19,734 INCORPORATED PLACEs and 12,454 CENSUS DESIGNATED
// PLACEs. A CDP is a statistical geography the Census draws around a populated
// area that has no municipal government at all — matching one and calling it an
// AHJ would invent a permitting authority. Same for CCDs (CLASSFP Z*) in the
// county-subdivision file. Only FUNCSTAT 'A' (actively functioning government)
// is ever bindable.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CENSUS_DIR = new URL('../data/census/', import.meta.url);
const REGISTRY_TS = new URL('../lib/jurisdictions/ahj-national.ts', import.meta.url);

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const REPORT = args.includes('--report') || WRITE;

// ── Reference data ────────────────────────────────────────────────────────
function loadPipe(name) {
  const raw = readFileSync(new URL(name, CENSUS_DIR), 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  const hdr = lines[0].split('|');
  return lines.slice(1).map(l => Object.fromEntries(l.split('|').map((v, i) => [hdr[i], v])));
}

/** Fold spelling variance WITHOUT changing which place it is — the same rule the
 *  resolver uses (st/saint, mt/mount, ft/fort, pt/point, punctuation, hyphens).
 *  It may rewrite a token, never add or drop one, so "Chicago Heights" can never
 *  become "Chicago". */
function norm(s) {
  if (!s) return '';
  const WORD = { st: 'saint', ste: 'sainte', mt: 'mount', ft: 'fort', pt: 'point' };
  return String(s)
    // Fold diacritics: Puerto Rico's municipios are written "Añasco Municipio",
    // "Bayamón Municipio", and a registry row spells them without the accent.
    // NFD + combining-mark removal is a spelling fold, not a name change.
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '').replace(/[-_]+/g, ' ')
    .split(/\s+/).filter(Boolean).map(w => WORD[w] ?? w).join(' ').trim();
}

// LSAD suffixes as they actually occur in the file, longest first so
// "city and borough" is stripped before "borough".
const LSAD = [
  'city and borough', 'county unified government', 'county metro government',
  'county metropolitan government', 'unified government', 'metro government',
  'consolidated government', 'urban county government',
  'municipality', 'corporation', 'township', 'village', 'borough', 'plantation',
  'city', 'town', 'cdp',
];
/**
 * Strip the Census LSAD suffix from a CENSUS PLACENAME — and ONLY from a Census
 * PLACENAME.
 *
 * The Census writes the legal/statistical descriptor into the name itself:
 * "Granite City city", "Boston town", "Oakwood village". The registry stores the
 * bare name: "Granite City". Applying this to the REGISTRY side mangles every
 * municipality whose actual NAME ends in a descriptor word:
 *
 *   "Granite City"    -> "granite"        "Salt Lake City" -> "salt lake"
 *   "Oklahoma City"   -> "oklahoma"       "Jersey City"    -> "jersey"
 *   "Kansas City"     -> "kansas"         "Iowa City"      -> "iowa"
 *
 * which is the same defect as the prefix matcher this campaign removed: a rule
 * that changes WHICH PLACE a name refers to. It failed closed (NO_MATCH rather
 * than a wrong GEOID), but it silently cost ~40 bindings. Registry names go
 * through `norm` only.
 */
function stripLsad(censusPlaceName) {
  let n = norm(censusPlaceName);
  for (const s of LSAD) {
    if (n.endsWith(' ' + s)) { n = n.slice(0, -(s.length + 1)).trim(); break; }
  }
  return n;
}
/** County names carry their own suffixes. Independent cities appear in the
 *  COUNTY file as "Alexandria city" — they are county-EQUIVALENTS. */
function stripCountySuffix(name) {
  let n = norm(name);
  // NOTE: 'island' is deliberately ABSENT. It is not a county-type suffix, and
  // including it mangled "Rock Island" -> "rock", losing Rock Island County IL —
  // the same class of name-changing rule as the LSAD bug above.
  for (const s of ['county', 'parish', 'census area', 'city and borough', 'borough',
    'municipality', 'municipio', 'district', 'city']) {
    if (n.endsWith(' ' + s)) { n = n.slice(0, -(s.length + 1)).trim(); break; }
  }
  return n;
}

const places = loadPipe('national_place2020.txt');
const counties = loadPipe('national_county2020.txt');
const cousubs = loadPipe('national_cousub2020.txt');
const SOURCES = JSON.parse(readFileSync(new URL('SOURCES.json', CENSUS_DIR), 'utf8'));

const STATE_FIPS = new Map();
for (const c of counties) STATE_FIPS.set(c.STATE.toUpperCase(), c.STATEFP);
for (const p of places) if (!STATE_FIPS.has(p.STATE.toUpperCase())) STATE_FIPS.set(p.STATE.toUpperCase(), p.STATEFP);

// ── FUNCSTAT, THE CENSUS FUNCTIONAL STATUS CODE ───────────────────────────
// Getting this wrong is not a rounding error, it is a factual mislabel. A first
// pass here treated FUNCSTAT 'A' as the only government and swept everything
// else into the CDP bucket, which reported Baton Rouge, Lafayette, Louisville
// and Washington DC as "Census Designated Places". They are not CDPs; they are
// consolidated or superseded CITY governments, and the difference is the whole
// point of this exercise.
//
//   A  active government providing primary general-purpose functions
//   B  active government PARTIALLY consolidated with another, separate officials
//   C  active government consolidated with another, single set of officials
//   G  active government SUBORDINATE to another unit
//   F  FICTITIOUS entity created to fill the geographic hierarchy — the
//      "(balance)" rows, e.g. "Nashville-Davidson metropolitan government
//      (balance)". A geographic remainder, not a government you can permit with.
//   N  nonfunctioning legal entity — e.g. "Louisville city", superseded by the
//      Louisville/Jefferson County metro government
//   S  statistical entity — every CDP
//
// A, B and C are bindable governments. G is a real government but subordinate,
// so it is bindable with reduced confidence. F, N, I and S are not.
const GOVERNMENT_FUNCSTAT = new Set(['A', 'B', 'C']);
const SUBORDINATE_FUNCSTAT = new Set(['G']);
const isGovernment = r => GOVERNMENT_FUNCSTAT.has(r.FUNCSTAT);

const incByState = new Map();      // state -> normName -> rows[]   (bindable governments)
const cdpByState = new Map();      // TYPE === CENSUS DESIGNATED PLACE only
const defunctByState = new Map();  // incorporated but N / F / I — superseded or fictitious
for (const p of places) {
  const bucket = p.TYPE === 'CENSUS DESIGNATED PLACE' ? cdpByState
    : (isGovernment(p) || SUBORDINATE_FUNCSTAT.has(p.FUNCSTAT)) ? incByState
    : defunctByState;
  if (!bucket.has(p.STATE)) bucket.set(p.STATE, new Map());
  const m = bucket.get(p.STATE);
  const k = stripLsad(p.PLACENAME);
  m.set(k, [...(m.get(k) ?? []), p]);
}
// Counties that exist as legal geography but are NOT governments. Connecticut
// and Rhode Island abolished county government outright (every CT and RI county
// row is FUNCSTAT 'N'), and 9 of Massachusetts' 14 are too. A registry row
// asserting "Fairfield County Building Department" names a government that does
// not exist — in New England the TOWN is the building authority. That is a data
// defect worth reporting precisely, not an unexplained NO_MATCH.
const nonGovCtyByState = new Map();
for (const c of counties) {
  if (isGovernment(c)) continue;
  if (!nonGovCtyByState.has(c.STATE)) nonGovCtyByState.set(c.STATE, new Map());
  const m = nonGovCtyByState.get(c.STATE);
  const k = stripCountySuffix(c.COUNTYNAME);
  m.set(k, [...(m.get(k) ?? []), c]);
}
const ctyByState = new Map();
for (const c of counties) {
  if (!isGovernment(c)) continue;
  if (!ctyByState.has(c.STATE)) ctyByState.set(c.STATE, new Map());
  const m = ctyByState.get(c.STATE);
  const k = stripCountySuffix(c.COUNTYNAME);
  m.set(k, [...(m.get(k) ?? []), c]);
}
const mcdByState = new Map();      // ACTIVE MCDs only (T*) — a CCD (Z*) is statistical
for (const s of cousubs) {
  if (!isGovernment(s) || !s.CLASSFP.startsWith('T')) continue;
  if (!mcdByState.has(s.STATE)) mcdByState.set(s.STATE, new Map());
  const m = mcdByState.get(s.STATE);
  const k = stripLsad(s.COUSUBNAME);
  m.set(k, [...(m.get(k) ?? []), s]);
}

const countiesOf = p => String(p.COUNTIES ?? '').split('~~~').map(c => stripCountySuffix(c)).filter(Boolean);

// ── Registry rows ─────────────────────────────────────────────────────────
const mod = await import('../lib/jurisdictions/ahj-national.ts');
const ROWS = mod.AHJ_NATIONAL ?? [];

/** Classify one registry row against authoritative legal geography. */
function classify(r) {
  const state = String(r.stateCode ?? '').toUpperCase();
  const stateFips = STATE_FIPS.get(state) ?? null;
  const out = {
    solarProAhjId: r.id,
    currentName: r.ahjName ?? null,
    state,
    county: r.county ?? null,
    cityOrLocality: r.city ?? null,
    currentType: r.ahjType ?? null,
    currentAuthorityName: r.permitAuthority ?? null,
    candidateLegalEntityType: null,
    candidateStateFips: stateFips,
    candidateCountyFips: null,
    candidatePlaceGeoid: null,
    candidateMcdGeoid: null,
    candidateGovernmentId: null,
    matchMethod: null,
    matchConfidence: 0,
    ambiguityReason: null,
    aliases: [],
    canonicalName: null,
    classification: 'NO_MATCH',
  };
  if (!stateFips) { out.classification = 'MANUAL_REVIEW_REQUIRED'; out.ambiguityReason = `unknown state code "${state}"`; return out; }

  const cityRaw = String(r.city ?? '').trim();
  const isCountyRow = r.ahjType === 'county' || cityRaw.toLowerCase() === 'unincorporated';

  // ── the county the row claims, resolved first: it corroborates a place match
  const cKey = stripCountySuffix(r.county ?? '');
  const cHits = (ctyByState.get(state)?.get(cKey)) ?? [];
  const county = cHits.length === 1 ? cHits[0] : null;
  if (county) out.candidateCountyFips = county.STATEFP + county.COUNTYFP;

  if (r.ahjType === 'state') {
    out.candidateLegalEntityType = 'state';
    out.candidateGovernmentId = `state:${stateFips}`;
    out.matchMethod = 'state-code';
    out.matchConfidence = 1;
    out.classification = 'EXACT_STABLE_IDENTITY';
    return out;
  }

  if (isCountyRow) {
    out.candidateLegalEntityType = 'county';
    if (cHits.length === 1) {
      out.candidateGovernmentId = `county:${out.candidateCountyFips}`;
      out.canonicalName = county.COUNTYNAME;
      out.matchMethod = 'state+county-name';
      out.matchConfidence = 1;
      out.classification = 'EXACT_STABLE_IDENTITY';
      // an independent city (CLASSFP C7) is a county-EQUIVALENT, not a county
      if (county.CLASSFP === 'C7') out.candidateLegalEntityType = 'independent-city';
    } else if (cHits.length > 1) {
      out.classification = 'AMBIGUOUS';
      out.ambiguityReason = `${cHits.length} active counties in ${state} normalize to "${cKey}"`;
    } else {
      const dead = (nonGovCtyByState.get(state)?.get(cKey)) ?? [];
      if (dead.length) {
        out.classification = 'NON_GOVERNMENT_PLACE';
        out.candidateLegalEntityType = 'nonfunctioning-county';
        out.candidateCountyFips = dead[0].STATEFP + dead[0].COUNTYFP;
        out.ambiguityReason = `"${dead[0].COUNTYNAME}" exists as legal geography but is FUNCSTAT `
          + `'${dead[0].FUNCSTAT}' — ${state} has no county GOVERNMENT here (CT and RI abolished county `
          + 'government entirely; most MA counties too). This row names a building department that does '
          + 'not exist; in New England the TOWN/MCD is the building authority.';
      } else {
        out.classification = 'NO_MATCH';
        out.ambiguityReason = `no active county in ${state} matches "${r.county}"`;
      }
    }
    return out;
  }

  // ── municipal row ────────────────────────────────────────────────────────
  out.candidateLegalEntityType = 'incorporated-place';
  const pKey = norm(cityRaw);   // registry names carry NO LSAD suffix
  const pHits = (incByState.get(state)?.get(pKey)) ?? [];

  if (pHits.length === 1) {
    const p = pHits[0];
    const corroborated = !cKey || countiesOf(p).includes(cKey);
    out.candidatePlaceGeoid = p.STATEFP + p.PLACEFP;
    out.candidateGovernmentId = `place:${out.candidatePlaceGeoid}`;
    out.canonicalName = p.PLACENAME;
    out.matchMethod = corroborated ? 'state+county+place-name' : 'state+place-name';
    out.matchConfidence = corroborated ? 1 : 0.8;
    out.classification = corroborated ? 'EXACT_STABLE_IDENTITY' : 'HIGH_CONFIDENCE_MATCH';
    if (!corroborated) out.ambiguityReason = `place is in ${countiesOf(p).join(', ')}; row says "${r.county}"`;
    // CLASSFP, verified against the data rather than assumed:
    //   C7 = incorporated place INDEPENDENT OF ANY COUNTY — the 41 true
    //        independent cities (38 Virginia cities, plus Baltimore, St. Louis
    //        and Carson City). A county-EQUIVALENT.
    //   C5 = incorporated place independent of any county SUBDIVISION, i.e. it
    //        stands outside the township layer. 4,147 of them, concentrated in
    //        the MCD states (PA 1013, MN 849, WI 602, ND, NJ, SD, MI) — and the
    //        list includes Chicago. These are ORDINARY MUNICIPALITIES. An
    //        earlier pass labelled them 'consolidated-government', which
    //        mislabelled 165 registry rows including Chicago as city-county
    //        consolidations. They are not.
    if (p.CLASSFP === 'C7') out.candidateLegalEntityType = 'independent-city';
    if (SUBORDINATE_FUNCSTAT.has(p.FUNCSTAT)) {
      // A subordinate government is real but sits under another unit; which of
      // the two issues the building permit is a delegation question.
      out.matchConfidence = Math.min(out.matchConfidence, 0.8);
      out.classification = 'HIGH_CONFIDENCE_MATCH';
      out.ambiguityReason = `${p.PLACENAME} is FUNCSTAT 'G' — an active government SUBORDINATE to another `
        + 'unit. Confirm which level administers building permits before promoting.';
    }
    return out;
  }

  if (pHits.length > 1) {
    // The COUNTIES column disambiguates same-name places — that is exactly the
    // case it exists for (St. Anthony city, MN appears in Hennepin/Ramsey and
    // again in Stearns).
    const byCounty = cKey ? pHits.filter(p => countiesOf(p).includes(cKey)) : [];
    if (byCounty.length === 1) {
      const p = byCounty[0];
      out.candidatePlaceGeoid = p.STATEFP + p.PLACEFP;
      out.candidateGovernmentId = `place:${out.candidatePlaceGeoid}`;
      out.canonicalName = p.PLACENAME;
      out.matchMethod = 'state+county+place-name';
      out.matchConfidence = 1;
      out.classification = 'EXACT_STABLE_IDENTITY';
      return out;
    }
    out.classification = 'AMBIGUOUS';
    out.ambiguityReason = `${pHits.length} active incorporated places in ${state} normalize to "${pKey}"`
      + (cKey ? `; county "${r.county}" narrowed it to ${byCounty.length}` : '; row carries no county to disambiguate');
    out.aliases = pHits.map(p => `${p.PLACENAME} (${p.STATEFP + p.PLACEFP}, ${countiesOf(p).join('/')})`);
    return out;
  }

  // No bindable incorporated government. Three distinct reasons, three answers.
  const cdpHits = (cdpByState.get(state)?.get(pKey)) ?? [];
  if (cdpHits.length) {
    out.classification = 'NON_GOVERNMENT_PLACE';
    out.candidateLegalEntityType = 'census-designated-place';
    out.ambiguityReason = 'matches only a CENSUS DESIGNATED PLACE — a statistical geography the Census '
      + 'draws around a populated area that has NO municipal government. The permitting authority here is '
      + 'the county (or an MCD), never the CDP.';
    out.aliases = cdpHits.map(p => `${p.PLACENAME} (${p.STATEFP + p.PLACEFP})`);
    return out;
  }

  // An incorporated place that is nonfunctioning (N), fictitious (F) or inactive
  // (I). These are the consolidated city-county cases: "Louisville city" is
  // superseded by the Louisville/Jefferson County metro government, "Washington
  // city" by the District of Columbia itself. The successor is usually the
  // county-equivalent, but naming it automatically would be exactly the kind of
  // inference this campaign forbids, so it is reported for review with the
  // evidence attached.
  const defunctHits = (defunctByState.get(state)?.get(pKey)) ?? [];
  if (defunctHits.length) {
    const d = defunctHits[0];
    out.classification = 'SUPERSEDED';
    out.candidateLegalEntityType = 'consolidated-government';
    out.ambiguityReason = `"${d.PLACENAME}" exists in the legal-geography source but is FUNCSTAT `
      + `'${d.FUNCSTAT}' (${d.FUNCSTAT === 'N' ? 'nonfunctioning legal entity'
        : d.FUNCSTAT === 'F' ? 'fictitious entity filling the geographic hierarchy'
        : 'inactive'}) — its functions are held by a consolidated or successor government. `
      + (out.candidateCountyFips
        ? `The row's county resolves to ${out.candidateCountyFips}, which is the likely successor; confirm before binding.`
        : 'No county resolved to suggest a successor.');
    out.aliases = defunctHits.map(p => `${p.PLACENAME} (${p.STATEFP + p.PLACEFP}, FUNCSTAT ${p.FUNCSTAT})`);
    return out;
  }

  const mHits = (mcdByState.get(state)?.get(pKey)) ?? [];
  const mNarrow = cKey ? mHits.filter(m => stripCountySuffix(m.COUNTYNAME) === cKey) : mHits;
  if (mNarrow.length === 1) {
    const m = mNarrow[0];
    out.candidateLegalEntityType = 'mcd';
    out.candidateMcdGeoid = m.STATEFP + m.COUNTYFP + m.COUSUBFP;
    out.candidateGovernmentId = `cousub:${out.candidateMcdGeoid}`;
    out.canonicalName = m.COUSUBNAME;
    out.matchMethod = 'state+county+mcd-name';
    out.matchConfidence = 0.8;
    out.classification = 'HIGH_CONFIDENCE_MATCH';
    out.ambiguityReason = 'matched an active MCD (township) rather than an incorporated place — '
      + 'confirm the township actually administers building permits in this state before promoting.';
    return out;
  }
  if (mNarrow.length > 1) {
    out.classification = 'AMBIGUOUS';
    out.ambiguityReason = `${mNarrow.length} active MCDs in ${state} normalize to "${pKey}"`;
    return out;
  }

  // ── GUARDED CANDIDATES — PROPOSED FOR REVIEW, NEVER BOUND ────────────────
  // The dominant residual is consolidated city-county government, where the
  // legal name is hyphenated and the common name is not: "Athens" is
  // "Athens-Clarke County unified government", "Butte" is "Butte-Silver Bow".
  // A second group has an official name that simply differs from the common one
  // ("Boise" is "Boise City city"; Ventura is "San Buenaventura (Ventura) city";
  // New York City is "New York city").
  //
  // Both are real, and both are EXACTLY the shape a prefix or substring matcher
  // would "solve" — which is the defect this campaign removed, because the same
  // rule turns Chicago Heights into Chicago. So candidates are NAMED for a human
  // and the row stays unbound. §3: a guarded fuzzy candidate goes to manual
  // review, never to auto-verified.
  const pool = [...(incByState.get(state)?.entries() ?? []), ...(defunctByState.get(state)?.entries() ?? [])];
  const cands = [];
  for (const [k, rowsAt] of pool) {
    const tokens = k.split(' ');
    const hyphen = k.replace(/\s+/g, '-');
    const startsWholeToken = k.startsWith(pKey + ' ') || hyphen.startsWith(pKey + '-');
    const parenthesised = k.includes('(' + pKey + ')') || k.includes(pKey + ')');
    if (!startsWholeToken && !parenthesised && !tokens.includes(pKey)) continue;
    for (const p of rowsAt) {
      cands.push(`${p.PLACENAME} (${p.STATEFP + p.PLACEFP}, CLASSFP ${p.CLASSFP}, FUNCSTAT ${p.FUNCSTAT})`);
    }
  }
  if (cands.length) {
    out.classification = 'MANUAL_REVIEW_REQUIRED';
    out.matchMethod = 'guarded-candidate';
    out.matchConfidence = 0;
    out.aliases = cands.slice(0, 6);
    out.ambiguityReason = `no exact legal-name match for "${cityRaw}" in ${state}; `
      + `${cands.length} candidate government(s) share the name as a whole token — most likely a `
      + 'consolidated city-county or an official name that differs from the common one. '
      + 'NOT bound: confirming which is a human decision, and a prefix rule here is precisely the '
      + 'defect that turned Chicago Heights into Chicago.';
    return out;
  }

  out.classification = 'NO_MATCH';
  out.ambiguityReason = `no active incorporated place, CDP or MCD in ${state} normalizes to "${pKey}"`;
  return out;
}

const classified = ROWS.map(classify);

// ── DUPLICATE detection: two rows resolving to ONE government ─────────────
const byGov = new Map();
for (const c of classified) {
  if (!c.candidateGovernmentId) continue;
  byGov.set(c.candidateGovernmentId, [...(byGov.get(c.candidateGovernmentId) ?? []), c]);
}
const duplicateGroups = [...byGov.entries()].filter(([, v]) => v.length > 1);
for (const [gov, group] of duplicateGroups) {
  for (const c of group) {
    // Not silently merged (§4): flagged, with the peers named, for review.
    c.classification = 'DUPLICATE';
    c.ambiguityReason = `${group.length} registry rows resolve to ${gov}: `
      + group.map(g => g.solarProAhjId).join(', ')
      + ' — these may be separate DEPARTMENTS of one government, or true duplicates. Not merged automatically.';
  }
}

// ── Report ────────────────────────────────────────────────────────────────
const tally = {};
for (const c of classified) tally[c.classification] = (tally[c.classification] ?? 0) + 1;

const bindable = classified.filter(c =>
  c.classification === 'EXACT_STABLE_IDENTITY' && c.candidateGovernmentId);

const byState = {};
for (const c of classified) {
  const s = (byState[c.state] ??= { total: 0, exact: 0, high: 0, ambiguous: 0, noMatch: 0, cdp: 0, duplicate: 0 });
  s.total++;
  if (c.classification === 'EXACT_STABLE_IDENTITY') s.exact++;
  else if (c.classification === 'HIGH_CONFIDENCE_MATCH') s.high++;
  else if (c.classification === 'AMBIGUOUS') s.ambiguous++;
  else if (c.classification === 'NO_MATCH') s.noMatch++;
  else if (c.classification === 'NON_GOVERNMENT_PLACE') s.cdp++;
  else if (c.classification === 'DUPLICATE') s.duplicate++;
}

const report = {
  generatedBy: 'scripts/ahj-backfill-identities.mjs',
  mode: WRITE ? 'WRITE' : 'DRY-RUN',
  sources: SOURCES,
  registryRows: ROWS.length,
  classification: tally,
  legalIdentityCoverage: {
    note: 'LEGAL IDENTITY coverage — which GOVERNMENT each row is. This is NOT permitting-authority '
      + 'coverage: a GEOID proves identity, never that the government issues building permits or which '
      + 'codes it adopted.',
    bindable: bindable.length,
    ofTotal: ROWS.length,
    percent: ((bindable.length / ROWS.length) * 100).toFixed(2) + '%',
  },
  byState,
  rows: classified,
};

if (REPORT) {
  writeFileSync('data/census/identity-backfill-report.json', JSON.stringify(report, null, 2));
  console.log('report written: data/census/identity-backfill-report.json');
}

console.log('═══ AHJ LEGAL-IDENTITY BACKFILL ═══   mode:', report.mode);
console.log(`sources: ${SOURCES.files.map(f => `${f.file}@${f.sha256.slice(0, 8)}`).join(', ')} (vintage ${SOURCES.vintage})`);
console.log(`registry rows: ${ROWS.length}`);
console.log('');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(26)} ${String(v).padStart(5)}`);
}
console.log('');
console.log(`LEGAL IDENTITY COVERAGE: ${report.legalIdentityCoverage.bindable} / ${ROWS.length}`
  + `  (${report.legalIdentityCoverage.percent})   [NOT permitting-authority coverage]`);
console.log('');
const worst = Object.entries(byState)
  .filter(([, v]) => v.ambiguous + v.noMatch > 0)
  .sort((a, b) => (b[1].ambiguous + b[1].noMatch) - (a[1].ambiguous + a[1].noMatch)).slice(0, 10);
console.log('── states with the most unbindable rows ──');
for (const [st, v] of worst) {
  console.log(`  ${st}  total ${String(v.total).padStart(4)}  exact ${String(v.exact).padStart(4)}`
    + `  ambiguous ${String(v.ambiguous).padStart(3)}  noMatch ${String(v.noMatch).padStart(3)}  cdp ${String(v.cdp).padStart(3)}`);
}
console.log('');
console.log('── samples that FAILED CLOSED (not guessed) ──');
for (const c of classified.filter(c => c.classification === 'AMBIGUOUS').slice(0, 5)) {
  console.log(`  ${c.solarProAhjId}: ${c.ambiguityReason}`);
}
for (const c of classified.filter(c => c.classification === 'NON_GOVERNMENT_PLACE').slice(0, 4)) {
  console.log(`  ${c.solarProAhjId}: CDP — ${c.aliases[0] ?? ''}`);
}

// ── WRITE ─────────────────────────────────────────────────────────────────
// Emitted as a GENERATED SIDE-TABLE keyed by AHJ id, merged into AHJ_NATIONAL at
// load. Not by rewriting 4,000 hand-curated `ahj({...})` calls: that would put a
// machine diff through a file humans maintain, and one bad regex would silently
// corrupt curated permit data. This is still ONE registry — the identity is
// attached to the same rows — it is just generated separately so the diff is
// reviewable and the curated table stays untouched.
if (WRITE) {
  const bindableRows = classified.filter(c =>
    (c.classification === 'EXACT_STABLE_IDENTITY') && c.candidateGovernmentId);
  const entries = bindableRows.map(c => {
    const id = {
      entityType: c.candidateLegalEntityType,
      stateFips: c.candidateStateFips,
      countyFips: c.candidateCountyFips ?? null,
      placeGeoid: c.candidatePlaceGeoid ?? null,
      mcdGeoid: c.candidateMcdGeoid ?? null,
      canonicalName: c.canonicalName ?? c.currentName ?? '',
      matchMethod: c.matchMethod,
      source: 'US Census Bureau national geographic reference codes (codes2020)',
      sourceVintage: SOURCES.vintage,
      sourceSha256: SOURCES.files[0].sha256,
    };
    return `  ${JSON.stringify(c.solarProAhjId)}: ${JSON.stringify(id)},`;
  });
  const header = `// ═══════════════════════════════════════════════════════════════════════════
// GENERATED — DO NOT EDIT BY HAND.
//   npm run ahj:backfill-identities -- --write
//
// Stable legal-geography identity for AHJ registry rows, established against
// authoritative US Census reference data. Only DETERMINISTIC matches appear
// here: a row whose government could not be proven is ABSENT, and absent means
// "identity not established", which is the honest answer. Ambiguous, superseded,
// CDP and manual-review rows are deliberately excluded — see the remediation
// report at data/census/identity-backfill-report.json.
//
// Source: ${SOURCES.files.map(f => `${f.file} (sha256 ${f.sha256})`).join(', ')}
// Vintage: ${SOURCES.vintage}
// Rows bound: ${bindableRows.length} of ${ROWS.length}
// ═══════════════════════════════════════════════════════════════════════════
import type { LegalGovernmentIdentity } from './legalGovernmentIdentity';

export const AHJ_LEGAL_IDENTITY: Record<string, LegalGovernmentIdentity> = {
`;
  writeFileSync('lib/jurisdictions/ahj-legal-identity.generated.ts',
    header + entries.join('\n') + '\n};\n');
  console.log('');
  console.log(`WROTE lib/jurisdictions/ahj-legal-identity.generated.ts — ${bindableRows.length} identities`);
} else {
  console.log('');
  console.log('DRY RUN — no registry file was modified. Re-run with --write to apply.');
}
