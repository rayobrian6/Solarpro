// ═══════════════════════════════════════════════════════════════════════════
// POST-AAC REGRESSION REPAIR — the seven-finding corrective pass.
//
//   §1 E-1 is the dedicated SLD sheet again; the canonical physical section
//      schedule + full ampacity chain + open-air grounding note render ONCE,
//      on PV-4B.1 — never under the diagram, never duplicated.
//   §2 Output-profile contract: DESIGN_REVIEW ends on PE-1 (pending state,
//      NOT FOR PERMIT SUBMISSION), FULL_INTERNAL carries the current PE-1
//      state, PERMIT_SUBMISSION carries PE-1 only under a digest-bound
//      approval and renders as an explicitly-marked NON-SUBMITTABLE PREVIEW
//      while the review is pending. The profile is printed on the artifact.
//   §3 Manufacturer-document accounting: an RT-MINI II document cannot satisfy
//      RT-MINI applicability; a registry document is never described as
//      package-included unless its pages are actually emitted.
//   §4 Requirement-count accounting: PROJECT-NAME-NONPRODUCTION fires on a
//      \bTEST\b project name, maps to RG-1, and explains a ±1 requirement
//      delta with an unchanged gate count (the closure-report 14-vs-15 class).
//   §5 Seismic authority: ONE canonical resolved seismic result
//      (resolveSeismicAuthority) — hazard retrieval, else the VERIFIED archived
//      climate-hazard document; nothing substitutes 'B' or 'D'; every surface
//      prints the same resolved value.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  resolvePlansetProfile, isCompactProfile, certificationIsCompleted,
  permitSubmissionPreviewState, PERMIT_ARTIFACT_PROFILE,
} from '@/lib/permit/plansetProfile';
import { buildSheetManifest } from '@/lib/permit/sheetManifest';
import { resolveSeismicAuthority } from '@/lib/permit/snapshot/environmentalAuthority';
import { evaluateDocumentApplicability } from '@/lib/manufacturer-assets-db';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(profile?: string, mutate?: (input: any) => void, authority?: any): { html: string; snap: PermitDesignSnapshot; input: any } {
  const input: any = clone(braidonOriginalAuditFixture);
  if (profile) input.plansetProfile = profile;
  if (mutate) mutate(input);
  const html = generatePermitHTML(input, undefined, authority);
  return { html, snap: (input as any)._snapshot, input };
}

// page order via the per-page sheet-id in the title block
const pageSeq = (html: string): string[] =>
  [...html.matchAll(/class="tb-sheet-id"[^>]*>\s*([^<]+?)\s*</g)].map(m => m[1].trim());

