// ═══════════════════════════════════════════════════════════════════════════
// NATIONAL AHJ COVERAGE AUDIT — what do our records actually cover?
//
//   npm run ahj:audit-national            human summary
//   npm run ahj:audit-national -- --json  machine-readable
//
// ── WHY THE DENOMINATORS ARE SPLIT ────────────────────────────────────────
// "Coverage %" is meaningless against one number, because two different things
// are being counted:
//
//   LEGAL-GOVERNMENT COVERAGE — how many of the country's general-purpose
//     governments do we hold a row for. Denominator: the Census of Governments.
//
//   PERMITTING-AUTHORITY COVERAGE — how many of the governments that actually
//     ISSUE BUILDING PERMITS do we hold a row for. This denominator IS NOT
//     KNOWN and cannot be derived from Census data: not every municipality
//     administers its own building department (many contract to the county),
//     and some special districts do. Claiming a percentage against the legal
//     denominator would systematically overstate the gap in states where
//     counties administer widely, and understate it elsewhere.
//
// So this report gives the first as a percentage and the second as a COUNT of
// what we hold plus what we cannot yet classify. §20: do not fake a coverage
// percentage unless the denominator is meaningful.
//
// ── WHY DEFAULTS ARE COUNTED AS ABSENT ────────────────────────────────────
// The `ahj()` helper in the table fills unsupplied fields with generic
// placeholders — permitAuthority becomes 'Local Building Department',
// inspectionAuthority becomes 'Local Building Inspector', the fee becomes a
// national range. A row carrying those has NOT told us who the authority is;
// it has told us that nobody filled it in. A naive `!r.permitAuthority` check
// therefore reports ZERO gaps across the whole table, which is the single most
// misleading number this audit could emit. Every placeholder below is compared
// against the helper's own default and counted as UNESTABLISHED.
// ═══════════════════════════════════════════════════════════════════════════


// ── Reference denominators ────────────────────────────────────────────────
// US Census Bureau, 2022 Census of Governments — Organization (released 2023).
// National totals only: this file deliberately does NOT carry a per-state table
// it cannot cite line by line. Per-state legal denominators are reported as
// UNKNOWN rather than invented.
const CENSUS_2022 = {
  citation: 'US Census Bureau, 2022 Census of Governments — Organization (GOVS), Table 2',
  countyGovernments: 3031,
  countyAndEquivalentAreas: 3144,
  municipalGovernments: 19495,
  townshipGovernments: 16253,
  specialDistricts: 39555,
};

// The `ahj()` helper's own defaults. A field equal to its default was never
// supplied by a human and must not be reported as data.
const HELPER_DEFAULTS = {
  permitAuthority: 'Local Building Department',
  inspectionAuthority: 'Local Building Inspector',
  typicalPermitFee: '$150–$500',
  feeStructure: 'Flat fee or valuation-based',
  rapidShutdownStandard: 'NEC 690.12',
};

const isDefaulted = (r, field) =>
  String(r[field] ?? '').trim() === HELPER_DEFAULTS[field];

function pct(n, d) { return d > 0 ? `${((n / d) * 100).toFixed(2)}%` : 'n/a'; }

async function loadRecords() {
  // tsx supplies the TS loader; a plain relative specifier resolves correctly on
  // every platform (a pathToFileURL round-trip mangles Windows drive letters).
  const mod = await import('../lib/jurisdictions/ahj-national.ts');
  return mod.AHJ_NATIONAL ?? [];
}

