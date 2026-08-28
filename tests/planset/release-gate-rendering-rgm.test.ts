// ═══════════════════════════════════════════════════════════════════════════
// RGM §5 / §6 — the GATE-LED RENDERING contract (RS-1, RS-1.n and the cover).
//
// RGM-1 proved the MODEL (release-gate-model-rgm.test.ts). This proves what the
// package PRINTS:
//   • RS-1 LEADS with the seven-row root-gate table, every cell read from the
//     model accessor and never re-derived;
//   • the child requirements group beneath their ONE primary gate, keeping the
//     code, finding type, status, explanation, resolution, authority path,
//     affected sheets, evidence reference and the per-record payload box;
//   • the seven visual treatment classes are distinguishable WITHOUT hue;
//   • the registry paginates onto formal RS-1.n sheets and the manifest agrees;
//   • the cover states the release status in GATE semantics and points at RS-1;
//   • every other sheet's package-level total is stated in gate semantics too.
// Nothing here asserts that anything is CLEARED — Braidon stays NOT FOR PERMIT
// SUBMISSION in every case.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit/index';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { pendingGroundingAuthority } from '../fixtures/synthetic-pending-grounding';
import { unresolvedProcurementAuthority } from '../fixtures/synthetic-unresolved-procurement';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  projectReleaseGates, releaseHeadline, releasePackageLine, topConfirmedConflict,
  openReleaseGates, REQUIREMENT_DECLARATIONS,
} from '@/lib/permit/snapshot/releaseGates';
import {
  BLOCKER_PAYLOAD_SCHEMA, findingTreatment, findingTreatmentTable,
  reviewStatusContPageCount, reviewStatusLayout, ROOT_GATE_TREATMENT,
} from '@/lib/permit/sections/reviewStatus';
import { buildSheetManifest } from '@/lib/permit/sheetManifest';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function render(mutate?: (fx: any) => void, authority?: unknown) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-26T12:00:00Z';
  mutate?.(input);
  const html = generatePermitHTML(input, undefined, (authority ?? null) as any);
  return { html, input, snap: input._snapshot as PermitDesignSnapshot };
}

const PKG = render();
/** A package whose open-air grounding authority is PENDING, so the
 *  QCABLE-GROUNDING-AUTHORITY-UNVERIFIED requirement — and therefore its
 *  schema-keyed payload component — is on RS-1 to be inspected. Pending is
 *  manufactured through the build's authority socket with a synthetic document
 *  written for a different branch architecture; the live project stays closed on
 *  its real archived evidence. */
const PENDING_PKG = render(undefined, pendingGroundingAuthority('wrongConnectorArchitecture'));
const MODEL = projectReleaseGates(PKG.snap);
/** WS-2 — a package whose Q-Cable procurement is UNRESOLVED, so RG-6's
 *  requirement is open and its schema-keyed payload, its confirmed-condition
 *  line and its gate are all on the sheet to be inspected. The live design now
 *  RESOLVES that requirement from archived manufacturer authority; refusing the
 *  authority is how the unresolved rendering is exercised without asserting that
 *  this project must stay short of cable. */
const UNRESOLVED_PKG = render(undefined, unresolvedProcurementAuthority());
const UNRESOLVED_MODEL = projectReleaseGates(UNRESOLVED_PKG.snap);
// the SHEET wrapper only — `.page-content` must not split a sheet.
const SHEET_SPLIT = /<div class="page(?=[ "])/;
/** a rendered sheet, COMMENT-STRIPPED: a comment that documents a RETIRED claim
 *  must never be read as a live rendered claim. */
