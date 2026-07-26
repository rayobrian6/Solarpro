// ═══════════════════════════════════════════════════════════════════════════
// braidon-ppc-regen.ts — PPC acceptance generator (2026-07-26).
//
// Emits the TWO rendered packages the 18 permanent gates of
// docs/PROJECTION-PROCUREMENT-CORRECTIVE-DIRECTIVE.md are evaluated against:
//
//   1. FIXTURE      — the immutable tests/fixtures/braidon-original-audit-fixture
//                     (zero mutable DB rows). The frozen acceptance package.
//   2. INSUFFICIENT — the SAME frozen design, generated through the PUBLIC API with
//                     a DOCUMENTED Q-Cable service-loop allowance threaded in as a
//                     snapshot authority. Audit §0 established that the frozen
//                     fixture does NOT trip QCABLE-PROCUREMENT-INSUFFICIENT
//                     (Σ designed 140.5 ft vs procurement 152 ft), so §2's deficit
//                     component and all of §9 / gates 12 / 13 would pass VACUOUSLY
//                     on it. The allowance authority is the honest lever: the
//                     sufficiency contract already states that a documented
//                     allowance RAISES the threshold (STRICTER-only — it can never
//                     clear a deficit). 26 ft ⇒ threshold 166.5 ft vs procurement
//                     152 ft ⇒ a 14.5 ft deficit, the same figure the live design
//                     carries.
//
//                     The allowance record is SYNTHETIC and says so in its own
//                     documentId. It fabricates NO permission: it cannot clear a
//                     blocker, select a cable extension, authorise a fastener, or
//                     verify a document. The frozen fixture is never modified and
//                     no snapshot is injected or patched — package 2 is produced by
//                     generatePermitHTML exactly like package 1.
//
//   Usage: tsx scripts/braidon-ppc-regen.ts [outBase] [--insufficient]
//     -> <outBase>.html + <outBase>.snapshot.json
// ═══════════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'fs';
import { generatePermitHTML } from '../lib/permit/index';
import { braidonOriginalAuditFixture } from '../tests/fixtures/braidon-original-audit-fixture';
import type { SnapshotAuthorityInputs } from '../lib/permit/snapshot/authorityInputs';

/** SYNTHETIC, clearly-labelled, STRICTER-ONLY allowance authority. */
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
    documentId: 'SYNTHETIC-PPC-ALLOWANCE-0001 (TEST HARNESS RECORD — NOT REAL MANUFACTURER EVIDENCE)',
    note: 'Synthetic service-loop / transition allowance used ONLY to exercise the '
      + 'procurement-insufficiency gates non-vacuously. Raises the threshold; grants nothing.',
    provenance: 'ppc-harness-synthetic-allowance-authority',
  },
  environmentalSource: null,
};

function main(): void {
  const args = process.argv.slice(2);
  const insufficient = args.includes('--insufficient');
  const outBase = args.find(a => !a.startsWith('--')) || '_tmp_braidon_ppc';

  // Deep clone so the imported immutable fixture is never mutated in place.
  const input: any = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
  const html = generatePermitHTML(input, undefined, insufficient ? SYNTHETIC_ALLOWANCE_AUTHORITY : null);

  const htmlOut = outBase.endsWith('.html') ? outBase : `${outBase}.html`;
  writeFileSync(htmlOut, html);
  const snap = input._snapshot;
  if (!snap) {
    console.error('[ppc-regen] NO snapshot attached — FAIL');
    process.exit(1);
  }
  const snapOut = htmlOut.replace(/\.html$/, '') + '.snapshot.json';
  writeFileSync(snapOut, JSON.stringify({ ...snap, _violations: input._snapshotViolations ?? [] }, null, 2));

  const ps = snap.electrical.procurementSufficiency;
  const registry = (snap.permitReadiness.registry ?? []).filter((r: any) => !r.resolved);
  console.log(`[ppc-regen] mode=${insufficient ? 'INSUFFICIENT' : 'FIXTURE'} wrote ${htmlOut} `
    + `(${(html.length / 1024).toFixed(0)}KB) + ${snapOut}`);
  console.log(`[ppc-regen] snapshot ${snap.meta.snapshotId} digest ${snap.meta.digest.slice(0, 16)}…`);
  console.log(`[ppc-regen] blockers ${registry.filter((r: any) => r.severity === 'blocking').length} blocking / `
    + `${registry.filter((r: any) => r.severity !== 'blocking').length} advisory`);
  console.log(`[ppc-regen] procurement: designed ${ps?.totalDesignedInstalledFt} ft + allowance `
    + `${ps?.requiredServiceLoopAllowanceFt} ft = threshold ${ps?.thresholdFt} ft vs procurement `
    + `${ps?.procurementLengthFt} ft ⇒ insufficient=${ps?.insufficient} deficit=${ps?.deficitFt} ft`);
  if (insufficient && !ps?.insufficient) {
    console.error('[ppc-regen] the INSUFFICIENT package did NOT trip the deficit — the gates would be vacuous. FAIL');
    process.exit(1);
  }
  if (!insufficient && ps?.insufficient) {
    console.error('[ppc-regen] the FROZEN FIXTURE package tripped the deficit — the frozen baseline changed. FAIL');
    process.exit(1);
  }
}
main();