function audit(records) {
  const byState = new Map();
  const byType = {};
  const byProvenance = {};
  const idSeen = new Map();
  const identityGaps = [];
  const officialSourceGaps = [];
  const codeEvidenceGaps = [];
  const permitAuthorityDefaulted = [];
  const inspectionAuthorityDefaulted = [];
  const contactless = [];
  const unincorporatedRows = [];
  const collisions = new Map();

  for (const r of records) {
    const st = String(r.stateCode ?? '??').toUpperCase();
    if (!byState.has(st)) {
      byState.set(st, {
        total: 0, city: 0, county: 0, state: 0, special_district: 0, other: 0,
        curated: 0, expanded: 0, registry_live: 0,
        permitAuthorityUnestablished: 0, noOfficialSource: 0,
      });
    }
    const b = byState.get(st);
    b.total++;
    const t = r.ahjType ?? 'other';
    b[t] = (b[t] ?? 0) + 1;
    byType[t] = (byType[t] ?? 0) + 1;

    // dataProvenance is a SELF-DECLARED tier ('curated' means a human typed the
    // row), not an official citation. It is reported, never counted as evidence.
    const prov = r.dataProvenance ?? 'unset';
    byProvenance[prov] = (byProvenance[prov] ?? 0) + 1;
    b[prov] = (b[prov] ?? 0) + 1;

    idSeen.set(r.id, (idSeen.get(r.id) ?? 0) + 1);

    // STABLE IDENTITY — the campaign's §6. A record with no FIPS/GEOID cannot be
    // matched by identity, only by name, and name matching is exactly what the
    // resolver is no longer allowed to do.
    const hasIdentity = !!(r.placeGeoid || r.countyFips || r.countySubdivisionGeoid || r.stateFips);
    if (!hasIdentity) identityGaps.push(r.id);

    // OFFICIAL SOURCE — a URL a reviewer can open. `website` is a contact link
    // and counts; `dataProvenance` does NOT, because it cites nothing.
    const hasOfficialSource = !!(r.codeSourceUrl || r.website);
    if (!hasOfficialSource) { officialSourceGaps.push(r.id); b.noOfficialSource++; }

    // CODE EVIDENCE — a bare necVersion is a claim, not an adoption ordinance.
    if (!(r.codeSourceUrl && r.codeRetrievedAtIso)) codeEvidenceGaps.push(r.id);

    // PLACEHOLDER AUTHORITIES — see the header note.
    if (isDefaulted(r, 'permitAuthority')) {
      permitAuthorityDefaulted.push(r.id);
      b.permitAuthorityUnestablished++;
    }
    if (isDefaulted(r, 'inspectionAuthority')) inspectionAuthorityDefaulted.push(r.id);

    // No phone, no website, no address, no email — nothing to contact or verify.
    if (!r.phone && !r.website && !r.address && !r.email) contactless.push(r.id);

    // Rows standing for county territory rather than a municipality.
    if (String(r.city ?? '').trim().toLowerCase() === 'unincorporated') unincorporatedRows.push(r.id);

    // AMBIGUOUS IDENTITY — two rows a name-based matcher could confuse.
    const key = `${st}|${String(r.ahjName ?? '').toUpperCase().trim()}`;
    collisions.set(key, [...(collisions.get(key) ?? []), r.id]);
  }

  const dupIds = [...idSeen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const nameCollisions = [...collisions.entries()].filter(([, v]) => v.length > 1);

  return {
    generatedBy: 'scripts/ahj-audit-national.mjs',
    referenceDenominators: CENSUS_2022,
    totals: {
      records: records.length,
      byType,
      byDataProvenance: byProvenance,
      statesWithRecords: byState.size,
    },
    legalGovernmentCoverage: {
      note: 'DENOMINATOR IS MEANINGFUL: every county and municipality is a legal government. '
        + 'This measures whether we hold ANY row for them — not whether that row is correct, '
        + 'and not whether that government is the permitting authority.',
      countiesHeld: byType.county ?? 0,
      countyDenominator: CENSUS_2022.countyAndEquivalentAreas,
      countyCoverage: pct(byType.county ?? 0, CENSUS_2022.countyAndEquivalentAreas),
      municipalitiesHeld: byType.city ?? 0,
      municipalDenominator: CENSUS_2022.municipalGovernments,
      municipalCoverage: pct(byType.city ?? 0, CENSUS_2022.municipalGovernments),
      townshipsHeld: 0,
      townshipDenominator: CENSUS_2022.townshipGovernments,
      townshipCoverage: pct(0, CENSUS_2022.townshipGovernments),
      townshipNote: 'AhjRecord has no county-subdivision type. In the ~20 MCD states a township '
        + 'can be the real building authority; we hold zero rows for any of them.',
    },
    permittingAuthorityCoverage: {
      note: 'DENOMINATOR IS NOT KNOWN. Not every municipality administers its own building '
        + 'department and some special districts do. No percentage is reported, by design.',
      rowsHeld: records.length,
      rowsNamingASpecificPermitAuthority: records.length - permitAuthorityDefaulted.length,
      rowsWithPlaceholderPermitAuthority: permitAuthorityDefaulted.length,
      rowsWithPlaceholderInspectionAuthority: inspectionAuthorityDefaulted.length,
      rowsWithOfficialSourceUrl: records.length - officialSourceGaps.length,
      placeholderNote: 'A row whose permitAuthority is the helper default '
        + `"${HELPER_DEFAULTS.permitAuthority}" names no authority at all.`,
    },
    remediation: {
      recordsWithoutStableIdentity: identityGaps.length,
      recordsWithoutOfficialSourceUrl: officialSourceGaps.length,
      recordsWithoutCodeAdoptionEvidence: codeEvidenceGaps.length,
      recordsWithNoContactChannel: contactless.length,
      recordsStandingForUnincorporatedTerritory: unincorporatedRows.length,
      duplicateIds: dupIds.length,
      duplicateIdExamples: dupIds.slice(0, 10),
      ambiguousNameGroups: nameCollisions.length,
      ambiguousNameExamples: nameCollisions.slice(0, 10).map(([k, v]) => ({ key: k, ids: v })),
    },
    byState: Object.fromEntries([...byState.entries()].sort().map(([k, v]) => [k, {
      ...v,
      legalDenominator: 'UNKNOWN — per-state Census counts are not embedded; national totals only',
    }])),
  };
}

const records = await loadRecords();
const report = audit(records);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const r = report;
  console.log('═══ SOLARPRO NATIONAL AHJ COVERAGE AUDIT ═══');
  console.log(`records: ${r.totals.records}   states with records: ${r.totals.statesWithRecords}`);
  console.log(`by type:       ${JSON.stringify(r.totals.byType)}`);
  console.log(`by provenance: ${JSON.stringify(r.totals.byDataProvenance)}  (self-declared tier, not a citation)`);
  console.log('');
  console.log('── LEGAL-GOVERNMENT COVERAGE (denominator is meaningful) ──');
  const L = r.legalGovernmentCoverage;
  console.log(`  counties      ${String(L.countiesHeld).padStart(6)} / ${L.countyDenominator}   ${L.countyCoverage}`);
  console.log(`  municipalities${String(L.municipalitiesHeld).padStart(6)} / ${L.municipalDenominator}   ${L.municipalCoverage}`);
  console.log(`  townships     ${String(L.townshipsHeld).padStart(6)} / ${L.townshipDenominator}   ${L.townshipCoverage}`);
  console.log(`  source: ${r.referenceDenominators.citation}`);
  console.log('');
  console.log('── PERMITTING-AUTHORITY COVERAGE (no percentage: see note) ──');
  const P = r.permittingAuthorityCoverage;
  console.log(`  rows held                          ${P.rowsHeld}`);
  console.log(`  naming a specific permit authority ${P.rowsNamingASpecificPermitAuthority}`);
  console.log(`  carrying the PLACEHOLDER authority ${P.rowsWithPlaceholderPermitAuthority}`);
  console.log(`  placeholder inspection authority   ${P.rowsWithPlaceholderInspectionAuthority}`);
  console.log(`  with an official source URL        ${P.rowsWithOfficialSourceUrl}`);
  console.log('');
  console.log('── REMEDIATION QUEUE ──');
  const M = r.remediation;
  console.log(`  no stable legal-geography identity  ${M.recordsWithoutStableIdentity}`);
  console.log(`  no official source URL              ${M.recordsWithoutOfficialSourceUrl}`);
  console.log(`  no code-adoption evidence           ${M.recordsWithoutCodeAdoptionEvidence}`);
  console.log(`  no contact channel at all           ${M.recordsWithNoContactChannel}`);
  console.log(`  stand for unincorporated territory  ${M.recordsStandingForUnincorporatedTerritory}`);
  console.log(`  duplicate ids                       ${M.duplicateIds}`);
  console.log(`  ambiguous (state, ahjName) groups   ${M.ambiguousNameGroups}`);
  for (const ex of M.ambiguousNameExamples) console.log(`      ${ex.key}  ->  ${ex.ids.join(', ')}`);
  console.log('');
  const top = Object.entries(r.byState).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  console.log('── TOP STATES BY RECORD COUNT ──');
  for (const [st, v] of top) {
    console.log(`  ${st}  total ${String(v.total).padStart(4)}  city ${String(v.city ?? 0).padStart(4)}`
      + `  county ${String(v.county ?? 0).padStart(3)}  placeholder-authority ${String(v.permitAuthorityUnestablished).padStart(4)}`);
  }
}
