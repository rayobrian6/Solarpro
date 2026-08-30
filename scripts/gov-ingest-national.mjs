// ═══════════════════════════════════════════════════════════════════════════
// NATIONAL LEGAL-GOVERNMENT INGESTION — deterministic, from federal sources.
//
//   npm run gov:ingest-national              DRY RUN (default)
//   npm run gov:ingest-national -- --write   regenerate the universe TSV
//
// Same source files in, same universe out. Every entity keeps the raw Census
// class and functional-status codes it was derived from, so a grading decision
// is auditable rather than baked in.
//
// ── THE ONE JUDGEMENT THIS FILE MAKES ─────────────────────────────────────
// Mapping FUNCSTAT to "is this a government". Getting it wrong in either
// direction is a real defect, and an earlier pass got it wrong by treating only
// 'A' as a government, which reported Baton Rouge and Louisville as CDPs.
//
//   A  active, primary general-purpose functions          -> ACTIVE
//   B  active, PARTIALLY consolidated, separate officials -> ACTIVE
//   C  active, consolidated, single set of officials      -> ACTIVE
//   G  active but SUBORDINATE to another unit             -> ACTIVE
//   N  nonfunctioning legal entity (Louisville city)      -> SUPERSEDED
//   I  inactive                                           -> SUPERSEDED
//   F  FICTITIOUS, fills the geographic hierarchy —
//      the "(balance)" rows                               -> STATISTICAL_ONLY
//   S  statistical entity — every CDP and CCD             -> STATISTICAL_ONLY
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const WRITE = process.argv.includes('--write');
const DIR = new URL('../data/census/', import.meta.url);
const SOURCES = JSON.parse(readFileSync(new URL('SOURCES.json', DIR), 'utf8'));

