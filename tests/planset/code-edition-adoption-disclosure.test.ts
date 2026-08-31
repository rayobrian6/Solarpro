// ═══════════════════════════════════════════════════════════════════════════
// AN UNVERIFIED EDITION MUST SAY SO — §12.
//
// `labelOf` consulted the edition SOURCE only when the edition was null. A year
// read from an unprovenanced state table therefore rendered identically to one
// retrieved from the AHJ with a citation and a source hash:
//
//     NEC 2020        <- state-adoption-table, zero evidence
//     NEC 2020        <- ahj-registry-retrieval, cited + hashed
//
// and the SAME title block printed that bare year beside "IBC PER AHJ ADOPTION",
// which reads as "the NEC edition is settled and the I-codes are not". The NEC
// producer audit puts 5 of 6 producers at zero adoption evidence, with 1,757
// jurisdictions where they disagree — so the asymmetry was not earned.
//
// The edition SELECTION is unchanged. Only the claim about it is.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  projectCodeAuthority, UNVERIFIED_ADOPTION_SUFFIX,
} from '@/lib/permit/snapshot/codeAuthorityProjection';

const snapWith = (kind: string, edition: string | null, source: string) =>
  ({ codeAuthority: { editions: { [kind]: { edition, source } } } } as never);

describe('the label distinguishes a verified adoption from a design basis', () => {
  it('an evidence-bearing retrieval prints the bare edition', () => {
    // A real retrieval carries sourcesQueried + a sourceHash. That IS the
    // evidence, so the year stands unqualified.
    const cp = projectCodeAuthority(snapWith('nec', '2020', 'ahj-registry-retrieval'));
    expect(cp.label('nec')).toBe('NEC 2020');
  });

  it('an unprovenanced state-table year discloses that it is a design basis', () => {
    const cp = projectCodeAuthority(snapWith('nec', '2020', 'state-adoption-table'));
    expect(cp.label('nec')).toBe(`NEC 2020 ${UNVERIFIED_ADOPTION_SUFFIX}`);
  });

  it('a project record with no provenance also discloses it', () => {
    // This is the class that used to be published as "entered by the operator".
    const cp = projectCodeAuthority(snapWith('nec', '2020', 'project-record-unprovenanced'));
    expect(cp.label('nec')).toContain(UNVERIFIED_ADOPTION_SUFFIX);
  });

  it('the bundled AHJ record is NOT evidence — 0 of 4,016 rows are provenanced', () => {
    const cp = projectCodeAuthority(snapWith('nec', '2020', 'ahj-record'));
    expect(cp.label('nec')).toContain(UNVERIFIED_ADOPTION_SUFFIX);
  });

  it('ASCE from the structural engine stays bare — it is self-describing', () => {
    // The engine literally RAN under this edition, so the basis is the fact.
    // codeAuthority.ts says it: "It is not an adoption claim and never says it is."
    const cp = projectCodeAuthority(snapWith('asce', '7-22', 'structural-engine-basis'));
    expect(cp.label('asce')).toBe('ASCE 7-22');
  });

  it('an absent edition still defers rather than fabricating', () => {
    const cp = projectCodeAuthority(snapWith('ibc', null, 'edition-per-ahj-adoption'));
    expect(cp.label('ibc')).toBe('IBC PER AHJ ADOPTION');
  });
});

describe('no consumer rebuilds the label from the raw token', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('certPages composes its "Prepared under" strip from labels only', () => {
    // These printed `${_cpF.ibcLabel} • NEC ${necVer}` — a labelled I-code and a
    // raw NEC year in ONE sentence, reproducing the exact asymmetry.
    const src = read('lib/permit/sections/certPages.ts');
    expect(src).not.toMatch(/Prepared under[^`]*NEC \$\{necVer\}/);
  });

  it('no sheet calls a bare year "the adopted edition"', () => {
    // "the adopted edition of the National Electrical Code (NEC 2020)" equated
    // our design basis with the AHJ's adoption.
    const src = read('lib/permit/sections/compliancePages.ts');
    expect(src).not.toMatch(/adopted edition of the National Electrical Code \(NEC \$\{/);
  });
});

describe('the rendered artifact agrees', () => {
  it('every tagged edition either cites evidence or discloses its basis', () => {
    let html: string;
    try { html = readFileSync(join(process.cwd(), '_tmp_prod.html'), 'utf8'); }
    catch { return; }   // artifact not generated here; the unit tests still bind

    const tags = [...html.matchAll(/data-code-edition="(\w+)">([^<]*)/g)]
      .map(m => ({ kind: m[1], label: m[2] }));
    expect(tags.length).toBeGreaterThan(0);

    for (const t of tags) {
      // ASCE is the one self-describing basis; everything else must either be
      // deferred, pending, or explicitly marked as a design basis.
      if (t.kind === 'asce') continue;
      const honest = /PER AHJ ADOPTION|PENDING|\(DESIGN BASIS\)/.test(t.label);
      expect(honest, `"${t.label}" asserts an edition with no disclosed basis`).toBe(true);
    }
  });
});

describe('a verified record is evidence on its own', () => {
  it('an archived adoption document lets the bare edition stand', () => {
    // codeAuthority refuses to mark a state adoption 'verified' — it is a
    // "stated basis, NOT an archived adoption document". So verified means a
    // real document was obtained, whatever token carried the year.
    const snap = {
      codeAuthority: {
        verificationStatus: 'verified',
        editions: { nec: { edition: '2023', source: 'ahj-record' } },
      },
    } as never;
    expect(projectCodeAuthority(snap).label('nec')).toBe('NEC 2023');
  });

  it('but an unverified record with the same token still discloses', () => {
    const snap = {
      codeAuthority: {
        verificationStatus: 'unverified',
        editions: { nec: { edition: '2023', source: 'ahj-record' } },
      },
    } as never;
    expect(projectCodeAuthority(snap).label('nec')).toContain(UNVERIFIED_ADOPTION_SUFFIX);
  });
});
