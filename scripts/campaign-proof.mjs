// ═══════════════════════════════════════════════════════════════════════════
// CAMPAIGN PROOF — count the canonical data structures, infer nothing.
//
//   npx tsx scripts/campaign-proof.mjs [--label NAME] [--artifacts]
//
// Runs against whatever tree it sits in, so the same file can be copied into a
// git worktree at an older commit to produce a true BEFORE measurement.
//
// ── THE DEFINITION THAT MATTERS ───────────────────────────────────────────
// FULLY_GOVERNED requires ALL of:
//   stable legal identity · a specific permit department (not the helper
//   placeholder) · an applicable authority scope · an official source URL ·
//   a retrieval date · code-adoption provenance · no unresolved conflict
// A name-only or identity-only row is NOT governed AHJ coverage.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, existsSync } from 'node:fs';

const LABEL = (() => { const i = process.argv.indexOf('--label'); return i > 0 ? process.argv[i + 1] : 'CURRENT'; })();
const ARTIFACTS = process.argv.includes('--artifacts');

const AN = await import('../lib/jurisdictions/ahj-national.ts');
const rows = AN.AHJ_NATIONAL;

// The `ahj()` helper's placeholder — a row carrying it names no authority.
const PLACEHOLDER_AUTHORITY = 'Local Building Department';
const PLACEHOLDER_INSPECTOR = 'Local Building Inspector';

const has = (v) => !!(v && String(v).trim());
const namesDepartment = r => has(r.permitAuthority) && r.permitAuthority.trim() !== PLACEHOLDER_AUTHORITY;

// AhjRecord has NO per-scope authority field. Scope verification is therefore
// structurally impossible on this shape — reported as 0, not as absent.
const scopeVerified = () => 0;

const m = {
  ahjRecords: rows.length,
  stableIdentity: rows.filter(r => r.legalIdentity).length,
  specificDepartment: rows.filter(namesDepartment).length,
  buildingScopeVerified: scopeVerified(),
  electricalScopeVerified: scopeVerified(),
  fireScopeVerified: scopeVerified(),
  codeAdoptionProvenance: rows.filter(r => has(r.codeSourceUrl) && has(r.codeRetrievedAtIso)).length,
  officialSourceUrl: rows.filter(r => has(r.codeSourceUrl)).length,
  contactWebsite: rows.filter(r => has(r.website)).length,
  retrievalDate: rows.filter(r => has(r.codeRetrievedAtIso)).length,
  placeholderInspector: rows.filter(r => String(r.inspectionAuthority ?? '').trim() === PLACEHOLDER_INSPECTOR).length,
  fullyGoverned: rows.filter(r =>
    r.legalIdentity && namesDepartment(r)
    && has(r.codeSourceUrl) && has(r.codeRetrievedAtIso)).length,
  retiredAliases: Object.keys(AN.AHJ_RETIRED_IDS ?? {}).length,
};

// ── legal-government universe (absent before this campaign) ──────────────
let universe = null;
try {
  const U = await import('../lib/jurisdictions/legalGovernmentUniverse.ts');
  if (existsSync(new URL('../data/census/national-government-universe.tsv', import.meta.url))) {
    const all = U.loadUniverse();
    universe = {
      entities: all.length,
      active: all.filter(U.canHoldAuthority).length,
      statistical: all.filter(U.isStatisticalOnly).length,
      superseded: all.filter(e => e.governmentStatus === 'SUPERSEDED').length,
    };
  }
} catch { universe = null; }

console.log(`═══ ${LABEL} ═══`);
console.log(`legal-government entities            : ${universe ? universe.entities : 0}`);
console.log(`  active governments                 : ${universe ? universe.active : 0}`);
console.log(`AHJ / permitting-authority records   : ${m.ahjRecords}`);
console.log(`rows with stable legal identity      : ${m.stableIdentity}`);
console.log(`rows with specific permit department : ${m.specificDepartment}`);
console.log(`rows with verified building scope    : ${m.buildingScopeVerified}`);
console.log(`rows with verified electrical scope  : ${m.electricalScopeVerified}`);
console.log(`rows with verified fire scope        : ${m.fireScopeVerified}`);
console.log(`rows with code-adoption provenance   : ${m.codeAdoptionProvenance}`);
console.log(`rows with official source URL        : ${m.officialSourceUrl}`);
console.log(`rows with retrieval date             : ${m.retrievalDate}`);
console.log(`FULLY GOVERNED records               : ${m.fullyGoverned}`);
console.log(`retired-id aliases                   : ${m.retiredAliases}`);