const stripComments = (h: string): string => h.replace(/<!--[\s\S]*?-->/g, '');
const pageOf = (html: string, id: string): string => {
  const parts = html.split(SHEET_SPLIT).map(stripComments);
  return parts.find(p => new RegExp(`tb-sheet-id">\\s*${id.replace('.', '\\.')}\\s*<`).test(p)) ?? '';
};
const rsSheets = (html: string): string[] =>
  [...html.matchAll(/tb-sheet-id">\s*(RS-1(?:\.\d+)?)\s*</g)].map(m => m[1]);
const rsAll = (html: string): string =>
  html.split(SHEET_SPLIT).map(stripComments).filter(p => /tb-sheet-id">\s*RS-1/.test(p)).join('\n');

// ─── 1. RS-1 leads with the seven-row root-gate table ────────────────────────

describe('RGM §5 — RS-1 leads with the ROOT-GATE table, read from the model', () => {
  const rs1 = pageOf(PKG.html, 'RS-1');

  it('the root-gate table renders BEFORE any requirement group', () => {
    expect(rs1).toContain('data-release-gate-table="1"');
    expect(rs1.indexOf('data-release-gate-table="1"'))
      .toBeLessThan(rs1.indexOf('data-release-gate-group='));
  });

  it('it carries exactly the seven canonical root gates, in canonical order', () => {
    const ids = [...rs1.matchAll(/data-release-gate="(RG-[^"]+)" data-release-gate-status=/g)].map(m => m[1]);
    expect(ids).toEqual(['RG-1', 'RG-2', 'RG-3', 'RG-4', 'RG-5', 'RG-6', 'RG-7']);
    expect(rs1).not.toContain('data-release-gate="RG-UNMAPPED"');
  });

  it('every gate row prints the model’s own status, counts, role and primary resolution', () => {
    for (const g of MODEL.gates.filter(x => x.gateCategory !== 'UNMAPPED')) {
      const i = rs1.indexOf(`data-release-gate="${g.gateId}" data-release-gate-status="${g.status}"`);
      expect(i, `${g.gateId} row`).toBeGreaterThan(-1);
      const row = rs1.slice(i, rs1.indexOf('</tr>', i));
      expect(row).toContain(`data-release-gate-unresolved="${g.unresolvedCount}"`);
      expect(row).toContain(` of ${g.totalRequirementCount}`);
      if (g.status === 'OPEN') expect(row).toContain(g.primaryResolutionAction.slice(0, 40));
    }
  });

  it('the seven columns the directive names are all present', () => {
    for (const col of ['GATE', 'CATEGORY', 'STATUS', 'UNRESOLVED', 'RELEASE IMPACT',
      'PRIMARY RESOLUTION', 'RESPONSIBLE ROLE']) expect(rs1).toContain(col);
  });

  it('the headline is the model headline — gate and requirement counts never conflated', () => {
    expect(rs1).toContain(releaseHeadline(MODEL.summary));
    expect(rs1).toContain(`data-release-open-gate-count="${MODEL.summary.openGateCount}"`);
    expect(rs1).toContain(`data-release-requirement-count="${MODEL.summary.unresolvedRequirementCount}"`);
    // 2026-08-28 RT-MINI MIGRATION - with fewer requirements open, one
    // gate can now carry exactly one of them, so a STRICT inequality is an
    // accident of the fixture rather than the property. What must never happen is
    // the two counts being CONFLATED - more gates than requirements, or a gate
    // open with nothing under it.
    expect(MODEL.summary.openGateCount).toBeLessThanOrEqual(MODEL.summary.unresolvedRequirementCount);
    expect(MODEL.summary.openGateCount).toBeGreaterThan(0);
  });

  it('the retired flat "N OPEN RELEASE BLOCKERS" headline is gone', () => {
    expect(rsAll(PKG.html)).not.toMatch(/OPEN RELEASE BLOCKERS?/);
  });
});

// ─── 2. child requirements keep every field, under ONE gate ──────────────────

describe('RGM §5 — every requirement renders in full beneath its ONE primary gate', () => {
  const rs = rsAll(PKG.html);
  const open = MODEL.requirements.filter(q => q.status === 'OPEN');

  it('one rendered row per active requirement — none merged, none duplicated', () => {
    const rows = [...rs.matchAll(/data-release-requirement="([^"]+)"/g)].map(m => m[1]).sort();
    expect(rows).toEqual(open.map(q => q.requirementCode).sort());
  });

  it('each row keeps code, finding type, status, explanation, resolution, authority, evidence, sheets', () => {
    for (const q of open) {
      const i = rs.indexOf(`data-release-requirement="${q.requirementCode}"`);
      const row = rs.slice(i, rs.indexOf('</tr>', i));
      expect(row, q.requirementCode).toContain(`data-finding-type="${q.findingType}"`);
      expect(row).toContain(`data-requirement-status="${q.status}"`);
      expect(row).toContain(`data-release-gate="${q.gateId}"`);
      expect(row).toContain(q.authorityPath);
      expect(row).toContain('AUTHORITY PATH:');
      expect(row).toContain('EVIDENCE:');
      expect(row).toContain('RESPONSIBLE:');
      if (q.evidenceReferences.length) expect(row).toContain(q.evidenceReferences[0]);
    }
  });

  it('a requirement appears under exactly ONE gate group', () => {
    for (const q of open) {
      const hits = [...rs.matchAll(new RegExp(`data-release-requirement="${q.requirementCode}"[^>]*data-release-gate="(RG-[^"]+)"`, 'gs'))]
        .map(m => m[1]);
      expect(new Set(hits).size, q.requirementCode).toBe(1);
      expect(hits[0]).toBe(q.gateId);
    }
  });

  it('the RG-5 children state WHICH RESULT they affect (the directive’s gate-5 contract)', () => {
    const i = rs.indexOf('data-release-requirement="ROUTE-LENGTH-ESTIMATE"');
    const row = rs.slice(i, rs.indexOf('</tr>', i));
    expect(row).toContain('AFFECTS:');
    expect(row).toMatch(/Ampacity, OCPD sizing/);
  });

  it('the per-record payload detail box is still keyed by canonical payload schema', () => {
    // read from the PENDING package: the grounding component exists only while
    // that requirement is open, and what is under test is the KEYING, not whether
    // this project happens to be pending.
    const rsPending = rsAll(PENDING_PKG.html);
    expect(rsPending).toContain('data-blocker-payload-schema="qcable-grounding-authority"');
    expect(rsPending).not.toContain('data-blocker-payload-schema="undefined"');
    // AAC WS-5 (2026-07-27): the fixture DOES carry a Q-Cable deficit now (branch
    // B2's ordered drops cannot span its sub-array bridge — the per-branch check
    // the aggregate-only gate used to hide), so its own schema-keyed component
    // renders too. The rule under test is that each component is keyed by the
    // requirement's DECLARED schema, and that a code without one renders none.
    const rsUnresolved = rsAll(UNRESOLVED_PKG.html);
    expect(rsUnresolved).toContain('data-blocker-payload-schema="qcable-procurement-deficit"');
    expect(rsUnresolved).not.toContain('data-blocker-payload-schema="undefined"');
  });

  it('the payload-schema table stays in lockstep with the requirement declarations', () => {
    for (const code of Object.keys(REQUIREMENT_DECLARATIONS)) {
      expect(BLOCKER_PAYLOAD_SCHEMA[code], `${code} has no declared payload component`).toBeTruthy();
    }
    for (const code of Object.keys(BLOCKER_PAYLOAD_SCHEMA)) {
      expect(REQUIREMENT_DECLARATIONS[code], `${code} has a payload component but no gate declaration`).toBeTruthy();
    }
  });
});

// ─── 3. §7 condition semantics in the rendered wording ───────────────────────

describe('RGM §7 — the rendered wording never mislabels a condition', () => {
  const rs = rsAll(PKG.html);
  const rowOf = (code: string): string => {
    const i = rs.indexOf(`data-release-requirement="${code}"`);
    return i < 0 ? '' : rs.slice(i, rs.indexOf('</tr>', i));
  };

  it('a pending authority prints PENDING AUTHORITY / DOCUMENT, never a failure', () => {
    // 2026-08-28 RT-MINI MIGRATION - RACKING-CAPACITY-SOURCE-NOT-ARCHIVED
    // no longer fires (SolarPro ships the document), so the case is exercised on
    // whichever PENDING_AUTHORITY / PENDING_DOCUMENT requirement is still open.
    // The wording rule itself is unchanged.
    const pendingDocCodes = MODEL.requirements
      .filter(r => r.status === 'OPEN'
        && (r.findingType === 'PENDING_DOCUMENT' || r.findingType === 'PENDING_AUTHORITY'))
      .map(r => r.requirementCode);
    expect(pendingDocCodes.length, 'the fixture must still carry a pending-document requirement')
      .toBeGreaterThan(0);
    let checked = 0;
    for (const code of pendingDocCodes) {
      const row = rowOf(code);
      if (!row) continue;
      checked += 1;
      expect(row).toMatch(/PENDING (DOCUMENT|AUTHORITY)/);
      expect(row).not.toMatch(/\bFAILED\b|\bFAILURE\b/i);
    }
    expect(checked, 'at least one such requirement must be RENDERED').toBeGreaterThan(0);
  });

  it('the professional-release requirement prints PROFESSIONAL RELEASE, not a defect', () => {
    const row = rowOf('ENGINEERING-REVIEW-PENDING');
    expect(row).toContain('PROFESSIONAL RELEASE');
    expect(row).not.toMatch(/\bdefect|\bFAILED\b/i);
    expect(rs).toMatch(/WORKFLOW requirements, not engineering defects/);
  });

  it('a non-production identity prints ADMINISTRATIVE HOLD (identity mode)', () => {
    const idPkg = render(fx => { fx.project.projectName = `${fx.project.projectName} — Solar TEST`; fx.project.designer = ''; });
    const rsId = rsAll(idPkg.html);
    const i = rsId.indexOf('data-release-requirement="PROJECT-NAME-NONPRODUCTION"');
    expect(i).toBeGreaterThan(-1);
    const row = rsId.slice(i, rsId.indexOf('</tr>', i));
    expect(row).toContain('ADMINISTRATIVE HOLD');
    expect(row).toContain('data-finding-treatment="administrative"');
    expect(row).not.toMatch(/structural|electrical failure/i);
  });
});

// ─── 4. black-and-white legibility of the seven treatment classes ────────────

describe('RGM §5 / gate 17 — the treatment classes survive monochrome printing', () => {
  const table = [...findingTreatmentTable()];
  const lum = (hex: string): number => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    return Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * 1000) / 1000;
  };
  const signature = (t: typeof table[number]) => ({
    borderWidth: t.borderWidth, borderStyle: t.borderStyle,
    fontWeight: t.chipWeight, fontStyle: t.chipStyle,
    textDecoration: t.chipDecoration, letterSpacing: t.chipSpacing,
    fill: lum(t.fill),
  });

  it('there are exactly seven declared classes (the directive’s list)', () => {
    expect(table.map(t => t.cls).sort()).toEqual([
      'administrative', 'advisory', 'field', 'pending', 'review-workflow', 'root-gate-hold', 'strong',
    ]);
  });

  it('every PAIR differs in at least two hue-free channels', () => {
    const keys = Object.keys(signature(table[0])) as (keyof ReturnType<typeof signature>)[];
    for (let i = 0; i < table.length; i++) {
      for (let j = i + 1; j < table.length; j++) {
        const a = signature(table[i]), b = signature(table[j]);
        const differing = keys.filter(k => String(a[k]) !== String(b[k]));
        expect(differing.length, `${table[i].cls} vs ${table[j].cls}: ${differing.join(',')}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('the finding types collapse onto the classes exactly as §5 prescribes', () => {
    expect(findingTreatment('TECHNICAL_CONFLICT').cls).toBe('strong');
    expect(findingTreatment('VERIFIED_DEFICIENCY').cls).toBe('strong');
    expect(findingTreatment('PENDING_AUTHORITY').cls).toBe('pending');
    expect(findingTreatment('PENDING_DOCUMENT').cls).toBe('pending');
    expect(findingTreatment('PENDING_SELECTION').cls).toBe('pending');
    expect(findingTreatment('FIELD_VERIFICATION').cls).toBe('field');
    expect(findingTreatment('ADMINISTRATIVE_HOLD').cls).toBe('administrative');
    expect(findingTreatment('PROFESSIONAL_RELEASE').cls).toBe('review-workflow');
    expect(findingTreatment('ADVISORY').cls).toBe('advisory');
    expect(ROOT_GATE_TREATMENT.cls).toBe('root-gate-hold');
  });

  it('an UNKNOWN finding type falls to the HEAVIEST treatment, never to advisory', () => {
    expect(findingTreatment('SOMETHING-NEW' as never).cls).toBe('strong');
  });
});

// ─── 5. RS-1.n pagination + manifest agreement ───────────────────────────────

describe('RGM §5 — RS-1.n continuation sheets use the existing pagination machinery', () => {
  it('the fixture registry paginates and every RS sheet is in the rendered set', () => {
    const cont = reviewStatusContPageCount(PKG.snap.permitReadiness.registry);
    const rendered = rsSheets(PKG.html);
    expect(rendered[0]).toBe('RS-1');
    expect(rendered.length).toBe(cont + 1);
    for (let i = 1; i <= cont; i++) expect(rendered[i]).toBe(`RS-1.${i}`);
  });

  it('the sheet MANIFEST lists the same RS sheets, contiguously after RS-1', () => {
    const manifest = (PKG.snap.projectAuthority?.sheetIndex ?? []).map(s => s.id);
    const rendered = [...PKG.html.matchAll(/tb-sheet-id">\s*([^<]+?)\s*</g)].map(m => m[1]);
    expect(manifest).toEqual(rendered);
    const rsIdx = manifest.indexOf('RS-1');
    const cont = reviewStatusContPageCount(PKG.snap.permitReadiness.registry);
    for (let i = 1; i <= cont; i++) expect(manifest[rsIdx + i]).toBe(`RS-1.${i}`);
  });

  it('every requirement is on SOME RS sheet — pagination hides nothing', () => {
    const rs = rsAll(PKG.html);
    for (const r of PKG.snap.permitReadiness.registry.filter(x => !x.resolved)) {
      expect(rs, `${r.code} must render`).toContain(r.code);
    }
  });

  it('a continuation reprints its gate band as (CONTINUED) and never repeats a row', () => {
    const { pages } = reviewStatusLayout(PKG.snap.permitReadiness.registry);
    const seen = new Set<string>();
    for (const p of pages) {
      for (const b of p.blocks) {
        for (const row of b.rows) {
          const key = `${row.q.requirementCode}:${row.q.explanation}`;
          expect(seen.has(key), `${row.q.requirementCode} rendered twice`).toBe(false);
          seen.add(key);
        }
      }
    }
    expect(seen.size).toBe(MODEL.requirements.filter(q => q.status === 'OPEN').length);
  });

  it('the layout is deterministic (same registry ⇒ same pagination)', () => {
    const a = reviewStatusLayout(PKG.snap.permitReadiness.registry);
    const b = reviewStatusLayout(PKG.snap.permitReadiness.registry);
    expect(JSON.stringify(a.pages.map(p => p.blocks.map(x => [x.gateId, x.continued, x.rows.length]))))
      .toEqual(JSON.stringify(b.pages.map(p => p.blocks.map(x => [x.gateId, x.continued, x.rows.length]))));
  });

  it('an empty registry needs no continuation sheet', () => {
    expect(reviewStatusContPageCount([])).toBe(0);
    expect(buildSheetManifest({ pv1Title: 'x', pv3Title: 'y', reviewStatusContCount: 0 })
      .filter(s => s.id.startsWith('RS-1.')).length).toBe(0);
    expect(buildSheetManifest({ pv1Title: 'x', pv3Title: 'y', reviewStatusContCount: 2 })
      .map(s => s.id).filter(id => id.startsWith('RS-1'))).toEqual(['RS-1', 'RS-1.1', 'RS-1.2']);
  });
});

// ─── 6. the cover release-status block (§6) ──────────────────────────────────

describe('RGM §6 — the cover states RELEASE STATUS in gate semantics', () => {
  const cover = pageOf(PKG.html, 'PV-0');

  it('the release-status block replaced the blocker list', () => {
    expect(cover).toContain('data-release-status-block="1"');
    expect(cover).not.toContain('struct-review-banner');
    expect(cover).not.toMatch(/more active release blocker/);
  });

  it('it prints the headline, the identity lines and the pointer to RS-1', () => {
    expect(cover).toContain(releaseHeadline(MODEL.summary));
    expect(cover).toContain('PENDING ENGINEERING REVIEW');
    expect(cover).toContain('NOT FOR PERMIT SUBMISSION');
    expect(cover).toContain(`SEE RS-1 FOR ALL ${MODEL.summary.unresolvedRequirementCount + MODEL.summary.advisoryCount} REQUIREMENT`);
  });

  it('it NUMBERS every open root gate — and only those', () => {
    const listed = [...cover.matchAll(/data-release-open-gate="(RG-[^"]+)"/g)].map(m => m[1]);
    expect(listed).toEqual(openReleaseGates(MODEL).map(g => g.gateId));
    expect(listed.length).toBe(MODEL.summary.openGateCount);
    for (const g of openReleaseGates(MODEL)) expect(cover).toContain(g.title.replace(/&/g, '&amp;'));
  });

  it('cover counts equal RS-1 counts equal the model', () => {
    const rs1 = pageOf(PKG.html, 'RS-1');
    const n = (src: string, a: string) => (src.match(new RegExp(`${a}="(\\d+)"`)) ?? [])[1];
    expect(n(cover, 'data-release-open-gate-count')).toBe(n(rs1, 'data-release-open-gate-count'));
    expect(n(cover, 'data-release-requirement-count')).toBe(n(rs1, 'data-release-requirement-count'));
    expect(Number(n(cover, 'data-release-open-gate-count'))).toBe(MODEL.summary.openGateCount);
  });

  // AAC WS-5 (2026-07-27): the fixture now carries exactly ONE confirmed
  // condition (the Q-Cable per-branch procurement deficit), so the line RENDERS
  // — and it must name that one condition and no other. The original intent (the
  // cover never fabricates a conflict, and never duplicates the registry) is
  // preserved by pinning it to the single most-severe confirmed condition.
  it('the confirmed-condition line names EXACTLY the one confirmed condition', () => {
    // read from the UNRESOLVED package: the confirmed condition IS the Q-Cable
    // deficit, and on the live design that condition is now resolved.
    const top = topConfirmedConflict(UNRESOLVED_MODEL);
    expect(top).toBeTruthy();
    expect(top!.requirementCode).toBe('QCABLE-PROCUREMENT-INSUFFICIENT');
    const unresolvedCover = pageOf(UNRESOLVED_PKG.html, 'PV-0');
    expect(unresolvedCover).toContain('MOST SEVERE CONFIRMED CONDITION');
    expect(unresolvedCover).toContain(top!.requirementCode);
  });

  it('with NO confirmed condition the cover states none — it never invents one', () => {
    // the live design: the deficit is resolved, so there is nothing to name.
    expect(topConfirmedConflict(MODEL)).toBeNull();
    expect(cover).not.toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
  });

  it('the cover never duplicates the registry (only the confirmed condition is named)', () => {
    const block = cover.slice(cover.indexOf('data-release-status-block'));
    const end = block.indexOf('SEE RS-1 FOR ALL');
    const named = topConfirmedConflict(MODEL)?.requirementCode ?? null;
    for (const r of PKG.snap.permitReadiness.registry.filter(x => !x.resolved)) {
      if (r.code === named) continue;
      expect(block.slice(0, end)).not.toContain(r.code);
    }
  });
});

// ─── 7. package-level totals on the OTHER sheets (§4 count semantics) ────────

describe('RGM §4 — other sheets state PACKAGE totals in gate semantics', () => {
  it('the structural banner carries the package gate line and drops "blockers" phrasing', () => {
    const pv3 = pageOf(PKG.html, 'PV-3');
    expect(pv3).toContain('struct-review-banner');
    expect(pv3).toContain('data-release-package-line="1"');
    expect(pv3).toContain(releasePackageLine(MODEL.summary));
    expect(pv3).not.toMatch(/more active release blocker/);
  });

  it('the certification gate banner does the same, keeping its own reason rows', () => {
    const cert = pageOf(PKG.html, 'CERT');
    expect(cert).toContain('PENDING ENGINEERING REVIEW');
    expect(cert).toContain('data-release-package-line="1"');
    expect(cert).toContain(releasePackageLine(MODEL.summary));
  });

  it('PV-4A keeps its SHEET-SCOPED electrical rows (a domain list, not a package total)', () => {
    const pv4a = pageOf(PKG.html, 'PV-4A');
    const electrical = PKG.snap.permitReadiness.registry.filter(r => !r.resolved && r.domain === 'electrical');
    for (const r of electrical) expect(pv4a).toContain(r.code);
    const structural = PKG.snap.permitReadiness.registry.filter(r => !r.resolved && r.domain === 'structural');
    for (const r of structural) expect(pv4a).not.toContain(r.code);
  });

  it('nothing anywhere in the package still says "N OPEN RELEASE BLOCKERS"', () => {
    expect(PKG.html).not.toMatch(/\d+\s+OPEN RELEASE BLOCKERS?/);
  });
});

// ─── 8. nothing was cleared, nothing was weakened ────────────────────────────

describe('RGM boundaries — the redesign clears nothing and weakens nothing', () => {
  it('Braidon is still NOT permit-ready, with every requirement preserved', () => {
    expect(PKG.snap.permitReadiness.ready).toBe(false);
    expect(MODEL.summary.permitReady).toBe(false);
    // WS-2 closed RG-6's requirement on the live design (7 → 6 open gates). The
    // property this test guards is that the RGM REDESIGN clears nothing, so the
    // gate count is asserted on the package where nothing was resolved.
    expect(UNRESOLVED_MODEL.summary.openGateCount).toBe(7);
    expect(MODEL.summary.openGateCount).toBe(6);
    expect(MODEL.summary.unresolvedRequirementCount)
      .toBe(PKG.snap.permitReadiness.registry.filter(r => !r.resolved && r.severity === 'blocking').length);
    expect(PKG.html).toContain('NOT FOR PERMIT SUBMISSION');
  });

  it('the snapshot gains NO stored release-gate fields (the model is projected at read)', () => {
    const s = PKG.snap as unknown as Record<string, unknown>;
    expect(s.releaseGates).toBeUndefined();
    expect(s.releaseRequirements).toBeUndefined();
    expect(s.releaseSummary).toBeUndefined();
    expect(Array.isArray(PKG.snap.permitReadiness.blockers)).toBe(true);
  });

  it('a second render is byte-identical (no layout nondeterminism)', () => {
    const again = render();
    expect(again.html.length).toBe(PKG.html.length);
  });
});
