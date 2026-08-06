// ═══════════════════════════════════════════════════════════════════════════
// D13 — ONE ASCE PROVENANCE.
//
// THE DEFECT. The ASCE edition was asserted TWICE in the snapshot, from one
// hardcoded constant, under two different — and both false — provenance claims.
//
//   build.ts:1070   asceEdition: `ASCE ${necFromRecord ? '7-22' : '7-22'}`
//   build.ts:1071   asceSource:  necFromRecord ? 'ahj-record' : 'pending-w4-ahj-authority'
//
// The first is a ternary whose two branches are identical — a constant wearing
// the costume of a derivation. The second genuinely varies, and when the NEC
// edition came from the curated AHJ record it labels the ASCE edition
// `'ahj-record'`, attributing a compiled-in constant to the AHJ registry. The
// registry does not carry an ASCE edition at all; `buildCodeAuthority` says so
// itself about IBC/IRC/IFC ("the AHJ DB does not carry them — no inference").
//
// That value then flows structural.env.codeAuthority → asceEngineBasis →
// codeAuthority.editions.asce, where it is re-labelled `'structural-engine-basis'`.
// One constant, two records, two provenances, neither true.
//
// AND A DISCARDED AUTHORITY, the same shape as D4's dropped patch key:
// `adoptFor('asce')` is never called. `CODE_EDITION_KINDS` includes `'asce'` and
// `code-authority@v1` can retrieve an adopted ASCE edition with a source hash —
// and `buildCodeAuthority` overwrites it unconditionally with the engine basis.
// A real, hashed AHJ adoption fact was structurally unreachable.
//
// THE RULE THESE TESTS PIN. One resolver decides the ASCE edition, from ordered
// real authorities — AHJ adoption retrieval, then the hazard retrieval the
// design values were actually computed from, then the engine's own default —
// and it never claims an authority that did not supply the value. When adoption
// and computation name different editions that is a CONFLICT a reviewer sees,
// not something reconciled silently.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  resolveAsceEditionAuthority, ENGINE_DEFAULT_ASCE_EDITION,
} from '@/lib/permit/snapshot/asceAuthority';
import { buildCodeAuthority } from '@/lib/permit/snapshot/codeAuthority';

const NOW = '2026-08-06T12:00:00.000Z';
const SHA = 'a'.repeat(64);

const adoption = (asce: string | null) => ({
  schemaVersion: '1.0.0' as const,
  resolverId: 'code-authority@v1',
  ahjName: 'Madison County Building & Zoning',
  jurisdictionType: 'county',
  buildingAhj: 'Madison County Building & Zoning',
  electricalAhj: 'Madison County Building & Zoning',
  fireAhj: 'Nameoki Fire Protection District',
  permitOffice: { name: 'Madison County Building & Zoning', phone: null, email: null, url: null, address: null },
  editions: [
    { kind: 'nec', edition: '2020', registryField: 'ElectricalCode', raw: '2020NEC', corroboratedBy: 'AHJ registry', conflictsWith: null },
    ...(asce ? [{ kind: 'asce', edition: asce, registryField: 'StructuralCode', raw: `ASCE ${asce}`, corroboratedBy: 'AHJ registry', conflictsWith: null }] : []),
  ],
  localAmendments: [], effectiveDate: '2024-01-01', engineeringReviewRequirements: [],
  conflicts: [], sourceDocument: 'Madison County adopted-code ordinance',
  officialSource: 'AHJ registry', sourceRevision: '2026-07', sourceDate: '2026-07-01',
  sourceHash: SHA, verifiedBy: 'retrieval:code-authority@v1', retrievedAtIso: NOW,
  sourcesQueried: ['ahj-registry'], confidence: 1,
}) as never;

const hazard = (edition: string) => ({
  resolverId: 'environmental-retrieval@v1', edition, sourceHash: SHA,
  proof: 'live-retrieval',
}) as never;

// ═══════════════════════════════════════════════════════════════════════════
// 1 — THE RESOLVER: ORDERED, REAL AUTHORITIES ONLY
// ═══════════════════════════════════════════════════════════════════════════

