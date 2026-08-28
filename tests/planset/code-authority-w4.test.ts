// ═══════════════════════════════════════════════════════════════════════════
// W4 §1/§2 — CANONICAL CODE-AUTHORITY + V11 ACTIVATION.
// Proves: the code-authority record is honest (verified vs incomplete, no
// inferred editions); V11 is BLOCKING (single source, no fabrication, honest
// surfacing); the CODE-AUTHORITY-INCOMPLETE blocker consistency holds; and NO
// renderer this workstream owns carries a literal NEC/IBC/IRC/IFC/ASCE edition
// (source scan) — with the data-code-edition tag mechanism in place.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildCodeAuthority, resolveAhjRecord } from '@/lib/permit/snapshot/codeAuthority';
import { projectCodeAuthority } from '@/lib/permit/snapshot/codeAuthorityProjection';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { baseSnapshot } from './snapshot-w1.test';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const v11 = (s: PermitDesignSnapshot) =>
  blockingViolations(validatePermitDesignSnapshot(s)).filter(x => x.invariant === 'V11');

// ── §1 record builder ────────────────────────────────────────────────────────
describe('W4 §1 — buildCodeAuthority (honest verification state)', () => {
  it('with no AHJ record + no enriched NEC → all editions unknown, INCOMPLETE, no inference', () => {
    const ca = buildCodeAuthority({
      ahjRecord: null, necVersionEnriched: null, asceEngineBasis: null,
      capturedAtIso: '2026-07-21',
    });
    expect(ca.editions.nec.edition).toBeNull();
    expect(ca.editions.ibc.edition).toBeNull();
    expect(ca.editions.ifc.edition).toBeNull();
    // No NEC→IFC inference: IFC stays null even if NEC were known.
    expect(ca.verificationStatus).toBe('incomplete');
    // NATIONWIDE BASELINE (2026-08-27) — with nothing supplied at all, the NEC has no basis (a real
    // gap) and the ASCE engine basis is absent (also real). The I-codes are DEFERRED to the AHJ
    // rather than counted as gaps; their editions are still null and still never inferred.
    expect(ca.incompleteEditions).toEqual(['nec', 'asce']);
    expect(ca.editions.irc.edition).toBeNull();
    expect(ca.editions.ibc.source).toBe('edition-per-ahj-adoption');
  });

  it('A.4 — an enriched/static NEC value is FALLBACK METADATA, never the adopted edition', () => {
    const ca = buildCodeAuthority({
      ahjRecord: null, necVersionEnriched: 'NEC 2023', asceEngineBasis: 'ASCE 7-22',
      capturedAtIso: '2026-07-21',
    });
    // A.4's target was the CURATED PER-AHJ TABLE being published as the jurisdiction's adopted
    // ordinance. That remains prohibited (see the curated-record case below: `source` is never
    // 'ahj-record'). But `compliance.jurisdiction.necVersion` is not that table — it is an OPERATOR
    // ENTRY for this specific project, and 'operator-entry' is a declared source in its own right.
    // NATIONWIDE BASELINE (2026-08-27): an operator who states the edition is supplying better
    // evidence than a state default, so it adopts and outranks the state baseline. It is still
    // never `verified`, and the value is still carried as fallback metadata for traceability.
    expect(ca.editions.nec.edition).toBe('2023');
    expect(ca.editions.nec.source).toBe('operator-entry');
    expect(ca.editions.nec.fallbackEdition).toBe('2023');
    expect(ca.editions.nec.fallbackSource).toBe('compliance.jurisdiction.necVersion');
    expect(ca.verificationStatus).not.toBe('verified');
    expect(ca.editions.asce.edition).toBe('7-22');
    expect(ca.editions.asce.source).toBe('structural-engine-basis');
    // IBC/IRC/IFC are NOT carried by the AHJ DB → edition still null, never inferred.
    expect(ca.editions.ibc.edition).toBeNull();
    expect(ca.editions.ifc.edition).toBeNull();
    // NATIONWIDE BASELINE (2026-08-27) — a null I-code edition is now DEFERRED, not INCOMPLETE:
    // the standard is cited, the AHJ confirms the year at plan review, and no design value depends
    // on it (the structural basis is ASCE, resolved separately and asserted just above). The
    // edition stays null — this is a classification change, never an inference.
    expect(ca.editions.ibc.source).toBe('edition-per-ahj-adoption');
    expect(ca.editions.irc.source).toBe('edition-per-ahj-adoption');
    expect(ca.editions.ifc.source).toBe('edition-per-ahj-adoption');
    // Every family now has a stated basis — NEC from the operator entry, ASCE from the engine, the
    // I-codes deferred to the AHJ — so nothing is INCOMPLETE. The record is still `unverified`,
    // because none of that is an archived adoption ordinance.
    expect(ca.incompleteEditions).toEqual([]);
    expect(ca.verificationStatus).toBe('unverified');
    // sourceHash shaped for the W4-D SHA-256 registry — null until archived.
    expect(ca.sourceHash).toBeNull();
    expect(ca.verifiedBy).toBeNull();
  });

  it('an invalid NEC token is not accepted (no fabrication)', () => {
    const ca = buildCodeAuthority({
      ahjRecord: null, necVersionEnriched: '2099', asceEngineBasis: null,
      capturedAtIso: '2026-07-21',
    });
    expect(ca.editions.nec.edition).toBeNull();
  });

  it('resolveAhjRecord localizes a real curated jurisdiction and carries its NEC + provenance', () => {
    // Illinois is in the curated DB; resolve by state+county when available.
    const rec = resolveAhjRecord({ stateCode: 'IL', county: 'Cook' })
      ?? resolveAhjRecord({ stateCode: 'CA', county: 'Los Angeles' });
    if (rec) {
      const ca = buildCodeAuthority({ ahjRecord: rec, asceEngineBasis: 'ASCE 7-22', capturedAtIso: '2026-07-21' });
      expect(ca.ahjRecordId).toBe(rec.id);
      // A.4 IS INTACT: the CURATED PER-AHJ year is still fallback metadata and is still never
      // presented as this AHJ's adopted ordinance.
      expect(ca.editions.nec.fallbackEdition).toBe(rec.necVersion);
      expect(ca.editions.nec.fallbackSource).toBe(`ahj-national:${rec.id}`);
      expect(ca.editions.nec.source).not.toBe('ahj-record');
      // NATIONWIDE BASELINE (2026-08-27) — what changed is that a resolved jurisdiction now yields
      // a STATED BASIS instead of nothing: the STATE-level adoption (a published NFPA figure),
      // labelled `state-adoption-table` so no sheet can present it as the local ordinance. Leaving
      // this null meant every planset in the country printed "NEC PENDING" and could only be
      // cleared by phoning the AHJ.
      expect(ca.editions.nec.edition).not.toBeNull();
      expect(ca.editions.nec.source).toBe('state-adoption-table');
      expect(ca.editions.nec.provenance.note ?? '').toMatch(/STATE level/i);
      expect(ca.recordProvenance).toBe(rec.dataProvenance ?? null);
      // Still unverified — a state adoption is a stated basis, NOT an archived adoption document.
      expect(ca.verificationStatus).not.toBe('verified');
    }
  });
});

