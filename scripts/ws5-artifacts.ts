// ═══════════════════════════════════════════════════════════════════════════
// ws5-artifacts.ts — WS-5 closure artifacts.
//
// Regenerates the frozen Braidon fixture at all THREE planset profiles with NO
// field-measurement authority (the honest production state for a project nobody
// has measured), and — separately, into differently-named files — the CONTROLLED
// reachability fixture at three field-authority stages so the sheet projections
// can be inspected visually rather than only asserted.
//
// The Braidon artifacts must show ROUTE-LENGTH-ESTIMATE OPEN and every
// length-dependent conclusion graded PROVISIONAL. The controlled artifacts show
// what the same sheets look like once a measurement is recorded and then
// verified. They are never mixed: the file names say which is which.
//
//   Usage: tsx scripts/ws5-artifacts.ts [outDir]
// ═══════════════════════════════════════════════════════════════════════════
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { generatePermitHTML } from '../lib/permit/index';
import { braidonOriginalAuditFixture } from '../tests/fixtures/braidon-original-audit-fixture';
import { buildFieldMeasurementAuthority } from '../lib/fieldMeasurement/resolver';
import type { FieldRouteMeasurement } from '../lib/fieldMeasurement/types';

const OUT = process.argv[2] || '_tmp_ws5';
mkdirSync(OUT, { recursive: true });

const PROFILES = ['design-review', 'permit', 'full'] as const;

function render(profile: string, authority: unknown, tag: string) {
  const input: any = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
  input.generatedAtIso = '2026-08-02T12:00:00Z';
  input.plansetProfile = profile;
  const html = generatePermitHTML(input, undefined, authority as never);
  const base = join(OUT, `${tag}_${profile}`);
  writeFileSync(`${base}.html`, html);
  const snap = input._snapshot;
  if (!snap) { console.error(`[ws5-artifacts] ${tag}/${profile}: NO snapshot attached — FAIL`); process.exit(1); }
  writeFileSync(`${base}.snapshot.json`,
    JSON.stringify({ ...snap, _violations: input._snapshotViolations ?? [] }, null, 2));

  const segs = snap.electrical.routeSegments ?? [];
  const blockers = (snap.permitReadiness?.blockers ?? []).map((b: any) => b.code);
  const pages = (html.match(/<div class="page"[ >]/g) ?? []).length;
  console.log(
    `[ws5-artifacts] ${tag}/${profile}: ${pages} sheets | snapshot ${snap.meta.snapshotId} `
    + `| ROUTE-LENGTH-ESTIMATE ${blockers.includes('ROUTE-LENGTH-ESTIMATE') ? 'OPEN' : 'CLOSED'} `
    + `| blockers ${blockers.length}`,
  );
  for (const s of segs) {
    console.log(
      `    ${s.segmentId.padEnd(24)} src=${String(s.lengthSource).padEnd(22)} state=${String(s.verificationState).padEnd(22)} `
      + `calc=${s.calculationLengthFt ?? '—'} proc=${s.procurementLengthFt ?? '—'} vd=${s.voltageDropPct == null ? '—' : s.voltageDropPct.toFixed(4)} `
      + `applic=${s.routeAuthorityApplicability}`,
    );
  }
  return { pages, blockers, snapshotId: snap.meta.snapshotId, digest: snap.meta.digest };
}

// ── 1. BRAIDON — the live truth-state. NO measurements, ever. ───────────────
console.log('\n═══ BRAIDON (no field measurements — the honest production state) ═══');
const braidon: Record<string, unknown> = {};
for (const p of PROFILES) braidon[p] = render(p, undefined, 'braidon');

// ── 2. THE CONTROLLED FIXTURE — reported, then verified. ───────────────────
// A synthetic project identity; these files are named `controlled_*` and are
// NOT Braidon artifacts. The measurements below exist only to render the
// projections; they are never written to any store.
const TENANT = 'org:11111111-1111-4111-8111-111111111111';
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-08-02T12:00:00.000Z';
const RESIDUAL = ['ROOF_RUN', 'BRANCH_HOMERUN_RUN', 'COMBINER_TO_DISCO_RUN', 'DISCO_TO_METER_RUN'];

const measurement = (segmentId: string, ft: number, verified: boolean): FieldRouteMeasurement => ({
  id: `c0000000-0000-4000-8000-${segmentId.length.toString().padStart(12, '0')}`,
  tenantId: TENANT, tenantOrganizationId: '11111111-1111-4111-8111-111111111111',
  projectId: PROJECT, routeSegmentId: segmentId,
  measuredLengthFt: ft, measurementMethod: 'LASER',
  measuredByUserId: 'a0000000-0000-4000-8000-000000000003',
  measuredAt: '2026-08-02T09:30:00.000Z', recordedAt: NOW,
  evidenceAttachmentIds: ['aa000000-0000-4000-8000-00000000000a'], notes: null,
  verificationState: verified ? 'VERIFIED' : 'REPORTED_UNVERIFIED',
  verificationMode: verified ? 'INDEPENDENT_REVIEW' : null,
  verifiedByUserId: verified ? 'a0000000-0000-4000-8000-000000000002' : null,
  verifiedAt: verified ? NOW : null,
  verificationNotes: verified ? 'independently re-measured with a wheel' : null,
  evidenceExceptionReason: null,
  rejectedByUserId: null, rejectedAt: null, rejectionReason: null,
  supersedesMeasurementId: null, supersededByMeasurementId: null,
  createdAt: NOW, updatedAt: NOW,
});

console.log('\n═══ CONTROLLED FIXTURE — FIELD REPORTED (unverified) ═══');
const reportedAuthority = buildFieldMeasurementAuthority(
  RESIDUAL.map((id, i) => measurement(id, 87 + i, false)),
);
render('full', { fieldRouteMeasurements: reportedAuthority }, 'controlled-reported');

console.log('\n═══ CONTROLLED FIXTURE — FIELD VERIFIED ═══');
const verifiedAuthority = buildFieldMeasurementAuthority(
  RESIDUAL.map((id, i) => measurement(id, 87 + i, true)),
);
render('full', { fieldRouteMeasurements: verifiedAuthority }, 'controlled-verified');

writeFileSync(join(OUT, 'ws5-summary.json'), JSON.stringify({ braidon }, null, 2));
console.log(`\n[ws5-artifacts] wrote artifacts to ${OUT}/`);