describe('D13 · one resolver, ordered authorities', () => {
  it('1 — with nothing on file it is the ENGINE DEFAULT, and says so', () => {
    const a = resolveAsceEditionAuthority({});
    expect(a.edition).toBe(ENGINE_DEFAULT_ASCE_EDITION);
    expect(a.source).toBe('engine-default');
    expect(a.adoptedEdition).toBeNull();
    expect(a.computedEdition).toBeNull();
    expect(a.conflict).toBe(false);
    // it must NEVER claim the AHJ registry supplied it
    expect(a.source).not.toBe('ahj-record');
    expect(a.basis).toMatch(/no adopted|no.*retrieval|default/i);
  });

  it('2 — the hazard retrieval the design values came from is a real authority', () => {
    const a = resolveAsceEditionAuthority({ environmentalRetrieval: hazard('ASCE 7-16') });
    expect(a.edition).toBe('7-16');
    expect(a.source).toBe('environmental-retrieval');
    expect(a.computedEdition).toBe('7-16');
    expect(a.ref).toContain(SHA.slice(0, 16));
  });

  it('3 — an AHJ ADOPTION retrieval outranks the computational basis', () => {
    const a = resolveAsceEditionAuthority({
      codeAdoption: adoption('7-16'), environmentalRetrieval: hazard('ASCE 7-16'),
    });
    expect(a.edition).toBe('7-16');
    expect(a.source).toBe('ahj-adoption-retrieval');
    expect(a.adoptedEdition).toBe('7-16');
    expect(a.conflict).toBe(false);
  });

  it('4 — adoption and computation naming DIFFERENT editions is a conflict, not a merge', () => {
    const a = resolveAsceEditionAuthority({
      codeAdoption: adoption('7-16'), environmentalRetrieval: hazard('ASCE 7-22'),
    });
    expect(a.conflict).toBe(true);
    expect(a.adoptedEdition).toBe('7-16');
    expect(a.computedEdition).toBe('7-22');
    // the ADOPTED edition is what applies; the disagreement is stated, not hidden
    expect(a.edition).toBe('7-16');
    expect(a.conflictDetail).toMatch(/7-16/);
    expect(a.conflictDetail).toMatch(/7-22/);
  });

  it('5 — a CONFLICTED adoption retrieval supplies nothing (the WS-3 rule holds)', () => {
    const conflicted = { ...(adoption('7-16') as unknown as Record<string, unknown>), conflicts: ['sources disagree'] };
    const a = resolveAsceEditionAuthority({
      codeAdoption: conflicted as never, environmentalRetrieval: hazard('ASCE 7-22'),
    });
    expect(a.adoptedEdition).toBeNull();
    expect(a.source).toBe('environmental-retrieval');
    expect(a.edition).toBe('7-22');
  });

  it('6 — the source is never a value the AHJ record cannot supply', () => {
    for (const args of [{}, { environmentalRetrieval: hazard('ASCE 7-22') }, { codeAdoption: adoption('7-22') }]) {
      const a = resolveAsceEditionAuthority(args as never);
      expect(['ahj-adoption-retrieval', 'environmental-retrieval', 'engine-default']).toContain(a.source);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — THE CODE-AUTHORITY RECORD PROJECTS THE SAME DECISION
// ═══════════════════════════════════════════════════════════════════════════

describe('D13 · codeAuthority.editions.asce is a projection, not a second opinion', () => {
  it('7 — a RETRIEVED adopted ASCE edition is no longer discarded', () => {
    const rec = buildCodeAuthority({
      ahjRecord: null, capturedAtIso: NOW,
      codeAdoption: adoption('7-16'),
      // the engine basis says something else; adoption is the adoption authority
      asceEngineBasis: 'ASCE 7-22',
    } as never);
    expect(rec.editions.asce.edition).toBe('7-16');
    expect(rec.editions.asce.source).toBe('ahj-registry-retrieval');
  });

  it('8 — with no adoption it reports the computational basis, labelled as such', () => {
    const rec = buildCodeAuthority({
      ahjRecord: null, capturedAtIso: NOW, asceEngineBasis: 'ASCE 7-22',
    } as never);
    expect(rec.editions.asce.edition).toBe('7-22');
    expect(rec.editions.asce.source).toBe('structural-engine-basis');
    expect(rec.editions.asce.provenance.note).toMatch(/not an AHJ adoption claim/i);
  });

  it('9 — the two records never disagree about the edition', () => {
    for (const [adopt, basis, expected] of [
      [adoption('7-16'), 'ASCE 7-22', '7-16'],
      [null, 'ASCE 7-22', '7-22'],
      [adoption('7-22'), 'ASCE 7-22', '7-22'],
    ] as const) {
      const rec = buildCodeAuthority({ ahjRecord: null, capturedAtIso: NOW, codeAdoption: adopt, asceEngineBasis: basis } as never);
      const one = resolveAsceEditionAuthority({ codeAdoption: adopt as never, environmentalRetrieval: { edition: basis } as never });
      expect(rec.editions.asce.edition).toBe(expected);
      expect(one.edition).toBe(expected);
    }
  });
});