// ── §2 projection ──────────────────────────────────────────────────────────
describe('W4 §2 — code-authority projection (PENDING + tag mechanism)', () => {
  it('renders PENDING for unknown editions and tags editions with data-code-edition', () => {
    const p = projectCodeAuthority(null);
    expect(p.necLabel).toBe('NEC PENDING');
    expect(p.asceLabel).toBe('ASCE PENDING');
    expect(p.tag('nec')).toContain('data-code-edition="nec"');
    expect(p.tag('nec')).toContain('NEC PENDING');
  });

  it('projects the record editions and tags carry the real edition', () => {
    const p = projectCodeAuthority(baseSnapshot());
    expect(p.nec).toBe('2023');
    expect(p.necLabel).toBe('NEC 2023');
    expect(p.tag('asce')).toBe('<span data-code-edition="asce">ASCE 7-22</span>');
    expect(p.verified).toBe(true);
  });
});

// ── V11 activation (blocking) ────────────────────────────────────────────────
describe('W4 §2 — V11 blocking single-source', () => {
  it('a verified, single-sourced snapshot has zero V11 violations', () => {
    expect(v11(baseSnapshot())).toEqual([]);
  });

  it('FAILS when a sheet-adopted edition diverges from the code-authority record', () => {
    const s = clone(baseSnapshot());
    s.project.ahj.adoptedCodes.nec = '2020';   // divergent from codeAuthority '2023'
    expect(v11(s).length).toBeGreaterThan(0);
  });

  it('FAILS when an edition is fabricated where the authority is unknown (null)', () => {
    const s = clone(baseSnapshot());
    (s.codeAuthority.editions.ibc as { edition: string | null }).edition = null;
    s.codeAuthority.incompleteEditions = ['ibc'];
    s.codeAuthority.verificationStatus = 'incomplete';
    s.permitReadiness.blockers.push({ code: 'CODE-AUTHORITY-INCOMPLETE', message: 'x' });
    s.project.ahj.adoptedCodes.ibc = '2021';   // fabricated — authority has none
    const vs = v11(s);
    expect(vs.some(x => /fabricated|single-source/.test(x.message))).toBe(true);
  });

  // NATIONWIDE BASELINE (2026-08-27) — V11 no longer keys on `verificationStatus !== 'verified'`.
  // `verified` requires an ARCHIVED, operator-confirmed adoption ordinance that effectively never
  // exists, so that form of the invariant pinned "every package in the country blocks forever" as a
  // structural rule. What V11 actually protects is that a package may never go permit-ready with NO
  // STATED CODE BASIS — which is now asserted directly, on the real condition.
  it('FAILS when NO code basis is established and no CODE-AUTHORITY-INCOMPLETE blocker is present', () => {
    const s = clone(baseSnapshot());
    (s.codeAuthority.editions.nec as { edition: string | null }).edition = null;
    s.codeAuthority.verificationStatus = 'incomplete';
    // no blocker added → V11 consistency must fire
    const vs = v11(s);
    expect(vs.some(x => x.authorityPath === 'permitReadiness.blockers')).toBe(true);
  });

  it('PASSES (no missing-blocker violation) when unverified AND the blocker is present', () => {
    const s = clone(baseSnapshot());
    s.codeAuthority.verificationStatus = 'unverified';
    s.permitReadiness.blockers.push({ code: 'CODE-AUTHORITY-INCOMPLETE', message: 'x' });
    // adoptedCodes still mirror the (all-present) editions, so only the blocker
    // consistency is under test here — it must NOT fire.
    expect(v11(s).some(x => x.authorityPath === 'permitReadiness.blockers')).toBe(false);
  });

  it('FAILS when the snapshot carries no codeAuthority record at all', () => {
    const s = clone(baseSnapshot()) as Partial<PermitDesignSnapshot>;
    delete (s as { codeAuthority?: unknown }).codeAuthority;
    const vs = v11(s as PermitDesignSnapshot);
    expect(vs.length).toBeGreaterThan(0);
  });
});

