// ═══════════════════════════════════════════════════════════════════════════
// EVERY RENDERED SENTENCE THAT CLAIMS AUTHORITY — §12.
//
//   npm run authority:audit-rendered-claims
//
// A planset sentence that says "PER AHJ", "REQUIRED", "ADOPTED BY" or "OPERATOR
// ENTERED" is a claim about who has authority. Each one must trace to a
// canonical requirement or be explicitly classified as something weaker.
//
// This audits the ARTIFACT, not the source. Two defects this campaign found
// were invisible in source and visible only in the rendered output: the NEC
// operator attribution, and my own explanatory comment leaking into the sheet
// from inside a template literal.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const ART = '_tmp_prod.html';
if (!existsSync(ART)) { console.log(`no artifact at ${ART} — run the generator first`); process.exit(0); }
const html = readFileSync(ART, 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

// Phrases that assert authority. Each carries the classification the campaign
// has established for it, with the evidence.
const PATTERNS = [
  ['PER AHJ',            /PER AHJ/gi,                          'see per-occurrence'],
  ['AHJ REQUIRES',       /AHJ REQUIRES/gi,                     'MISATTRIBUTED if present'],
  ['REQUIRED BY AHJ',    /REQUIRED BY AHJ/gi,                  'MISATTRIBUTED if present'],
  ['ADOPTED BY',         /ADOPTED BY/gi,                       'needs adoption evidence'],
  ['OPERATOR ENTERED',   /(OPERATOR[- ]ENTERED|ENTERED BY (THE )?OPERATOR|entered for this project by the operator)/gi, 'MISATTRIBUTED unless a real operator'],
  ['PE STAMP REQUIRED',  /PE STAMP REQUIRED/gi,                'MISATTRIBUTED — contained N24/N32'],
  ['PER UTILITY',        /PER UTILITY|UTILITY REQUIRES/gi,     'utility rule, not an AHJ rule'],
  ['PER LOCAL CODE',     /PER LOCAL CODE|LOCAL REQUIREMENT/gi, 'needs local adoption evidence'],
  ['MANDATED',           /MANDATED/gi,                         'needs an authority'],
  // the honest classifications the campaign introduced — presence is GOOD
  ['MODELED (honest)',   /MODELED|PROVISIONAL|PENDING AHJ|edition pending|DESIGN BASIS/gi, 'SOLARPRO/MODELED — honest'],
  ['SOLARPRO POLICY',    /REQUIRED BY SOLARPRO|SOLARPRO/gi,    'SOLARPRO_POLICY — honest'],
  ['VERIFIED SOURCE',    /\[VERIFIED SOURCE\]|VERIFIED/gi,     'SUPPORTED — check upstream'],
];

// ── ASSERTION vs QUALIFICATION ──────────────────────────────────────────
// A phrase is only a CLAIM when the sheet asserts it. The same words used
// conditionally or to DOWNGRADE evidence are honest, and a first version of this
// audit flagged both as misattribution:
//   "(if required by AHJ)"            — a conditional, not an assertion
//   "Operator-entered values are an OBSERVATION/OVERRIDE and can never clear
//    this" — labelling operator input as WEAK, which is the correct treatment
// An audit that cries wolf gets ignored, so these are excluded by context.
const QUALIFIED = [
  /\(\s*if\s+required\s+by\s+AHJ/i,
  /operator[- ]entered[^.]{0,80}(observation|override|never clear|not capacity)/i,
  /(observation|override|not capacity)[^.]{0,80}operator[- ]entered/i,
];
function assertionCount(re) {
  let n = 0;
  for (const m of text.matchAll(re)) {
    const ctx = text.slice(Math.max(0, m.index - 120), m.index + 140);
    if (!QUALIFIED.some(q => q.test(ctx))) n++;
  }
  return n;
}

const rows = [];
for (const [label, re, note] of PATTERNS) {
  const total = (text.match(re) ?? []).length;
  const asserted = assertionCount(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  rows.push({ claim: label, occurrences: total, asserted, qualified: total - asserted, classification: note });
}

mkdirSync('data/authority', { recursive: true });
const cols = ['claim', 'occurrences', 'asserted', 'qualified', 'classification'];
writeFileSync('data/authority/rendered-authority-claims.csv',
  [cols.join(','), ...rows.map(r => cols.map(c => `"${r[c]}"`).join(','))].join('\n') + '\n');

console.log('═══ RENDERED AUTHORITY CLAIMS (artifact, not source) ═══');
for (const r of rows) {
  const flag = r.asserted > 0 && /MISATTRIBUTED/.test(r.classification) ? '  ⚠' : '';
  console.log(`  ${String(r.occurrences).padStart(4)} total ${String(r.asserted).padStart(3)} asserted  ${r.claim.padEnd(22)} ${r.classification}${flag}`);
}
const bad = rows.filter(r => r.asserted > 0 && /MISATTRIBUTED/.test(r.classification));
console.log('');
console.log(`MATERIAL FALSE-ATTRIBUTION PHRASES PRESENT: ${bad.length}`);
console.log('artifact: data/authority/rendered-authority-claims.csv');