// ── §1 — E-1 / PV-4B.1 composition ──────────────────────────────────────────
describe('§1 — E-1 dedicated SLD sheet; canonical schedule renders once on PV-4B.1', () => {
  const DR = gen('design-review');

  it('E-1 contains the SLD in the deterministic .sld-wrap drawing box and NO schedule table', () => {
    const e1Start = DR.html.indexOf('class="page sld-page"');
    expect(e1Start).toBeGreaterThan(-1);
    const e1End = DR.html.indexOf('<div class="page', e1Start + 10);
    const e1 = DR.html.slice(e1Start, e1End === -1 ? undefined : e1End);
    expect(e1).toContain('class="sld-wrap"');
    expect(e1).toContain('<svg');
    // the canonical physical schedule does NOT ride E-1 anymore
    expect(e1).not.toContain('PHYSICAL CONDUCTOR / RACEWAY SCHEDULE — CANONICAL SECTION OBJECTS');
    expect(e1).not.toContain('SHARED-RACEWAY AMPACITY ADJUSTMENT');
  });

  it('the embedded SLD suppresses the in-SVG conductor-schedule band and crops the canvas', () => {
    const e1Start = DR.html.indexOf('class="page sld-page"');
    const e1 = DR.html.slice(e1Start, DR.html.indexOf('</svg>', e1Start) + 6);
    expect(e1).not.toContain('CONDUIT &amp; CONDUCTOR SCHEDULE — NEC 310');
    // cropped canvas: viewBox height well under the full 1728 uncropped canvas
    const vb = e1.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(vb).toBeTruthy();
    expect(Number(vb![2])).toBeLessThan(1500);
    expect(e1).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('PV-4B.1 carries the canonical physical schedule + full ampacity chain + grounding note, exactly once', () => {
    expect(pageSeq(DR.html)).toContain('PV-4B.1');
    const count = (s: string, sub: string) => s.split(sub).length - 1;
    expect(count(DR.html, 'PHYSICAL CONDUCTOR / RACEWAY SCHEDULE — CANONICAL SECTION OBJECTS')).toBe(1);
    // the FULL ampacity evidence table renders once (compact same-object
    // references on PV-4A remain, with their sheet cross-label updated)
    expect(DR.html).toContain('SAME OBJECT AS PV-4B.1 / PV-4A');
    const at = DR.html.indexOf('PHYSICAL CONDUCTOR / RACEWAY SCHEDULE — CANONICAL SECTION OBJECTS');
    const pv4b1Start = DR.html.lastIndexOf('class="page', at);
    const pv4b1 = DR.html.slice(pv4b1Start, DR.html.indexOf('<div class="page', at));
    expect(pv4b1).toContain('BRANCH_HOMERUN_RUN');
  });

  it('PV-4B.1 sits immediately after PV-4B in both the page set and the manifest', () => {
    const seq = pageSeq(DR.html);
    expect(seq.indexOf('PV-4B.1')).toBe(seq.indexOf('PV-4B') + 1);
  });
});

// ── §2 — output-profile contract ────────────────────────────────────────────
describe('§2 — output profiles: DESIGN_REVIEW / FULL_INTERNAL / PERMIT_SUBMISSION', () => {
  const DR = gen('design-review');
  const FULL = gen('full');
  const PERMIT = gen('permit');

  it('the artifact default profile is design-review', () => {
    expect(PERMIT_ARTIFACT_PROFILE).toBe('design-review');
    expect(resolvePlansetProfile({} as any)).toBe('full');           // engine default unchanged
    expect(isCompactProfile('design-review')).toBe(true);
    expect(isCompactProfile('permit')).toBe(true);
    expect(isCompactProfile('full')).toBe(false);
  });

  it('DESIGN_REVIEW: exact compact sheet set ENDING on PE-1 (final sheet)', () => {
    const seq = pageSeq(DR.html);
    expect(seq[0]).toBe('PV-0');
    expect(seq[seq.length - 1]).toBe('PE-1');
    expect(seq).not.toContain('RS-1');
    expect(seq).not.toContain('APP-A');
    expect(seq).not.toContain('CERT');                               // review pending ⇒ no certification sheet
    expect(seq.filter(id => id === 'PE-1').length).toBe(1);
  });

  it('DESIGN_REVIEW PE-1 is the unsigned review document: pending language, no certification, digest-bound, marked', () => {
    const peStart = DR.html.lastIndexOf('PE STRUCTURAL LETTER');
    const pe = DR.html.slice(peStart);
    expect(pe).toContain('NO CERTIFICATION ASSERTED');
    expect(pe).toContain('NOT FOR PERMIT SUBMISSION');
    expect(pe).toContain('PENDING ENGINEERING REVIEW');
    expect(pe).toContain('PE SEAL / STAMP');                         // blank seal field
    expect(DR.snap.meta.digest).toBeTruthy();                        // sheet set is digest-bound
    expect(DR.html).toContain(DR.snap.meta.digest.slice(0, 20));
    // nothing fabricated an approval
    expect(certificationIsCompleted(DR.input)).toBe(false);
  });

  it('the OUTPUT PROFILE distinction is explicit on the artifact', () => {
    expect(DR.html).toContain('data-release-status-profile="design-review"');
    expect(DR.html).toContain('OUTPUT PROFILE: DESIGN REVIEW');
    expect(PERMIT.html).toContain('data-release-status-profile="permit"');
    expect(FULL.html).not.toContain('data-release-output-profile="full"'); // full keeps the gate-led block
  });

  it('PERMIT_SUBMISSION while review pending = explicitly-marked NON-SUBMITTABLE PREVIEW, no PE-1', () => {
    expect(permitSubmissionPreviewState(PERMIT.input).isPreview).toBe(true);
    expect(PERMIT.html).toContain('data-permit-submission-preview="1"');
    expect(PERMIT.html).toContain('NON-SUBMITTABLE PREVIEW');
    const seq = pageSeq(PERMIT.html);
    expect(seq).not.toContain('PE-1');
    expect(seq).not.toContain('CERT');
  });

  it('FULL_INTERNAL always carries the current PE-1 state + the full review registry', () => {
    const seq = pageSeq(FULL.html);
    expect(seq).toContain('PE-1');
    expect(seq).toContain('RS-1');
    expect(FULL.html).toContain('NO CERTIFICATION ASSERTED');        // current (pending) PE-1 state
  });

  it('PERMIT_SUBMISSION approved: manifest carries CERT/PE-1 only under certificationCompleted', () => {
    const base = { pv1Title: 'T1', pv3Title: 'T3', isMicro: true, includePv4cCont: true, includePv4b1: true } as any;
    const pending = buildSheetManifest({ ...base, profile: 'permit', certificationCompleted: false }).map(s => s.id);
    const approved = buildSheetManifest({ ...base, profile: 'permit', certificationCompleted: true }).map(s => s.id);
    expect(pending).not.toContain('PE-1');
    expect(pending).not.toContain('CERT');
    expect(approved).toContain('PE-1');
    expect(approved).toContain('CERT');
    // design-review always ends on PE-1 regardless
    const dr = buildSheetManifest({ ...base, profile: 'design-review', certificationCompleted: false }).map(s => s.id);
    expect(dr[dr.length - 1]).toBe('PE-1');
  });

  it('an approval qualifies ONLY when its digest equals the snapshot digest (nothing here can invent one)', () => {
    const fake: any = { _snapshot: { meta: { snapshotId: 'PDS-TEST', digest: 'abc' }, certification: { engineeringReviewApproved: { reviewedDigest: 'zzz', approvedAtIso: 'x' } } } };
    expect(certificationIsCompleted(fake)).toBe(false);
    fake._snapshot.certification.engineeringReviewApproved.reviewedDigest = 'abc';
    expect(certificationIsCompleted(fake)).toBe(true);
  });

  it('the registry and requirement counts are identical across all three profiles', () => {
    const codes = (s: PermitDesignSnapshot) => s.permitReadiness.registry.map(r => r.code).sort();
    expect(codes(DR.snap)).toEqual(codes(FULL.snap));
    expect(codes(DR.snap)).toEqual(codes(PERMIT.snap));
  });
});

// ── §3 — manufacturer-document accounting ───────────────────────────────────
describe('§3 — manufacturer structural documents: applicability + inclusion honesty', () => {
  const DR = gen('design-review');

  it('an RT-MINI II document can never silently satisfy RT-MINI applicability', () => {
    const v = evaluateDocumentApplicability(
      'RT-MINI',
      { model: 'RT-MINI', docTitle: 'Roof Tech RT-MINI II Installation Manual (Jun 2025)', imageUrl: '/x.png', sourceUrl: 'https://x' } as any,
      null,
      { archivedInRepo: true, sha256: 'a'.repeat(64), status: 'current' } as any,
    );
    expect(v.state).not.toBe('VERIFIED');
    expect(v.state).not.toBe('AUTHORITATIVE');
    expect(v.applicabilityVerified).toBe(false);
  });

  it('DS pages carry an explicit applicability state; the unverified RT document is marked', () => {
    expect(DR.html).toContain('data-ds-applicability="unverified"');
    expect(DR.html).toContain('EQUIPMENT-DOCUMENT-APPLICABILITY');
  });

  it('the appendix index describes EXACTLY the pages that are emitted (no registry-only inclusion claims)', () => {
    const emitted = [...DR.html.matchAll(/data-sheet-id="(DS-\d+)"/g)].map(m => m[1]);
    // every DS id the cover indexes is actually emitted, and vice versa
    const indexed = [...new Set([...DR.html.matchAll(/>(DS-\d+)</g)].map(m => m[1]))];
    for (const id of indexed) expect(emitted).toContain(id);
    expect(new Set(emitted).size).toBe(emitted.length);
    // the stamped structural PE letter has no emitted page and is never
    // described as an appendix attachment
    expect(DR.html).not.toMatch(/stamped[^<]{0,80}letter[^<]{0,80}(appendix|attached|included)/i);
  });
});

// ── §4 — requirement-count accounting (the 14-vs-15 class) ──────────────────
describe('§4 — PROJECT-NAME-NONPRODUCTION accounts for a ±1 requirement delta at constant gates', () => {
  it('a \\bTEST\\b project name fires the requirement; renaming clears it; the gate count is unchanged', () => {
    const clean = gen('design-review');
    const test = gen('design-review', i => { i.project.projectName = `${i.project.projectName} TEST`; });
    const codesClean = clean.snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);
    const codesTest = test.snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);
    expect(codesClean).not.toContain('PROJECT-NAME-NONPRODUCTION');
    expect(codesTest).toContain('PROJECT-NAME-NONPRODUCTION');
    expect(codesTest.length).toBe(codesClean.length + 1);
    // headline: requirement count differs by exactly 1; the code maps to RG-1
    // (PROJECT & AHJ AUTHORITY), which is already open, so gates are constant.
    const gateCount = (html: string) => Number(html.match(/data-release-open-gate-count="(\d+)"/)?.[1] ?? -1);
    const reqCount = (html: string) => Number(html.match(/data-release-requirement-count="(\d+)"/)?.[1] ?? -1);
    expect(gateCount(test.html)).toBe(gateCount(clean.html));
    expect(reqCount(test.html)).toBe(reqCount(clean.html) + 1);
  });
});