// ── source scan: no renderer literals in owned files ─────────────────────────
describe('W4 §2 — no code-edition literals in owned renderers (source scan)', () => {
  const OWNED = [
    'lib/permit/utils/titleBlock.ts',
    'lib/permit/sections/coverSheet.ts',
    'lib/permit/sections/compliancePages.ts',
    'lib/permit/sections/certPages.ts',
    'lib/permit/sections/structuralPages.ts',
    'lib/permit/sections/arrayPages.ts',
    'lib/permit/sections/validationPage.ts',
    'lib/drafting/templates/roof.ts',
    'lib/drafting/templates/fence.ts',
    'lib/drafting/templates/ground.ts',
  ];

  /** Strip block comments and line comments (guarding :// in URLs) so only
   *  EXECUTABLE / rendered source is scanned. */
  function stripComments(src: string): string {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
    return noBlock.split('\n').map(line => {
      // cut at the first // that is not part of ://
      const m = line.match(/(^|[^:])\/\//);
      return m ? line.slice(0, (m.index ?? 0) + m[1].length) : line;
    }).join('\n');
  }

  // Literal ADOPTED editions that must never appear in a renderer: a year-form
  // edition after a code family, an ASCE 7-xx edition, or a `necVersion || '20xx'`
  // sheet-local default.
  const LITERAL_PATTERNS: RegExp[] = [
    /\b(NEC|IBC|IRC|IFC)\s+20\d\d\b/,
    /\bASCE\s+7-\d\d\b/,
    /necVersion\s*\|\|\s*['"]/,
    /\b\w*[Vv]er\s*=\s*['"]20\d\d['"]/,
  ];

  for (const rel of OWNED) {
    it(`${rel} has no literal code editions`, () => {
      const code = stripComments(fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8'));
      for (const re of LITERAL_PATTERNS) {
        const hit = code.match(new RegExp(re, 'g'));
        expect(hit, `${rel} contains code-edition literal(s): ${hit?.join(', ')}`).toBeNull();
      }
    });
  }

  it('the title block emits data-code-edition tags for harness extraction', () => {
    const tb = fs.readFileSync(path.resolve(__dirname, '../../lib/permit/utils/titleBlock.ts'), 'utf8');
    expect(tb).toContain("cp.tag('nec')");
    expect(tb).toContain("cp.tag('asce')");
  });
});

// ── end-to-end: tags render and are IDENTICAL across sheets ──────────────────
describe('W4 §2 — cross-sheet edition identity in the rendered package', () => {
  it('every data-code-edition value is identical across all sheets that print it', async () => {
    const { generatePermitHTML } = await import('@/lib/permit');
    const { roofProject } = await import('../../test-fixtures/roofProject');
    const html = await generatePermitHTML(roofProject as never);
    for (const kind of ['nec', 'ibc', 'irc', 'ifc', 'asce']) {
      const vals = [...html.matchAll(new RegExp(`data-code-edition="${kind}">([^<]+)<`, 'g'))]
        .map(m => m[1].trim());
      expect(vals.length, `${kind} tag rendered at least once`).toBeGreaterThan(0);
      expect(new Set(vals).size, `${kind} identical across sheets: ${[...new Set(vals)].join(' | ')}`).toBe(1);
    }
  });
});
