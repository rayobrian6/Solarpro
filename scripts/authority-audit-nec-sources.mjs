// ═══════════════════════════════════════════════════════════════════════════
// EVERY PRODUCER THAT CAN SUPPLY AN NEC EDITION — §3 inventory.
//
//   npm run authority:audit-nec-sources
//
// READ-ONLY. The end state is ONE canonical NEC resolver, but nothing may be
// retired before this proves what each producer uniquely holds. A table that
// looks redundant can be the only source of a live value.
//
// The question for each producer is not "does it have NEC years" but:
//   can it produce an EDITION?  ADOPTION EVIDENCE?  AMENDMENT STATUS?
// Only the first is common. The second is what separates a design basis from a
// governed adoption, and no producer in this repo has ever had it.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync } from 'node:fs';

const AN = await import('../lib/jurisdictions/ahj-national.ts');
const NV = await import('../lib/jurisdictions/necVersions.ts');
const JD = await import('../lib/jurisdiction.ts');

const norm = v => { const m = String(v ?? '').match(/(20\d{2})/); return m ? m[1] : null; };

// ── the producers, described by what they can actually establish ──────────
const PRODUCERS = [
  {
    id: 'ahj-national.necVersion',
    module: 'lib/jurisdictions/ahj-national.ts',
    dataset: 'curated + bulk-expanded AHJ rows',
    authorityLevel: 'municipal/county (claimed)',
    canProduceEdition: true, canProduceAdoptionEvidence: false, canProduceAmendmentStatus: false,
    precedence: 'fallback metadata only — never adopts (A.4)',
    note: 'per-row year with no ordinance, no URL, no date. 0/4,016 provenanced.',
  },
  {
    id: 'necVersions.JURISDICTION_DATA',
    module: 'lib/jurisdictions/necVersions.ts',
    dataset: 'NFPA state adoption tracker, 51 jurisdictions + city/county overrides',
    authorityLevel: 'state',
    canProduceEdition: true, canProduceAdoptionEvidence: false, canProduceAmendmentStatus: false,
    precedence: 'state-adoption-table tier — stated DESIGN BASIS, never verified',
    note: 'JurisdictionData carries NO sourceUrl/retrievedAt/effectiveDate/adoptedDate field at all.',
  },
  {
    id: 'jurisdiction.STATE_NEC_ADOPTION',
    module: 'lib/jurisdiction.ts',
    dataset: 'a SECOND per-state NEC table',
    authorityLevel: 'state',
    canProduceEdition: true, canProduceAdoptionEvidence: false, canProduceAmendmentStatus: false,
    precedence: 'not consulted by codeAuthority',
    note: 'duplicate of the above by purpose; disagreements are invisible to the permit path.',
  },
  {
    id: 'ahjRegistry (SunSpec/Orange Button)',
    module: 'lib/jurisdictions/ahjRegistry.ts',
    dataset: 'live registry retrieval, token-gated',
    authorityLevel: 'municipal/county',
    canProduceEdition: true, canProduceAdoptionEvidence: true, canProduceAmendmentStatus: false,
    precedence: 'HIGHEST — ahj-registry-retrieval',
    note: 'the ONLY producer that can carry adoption evidence. Returns NOT_CONFIGURED without AHJ_REGISTRY_TOKEN.',
  },
  {
    id: 'compliance.jurisdiction.necVersion',
    module: 'project record (client/route)',
    dataset: 'per-project field',
    authorityLevel: 'unknown',
    canProduceEdition: true, canProduceAdoptionEvidence: false, canProduceAmendmentStatus: false,
    precedence: 'project-record-unprovenanced (was falsely operator-entry until c4f6b397)',
    note: 'the route no longer fabricates it; a value here now means something actually set it.',
  },
  {
    id: 'computed-plan AHJ table',
    module: 'lib/computed-plan.ts',
    dataset: 'a second ~10-entry AHJ table',
    authorityLevel: 'unknown',
    canProduceEdition: true, canProduceAdoptionEvidence: false, canProduceAmendmentStatus: false,
    precedence: 'independent of codeAuthority',
    note: 'contains an id (il-icc) absent from ahj-national. Not yet consumer-mapped.',
  },
];

// ── conflicts: where two producers disagree for the same jurisdiction ─────
const conflicts = [];
for (const r of AN.AHJ_NATIONAL) {
  const rowEd = norm(r.necVersion);
  let stateEd = null, altEd = null;
  try { stateEd = norm(NV.getJurisdiction(r.stateCode, r.county ?? undefined, r.city ?? undefined)?.necVersion); } catch {}
  try {
    const alt = JD.STATE_NEC_ADOPTION ?? null;
    altEd = alt ? norm(typeof alt === 'object' ? alt[r.stateCode]?.necVersion ?? alt[r.stateCode] : null) : null;
  } catch {}
  const seen = [['ahj-national', rowEd], ['necVersions', stateEd], ['jurisdiction.ts', altEd]]
    .filter(([, v]) => v);
  const distinct = new Set(seen.map(([, v]) => v));
  if (distinct.size > 1) {
    conflicts.push({
      jurisdictionId: r.id, state: r.stateCode, name: r.ahjName,
      ahjNational: rowEd ?? '', necVersions: stateEd ?? '', jurisdictionTs: altEd ?? '',
      distinctValues: [...distinct].join('|'),
      whichShips: 'necVersions (state-adoption-table) — ahj-national is fallback-only and never adopts',
    });
  }
}

mkdirSync('data/authority', { recursive: true });
writeFileSync('data/authority/nec-source-inventory.json', JSON.stringify({
  producers: PRODUCERS,
  producersWithAdoptionEvidence: PRODUCERS.filter(p => p.canProduceAdoptionEvidence).map(p => p.id),
  conflictCount: conflicts.length,
}, null, 2));
if (conflicts.length) {
  const cols = Object.keys(conflicts[0]);
  writeFileSync('data/authority/nec-source-conflicts.csv',
    [cols.join(','), ...conflicts.map(c => cols.map(k => `"${String(c[k]).replace(/"/g, '""')}"`).join(','))].join('\n') + '\n');
}

console.log('═══ NEC PRODUCER INVENTORY (§3) ═══');
console.log(`producers inventoried: ${PRODUCERS.length}`);
console.log('');
for (const p of PRODUCERS) {
  console.log(`  ${p.id}`);
  console.log(`      edition=${p.canProduceEdition ? 'Y' : 'n'}  adoptionEvidence=${p.canProduceAdoptionEvidence ? 'Y' : 'n'}`
    + `  amendmentStatus=${p.canProduceAmendmentStatus ? 'Y' : 'n'}   [${p.authorityLevel}]`);
  console.log(`      ${p.note}`);
}
console.log('');
console.log(`PRODUCERS ABLE TO CARRY ADOPTION EVIDENCE: `
  + `${PRODUCERS.filter(p => p.canProduceAdoptionEvidence).length} `
  + `(${PRODUCERS.filter(p => p.canProduceAdoptionEvidence).map(p => p.id).join(', ') || 'none'})`);
console.log(`JURISDICTIONS WHERE PRODUCERS DISAGREE:    ${conflicts.length}`);
console.log('');
console.log('artifacts: data/authority/nec-source-{inventory.json,conflicts.csv}');