function loadPipe(name) {
  const raw = readFileSync(new URL(name, DIR), 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  const hdr = lines[0].split('|');
  return lines.slice(1).map(l => Object.fromEntries(l.split('|').map((v, i) => [hdr[i], v])));
}

const STATUS_BY_FUNCSTAT = {
  A: 'ACTIVE', B: 'ACTIVE', C: 'ACTIVE', G: 'ACTIVE',
  N: 'SUPERSEDED', I: 'SUPERSEDED',
  F: 'STATISTICAL_ONLY', S: 'STATISTICAL_ONLY',
};
const statusOf = fs => STATUS_BY_FUNCSTAT[fs] ?? 'UNKNOWN';

/** The legal descriptor the Census writes into the name is the most reliable
 *  signal of what KIND of government an entity is — more so than CLASSFP, which
 *  encodes the entity's relationship to other layers rather than its own type. */
function kindFromName(name, fallback) {
  const n = name.toLowerCase();
  if (n.endsWith(' municipio')) return 'municipio';
  if (n.endsWith(' city and borough') || n.endsWith(' borough')) return 'borough';
  if (n.endsWith(' census area')) return 'county-equivalent';
  if (n.endsWith(' parish')) return 'county-equivalent';
  if (n.endsWith(' township')) return 'township';
  if (n.endsWith(' town')) return 'town';
  if (n.endsWith(' county')) return 'county';
  return fallback;
}

const entities = [];
const push = e => entities.push(e);

// ── counties and county-equivalents ──────────────────────────────────────
for (const r of loadPipe('national_county2020.txt')) {
  const fips = r.STATEFP + r.COUNTYFP;
  // CLASSFP C7 in the COUNTY file is an independent city — a city that is also
  // a county-equivalent (38 Virginia cities, plus Baltimore, St. Louis, Carson City).
  const independentCity = r.CLASSFP === 'C7';
  // ALASKA, per its actual law rather than a mainland analogy:
  //   H1 borough / municipality  — an organized borough government
  //   H6                          — a UNIFIED city-borough (Anchorage, Juneau,
  //                                 Sitka, Wrangell): one consolidated government
  //   H5 " Census Area"           — the UNORGANIZED BOROUGH. Statistical only.
  //                                 There is no local government at all, so the
  //                                 census area must never become an AHJ; the
  //                                 authority there is state-administered.
  const kind = independentCity ? 'independent-city'
    : r.CLASSFP === 'H6' ? 'consolidated-government'
    : /\smunicipality$/i.test(r.COUNTYNAME) ? 'borough'
    : kindFromName(r.COUNTYNAME, 'county-equivalent');
  // ── AN INDEPENDENT CITY IS ONE GOVERNMENT RECORDED AT TWO LEVELS ────────
  // All 41 of them (38 Virginia cities, plus Baltimore, St. Louis and Carson
  // City) are FUNCSTAT 'F' in the COUNTY file and FUNCSTAT 'A' in the PLACE
  // file. The county-level record is a hierarchy filler — Census marks it
  // fictitious so the government is not counted twice, not because no
  // government exists.
  //
  // Taking 'F' literally here would mark St. Louis STATISTICAL_ONLY, and any
  // lookup that arrives with a county FIPS — which is what an unincorporated
  // determination produces, and what a county-typed registry row carries —
  // would refuse a government that plainly exists. So the county-level record
  // of an independent city inherits the ACTIVE status of the city itself, and
  // says why.
  push({
    id: `county:${fips}`, entityKind: kind, canonicalName: r.COUNTYNAME,
    stateFips: r.STATEFP, countyFips: fips, placeGeoid: '', cousubGeoid: '',
    governmentStatus: independentCity ? 'ACTIVE' : statusOf(r.FUNCSTAT),
    governmentFunctionStatus: independentCity ? `${r.FUNCSTAT}/city-A` : r.FUNCSTAT,
    governmentClass: r.CLASSFP, sourceKey: `national_county2020:${r.COUNTYNS}`,
  });
}

// ── places: incorporated municipalities AND census designated places ─────
for (const r of loadPipe('national_place2020.txt')) {
  const geoid = r.STATEFP + r.PLACEFP;
  const cdp = r.TYPE === 'CENSUS DESIGNATED PLACE';
  const kind = cdp ? 'census-designated-place'
    : r.CLASSFP === 'C7' ? 'independent-city'
    : r.CLASSFP === 'C8' ? 'consolidated-government'
    : kindFromName(r.PLACENAME, 'incorporated-place');
  push({
    id: `place:${geoid}`, entityKind: kind, canonicalName: r.PLACENAME,
    stateFips: r.STATEFP, countyFips: '', placeGeoid: geoid, cousubGeoid: '',
    // A CDP is statistical by definition, whatever its FUNCSTAT says.
    governmentStatus: cdp ? 'STATISTICAL_ONLY' : statusOf(r.FUNCSTAT),
    governmentFunctionStatus: r.FUNCSTAT, governmentClass: r.CLASSFP,
    sourceKey: `national_place2020:${r.PLACENS}`,
  });
}

// ── county subdivisions: real MCDs, and statistical CCDs ─────────────────
for (const r of loadPipe('national_cousub2020.txt')) {
  const geoid = r.STATEFP + r.COUNTYFP + r.COUSUBFP;
  // CLASSFP Z* is a Census County Division — a statistical carve-up of a county
  // in states that have no MCD layer. It is NOT a township and has no government.
  const statistical = r.CLASSFP.startsWith('Z');
  const kind = statistical ? 'census-county-division'
    : kindFromName(r.COUSUBNAME, 'mcd');
  push({
    id: `cousub:${geoid}`, entityKind: kind, canonicalName: r.COUSUBNAME,
    stateFips: r.STATEFP, countyFips: r.STATEFP + r.COUNTYFP, placeGeoid: '',
    cousubGeoid: geoid,
    governmentStatus: statistical ? 'STATISTICAL_ONLY' : statusOf(r.FUNCSTAT),
    governmentFunctionStatus: r.FUNCSTAT, governmentClass: r.CLASSFP,
    sourceKey: `national_cousub2020:${r.COUSUBNS}`,
  });
}

// ── states ────────────────────────────────────────────────────────────────
const stateFips = new Map();
for (const e of entities) if (e.stateFips) stateFips.set(e.stateFips, true);
for (const fips of [...stateFips.keys()].sort()) {
  push({
    id: `state:${fips}`, entityKind: 'state', canonicalName: `State FIPS ${fips}`,
    stateFips: fips, countyFips: '', placeGeoid: '', cousubGeoid: '',
    governmentStatus: 'ACTIVE', governmentFunctionStatus: 'A', governmentClass: 'STATE',
    sourceKey: `derived:state:${fips}`,
  });
}

// ── integrity ─────────────────────────────────────────────────────────────
const byId = new Map();
const dupes = [];
for (const e of entities) {
  if (byId.has(e.id)) dupes.push(e.id); else byId.set(e.id, e);
}

const tallyKind = {}, tallyStatus = {};
for (const e of entities) {
  tallyKind[e.entityKind] = (tallyKind[e.entityKind] ?? 0) + 1;
  tallyStatus[e.governmentStatus] = (tallyStatus[e.governmentStatus] ?? 0) + 1;
}

console.log('═══ NATIONAL LEGAL-GOVERNMENT INGESTION ═══  mode:', WRITE ? 'WRITE' : 'DRY-RUN');
console.log(`sources: ${SOURCES.files.map(f => `${f.file}@${f.sha256.slice(0, 8)}`).join(', ')}`);
console.log(`vintage: ${SOURCES.vintage}`);
console.log('');
console.log(`entities: ${entities.length}   duplicate ids: ${dupes.length}`);
console.log('');
console.log('── by government status ──');
for (const [k, v] of Object.entries(tallyStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(6)}`);
}
console.log('');
console.log('── by entity kind ──');
for (const [k, v] of Object.entries(tallyKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} ${String(v).padStart(6)}`);
}
const active = entities.filter(e => e.governmentStatus === 'ACTIVE'
  && !['census-designated-place', 'census-county-division'].includes(e.entityKind));
console.log('');
console.log(`ACTIVE GOVERNMENTS (can hold authority): ${active.length}`);
console.log(`STATISTICAL ONLY (can NEVER be an AHJ) : ${entities.length - active.length - entities.filter(e => e.governmentStatus === 'SUPERSEDED').length}`);

if (WRITE) {
  const COLS = ['id', 'entityKind', 'canonicalName', 'stateFips', 'countyFips',
    'placeGeoid', 'cousubGeoid', 'governmentStatus', 'governmentFunctionStatus',
    'governmentClass', 'sourceKey'];
  const meta = { dataset: 'US Census Bureau national geographic reference codes', vintage: SOURCES.vintage };
  const body = entities.map(e => COLS.map(c => String(e[c] ?? '').replace(/\t/g, ' ')).join('\t')).join('\n');
  const out = `# ${JSON.stringify(meta)}\n${COLS.join('\t')}\n${body}\n`;
  writeFileSync(new URL('national-government-universe.tsv', DIR), out);
  console.log('');
  console.log(`WROTE data/census/national-government-universe.tsv  (${(out.length / 1024 / 1024).toFixed(2)} MB, `
    + `sha256 ${createHash('sha256').update(out).digest('hex').slice(0, 16)}…)`);
} else {
  console.log('');
  console.log('DRY RUN — nothing written. Re-run with --write.');
}