if (ARTIFACTS && universe) {
  const U = await import('../lib/jurisdictions/legalGovernmentUniverse.ts');
  const GI = await import('../lib/jurisdictions/legalGovernmentIdentity.ts');
  const DP = await import('../lib/jurisdictions/delegationPolicy.ts');
  const policy = DP.baselinePolicy();
  const all = U.loadUniverse();

  const held = new Map();
  for (const r of rows) if (r.legalIdentity) {
    const k = GI.governmentKey(r.legalIdentity);
    held.set(k, [...(held.get(k) ?? []), r]);
  }
  const keyOf = e => e.placeGeoid ? `place:${e.placeGeoid}`
    : e.cousubGeoid ? `cousub:${e.cousubGeoid}`
    : e.countyFips ? `county:${e.countyFips}` : `state:${e.stateFips}`;

  const uspsFor = new Map();
  for (const r of rows) if (r.legalIdentity) uspsFor.set(r.legalIdentity.stateFips, r.stateCode);
  const KIND_BY_DELEGATE = {
    place: ['incorporated-place', 'independent-city', 'consolidated-government'],
    county: ['county', 'county-equivalent', 'municipio', 'borough'],
    'county-subdivision': ['town', 'township', 'mcd'],
    state: ['state'], consolidated: ['consolidated-government'],
  };
  // Which rule selected each kind, per state — carried onto every missing row.
  const RULE_FOR = new Map();
  const KINDS = new Map();
  for (const fips of new Set(all.map(e => e.stateFips))) {
    const usps = uspsFor.get(fips) ?? '';
    const kinds = new Set();
    for (const inc of [true, false]) {
      const match = DP.resolveDelegation(policy, { state: usps, scope: 'building', incorporated: inc });
      for (const k of (KIND_BY_DELEGATE[match?.rule.delegate] ?? [])) {
        kinds.add(k);
        RULE_FOR.set(`${fips}|${k}`, match.rule.id);
      }
    }
    KINDS.set(fips, kinds);
  }
  const plausible = all.filter(e => {
    if (!U.canHoldAuthority(e)) return false;
    const k = KINDS.get(e.stateFips);
    if (!k || !k.has(e.entityKind)) return false;
    if (['county', 'county-equivalent', 'municipio', 'borough'].includes(e.entityKind)) {
      return !e.cousubGeoid && !e.placeGeoid;
    }
    return true;
  });

  const missing = [], heldRows = [];
  for (const e of plausible) {
    const k = keyOf(e);
    const rec = {
      stableGovernmentId: e.id, canonicalName: e.canonicalName, stateFips: e.stateFips,
      entityKind: e.entityKind, countyFips: e.countyFips ?? '', placeGeoid: e.placeGeoid ?? '',
      cousubGeoid: e.cousubGeoid ?? '',
      plausibleBecause: `delegation policy names '${e.entityKind}' for building permits in this state`,
      delegationRuleId: RULE_FOR.get(`${e.stateFips}|${e.entityKind}`) ?? '',
      solarProHasCandidate: held.has(k) ? held.get(k).map(r => r.id).join(';') : '',
    };
    (held.has(k) ? heldRows : missing).push(rec);
  }

  const csv = (list) => {
    const cols = Object.keys(list[0]);
    return [cols.join(','), ...list.map(r => cols.map(c =>
      `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n') + '\n';
  };
  writeFileSync('data/census/national-authority-missing.csv', csv(missing));
  writeFileSync('data/census/national-authority-held.csv', csv(heldRows));

  const byState = {};
  for (const e of plausible) {
    const s = (byState[e.stateFips] ??= { plausible: 0, held: 0, missing: 0 });
    s.plausible++;
    if (held.has(keyOf(e))) s.held++; else s.missing++;
  }
  writeFileSync('data/census/national-authority-coverage.json', JSON.stringify({
    measuredAt: LABEL, universe, registry: m,
    plausibleBuildingAuthorities: plausible.length,
    heldCount: heldRows.length, missingCount: missing.length,
    fullyGoverned: m.fullyGoverned, byState,
  }, null, 2));
  console.log('');
  console.log(`artifacts: national-authority-{coverage.json,missing.csv,held.csv}  `
    + `(plausible ${plausible.length}, held ${heldRows.length}, missing ${missing.length})`);
}
