// ═══════════════════════════════════════════════════════════════════════════
// braidon-rgm-regen.ts — RGM acceptance generator (2026-07-26).
//
//   Usage: tsx scripts/braidon-rgm-regen.ts [outBase] [--insufficient|--identity]
//     -> <outBase>.html + <outBase>.snapshot.json
//
// Emits the rendered packages the 17 permanent gates of
// docs/RELEASE-GATE-MODEL-DIRECTIVE.md are evaluated against. All three are
// produced by generatePermitHTML through the PUBLIC API — no snapshot is
// injected, no HTML is patched, and no authority is fabricated:
//
//   1. FIXTURE       — the immutable tests/fixtures/braidon-original-audit-fixture.
//                      15 unresolved requirements over all SEVEN root gates.
//
//   2. INSUFFICIENT  — the same frozen design with the PPC harness's documented,
//                      clearly-synthetic Q-Cable service-loop allowance threaded
//                      in as a snapshot authority. A documented allowance can
//                      only RAISE the sufficiency threshold (stricter-only), so it
//                      trips QCABLE-PROCUREMENT-INSUFFICIENT — a VERIFIED
//                      DEFICIENCY. That makes the CONFIRMED-condition surfaces
//                      non-vacuous: the `strong` treatment class on RS-1 and the
//                      cover's "MOST SEVERE CONFIRMED CONDITION" line.
//
//   3. IDENTITY      — the same frozen design with the project IDENTITY fields set
//                      to the state Ray's real Braidon record is in: a
//                      non-production ("… Solar TEST") project name and no
//                      assigned designer of record. These are pure INPUT-DATA
//                      states that only ADD requirements (PROJECT-NAME-
//                      NONPRODUCTION + DESIGNER-OF-RECORD-MISSING), never clear
//                      one, and they exercise the ADMINISTRATIVE_HOLD treatment
//                      class and gate 8 (an administrative hold must never be
//                      labelled an engineering failure). Nothing is verified,
//                      approved, selected or measured by this mode.
// ═══════════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'fs';
import { generatePermitHTML } from '../lib/permit/index';
import { braidonOriginalAuditFixture } from '../tests/fixtures/braidon-original-audit-fixture';
import type { SnapshotAuthorityInputs } from '../lib/permit/snapshot/authorityInputs';

/** SYNTHETIC, clearly-labelled, STRICTER-ONLY allowance authority (as PPC). */
const SYNTHETIC_ALLOWANCE_AUTHORITY: SnapshotAuthorityInputs = {
  capacityDocument: null,
  projectJurisdiction: null,
  manufacturerDocumentsArchived: null,
  digestInvalidatedByLedger: false,
  framingCapacityDocument: null,
  framingProjectApplicabilityKey: null,
  cableExtensionSolutions: [],
  qcableServiceLoopAllowance: {
    allowanceFt: 26,
    documentId: 'SYNTHETIC-RGM-ALLOWANCE-0001 (TEST HARNESS RECORD — NOT REAL MANUFACTURER EVIDENCE)',
    note: 'Synthetic service-loop / transition allowance used ONLY to exercise the CONFIRMED-condition '
      + 'release surfaces non-vacuously. Raises the threshold; grants nothing.',
    provenance: 'rgm-harness-synthetic-allowance-authority',
  },
  environmentalSource: null,
};

function main(): void {
  const args = process.argv.slice(2);
  const insufficient = args.includes('--insufficient');
  const identity = args.includes('--identity');
  const outBase = args.find(a => !a.startsWith('--')) || '_tmp_braidon_rgm';

  // Deep clone so the imported immutable fixture is never mutated in place.
  const input: any = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
  if (identity) {
    // ONLY-ADDITIVE input state: a non-production name and an unassigned
    // designer. Both make the package MORE blocked; neither clears anything.
    input.project = input.project ?? {};
    input.project.projectName = `${input.project.projectName ?? 'BRAIDON M PILLA'} — Solar TEST`;
    input.project.designer = '';
  }
  const html = generatePermitHTML(input, undefined, insufficient ? SYNTHETIC_ALLOWANCE_AUTHORITY : null);

  const htmlOut = outBase.endsWith('.html') ? outBase : `${outBase}.html`;
  writeFileSync(htmlOut, html);
  const snap = input._snapshot;
  if (!snap) {
    console.error('[rgm-regen] NO snapshot attached — FAIL');
    process.exit(1);
  }
  writeFileSync(htmlOut.replace(/\.html$/, '') + '.snapshot.json',
    JSON.stringify({ ...snap, _violations: input._snapshotViolations ?? [] }, null, 2));

  const registry = (snap.permitReadiness.registry ?? []).filter((r: any) => !r.resolved);
  const mode = identity ? 'IDENTITY' : insufficient ? 'INSUFFICIENT' : 'FIXTURE';
  console.log(`[rgm-regen] mode=${mode} wrote ${htmlOut} (${(html.length / 1024).toFixed(0)}KB)`);
  console.log(`[rgm-regen] snapshot ${snap.meta.snapshotId} digest ${snap.meta.digest.slice(0, 16)}…`);
  console.log(`[rgm-regen] registry ${registry.filter((r: any) => r.severity === 'blocking').length} blocking / `
    + `${registry.filter((r: any) => r.severity !== 'blocking').length} advisory`);
}

main();