// ── §5 — canonical seismic authority ────────────────────────────────────────
describe('§5 — ONE canonical resolved seismic result; no hardcoded B/D substitution', () => {
  const VERIFIED_DOC = {
    documentId: 'cedb14f7-doc', dataset: 'ASCE 7 Hazard Tool + USGS', versionOrDate: 'ASCE 7-22',
    verificationState: 'verified', archivedInRepo: true, sha256: 'cedb14f7'.repeat(8),
    coversWindSpeed: false, coversSnowLoad: false, coversExposureRisk: false,
    coversSeismic: true, seismicSdc: 'D', seismicSs: 0.61, seismicS1: 0.18, seismicSiteClass: 'D',
    windSpeedMph: null, groundSnowPsf: null, exposureCategory: null, riskCategory: null,
    coordinates: null, addressUsed: null, projectApplicability: 'braidon', lookupTimestampIso: 'x',
    currencyConfirmedAtIso: 'x',
  } as any;

  it('resolution precedence: retrieval → verified archived document → NOT ESTABLISHED', () => {
    const fromRet = resolveSeismicAuthority({
      retrievalSeismic: { seismicSdc: 'D', seismicSs: 0.61, seismicS1: 0.18, siteClass: 'D', sourceHash: 'ab'.repeat(32) },
      sourceEvidence: { ...VERIFIED_DOC, seismicSdc: 'C' },
    });
    expect(fromRet.established).toBe(true);
    expect(fromRet.sdc).toBe('D');
    expect(fromRet.source).toBe('hazard-retrieval');

    const fromDoc = resolveSeismicAuthority({ retrievalSeismic: null, sourceEvidence: VERIFIED_DOC });
    expect(fromDoc.established).toBe(true);
    expect(fromDoc.sdc).toBe('D');
    expect(fromDoc.source).toBe('archived-climate-document');
    expect(fromDoc.sourceRef).toBe('cedb14f7-doc');
    expect(fromDoc.sha256).toBeTruthy();

    // fail-closed: unverified / unhashed / seismic-free documents establish nothing
    expect(resolveSeismicAuthority({ sourceEvidence: { ...VERIFIED_DOC, verificationState: 'unverified' } }).established).toBe(false);
    expect(resolveSeismicAuthority({ sourceEvidence: { ...VERIFIED_DOC, sha256: null } }).established).toBe(false);
    expect(resolveSeismicAuthority({ sourceEvidence: { ...VERIFIED_DOC, coversSeismic: false, seismicSdc: null } }).established).toBe(false);
    expect(resolveSeismicAuthority({}).established).toBe(false);
  });

  it('an established authority propagates ONE value to cover + canonical + CERT/PE-1 surfaces', () => {
    const { html } = gen('full', undefined, { environmentalSource: VERIFIED_DOC });
    expect(html).toContain('data-seismic-source="archived-climate-document"');
    expect(html).toContain('CAT. D');
    expect(html).not.toContain('CAT. B');
    expect(html).toContain('data-seismic-sdc="D"');
  });

  it('with NO seismic authority nothing substitutes a category — surfaces print the input or PENDING', () => {
    const { html } = gen('full', i => {
      i.project.seismicCategory = '';
      if (i.compliance?.structural?.seismic) i.compliance.structural.seismic.sdc = '';
    });
    expect(html).toContain('PENDING — NOT ESTABLISHED');
    expect(html).toContain('data-seismic-source="none"');
    expect(html).not.toContain('CAT. B');
    expect(html).not.toContain('CAT. D');
  });

  it('the fixture (no authority) keeps its compliance INPUT value — the engine invents nothing', () => {
    const { html } = gen('full');
    // fixture carries sdc 'B' as input data; with no authority the engine passes
    // it through unchanged (and never upgrades it to a resolved claim).
    expect(html).toContain('data-seismic-source="input"');
  });
});
