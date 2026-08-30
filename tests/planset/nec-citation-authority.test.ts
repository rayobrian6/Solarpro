// R9 - CODE CITATIONS AND PRODUCT CLASSES COME FROM A TABLE (2026-08-29)
//
// Every NEC section number in the repo was a bare string literal decided at its
// use site - 174 files carry a hardcoded `NEC <n>.<n>`. The adopted EDITION is
// properly single-sourced (snapshot.codeAuthority, sixteen consumers); the
// SECTION was not. So the package stamped an authoritative year onto sections
// that do not exist in it.
//
// The one that shipped: the deleted Article 690 Part III "Additional Provisions"
// section, cited in 13 files as the authority for the AC disconnect and printed
// on E-1 and the BOM under a NEC 2020 title block. It was removed in the 2017
// reorganisation and folded into 690.13 and 690.15.
//
// Also: `705.60` was cited for the 125% continuous-load multiplier (in NEC 2020
// that section is "Primary Power Source Connection" in the Microgrid article -
// the rule is 690.8(B)), and the fuse class contradicted the fuse part number -
// Littelfuse LLNRK is the Class RK1 line, FLNR is RK5.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { necSection, necCite, necRequires, RETIRED_SECTIONS } from '@/lib/nec/citations';

const ROOT = join(__dirname, '..', '..');

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, acc);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}
const FILES = [...sources(join(ROOT, 'lib')), ...sources(join(ROOT, 'app'))];

describe('a retired section is cited nowhere', () => {
  it('the deleted Article 690 Part III section appears in no source file', () => {
    const retired = RETIRED_SECTIONS['2020'] ?? [];
    expect(retired.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of FILES) {
      // the citations table itself names it, deliberately, to forbid it
      if (f.endsWith(join('lib', 'nec', 'citations.ts'))) continue;
      // 2026-08-29 - COMMENTS ARE NOT CITATIONS. A repair that removes a retired
      // section has to be able to SAY which section it removed, exactly as
      // citations.ts does (exempted whole, above). Stripping comments keeps the
      // guard strict on everything that ships - including a commented-out
      // citation, which is not shipped either - while letting the record of the
      // removal stand beside the code that used to carry it.
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*/g, '$1 ');
      for (const sec of retired) {
        // 2026-08-29 - `includes` matched a LONGER section that merely starts the
        // same way. Adding 690.5 (Ground-Fault Protection, deleted in the 2017
        // reorganisation and folded into 690.41(B)) made this flag fifteen files
        // whose only offence was citing 690.54 and 690.56, both of which are
        // current and correct. A section number ends where the next character is
        // not a digit; anything looser cannot tell a retired section from a live
        // one that shares its prefix.
        // NB the dot must be ESCAPED for the RegExp, or '690.5' matches '690X5'
        // and '$690:50' — which is how proposalTruthEngine.ts came to be accused
        // of citing a section it does not mention.
        const re = new RegExp(sec.replace(/\./g, '\\.') + '(?![0-9])');
        if (re.test(src)) offenders.push(`${f.slice(ROOT.length + 1)} cites ${sec}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('and the disconnecting means resolves to the section that replaced it', () => {
    expect(necSection('pv-disconnecting-means', '2020')).toBe('690.13');
    expect(necCite('pv-disconnecting-means', '2020')).toBe('NEC 2020 690.13');
    expect(necRequires('pv-disconnecting-means')).toMatch(/disconnecting means/i);
  });
});

describe('a citation and the thing it is cited FOR must match', () => {
  it('the continuous-load multiplier is 690.8(B), not a Microgrid section', () => {
    expect(necSection('pv-circuit-sizing-continuous')).toBe('690.8(B)');
    expect(necRequires('pv-circuit-sizing-continuous')).toMatch(/125%/);
  });

  it('rapid shutdown and its plaque are different sections', () => {
    expect(necSection('pv-rapid-shutdown')).toBe('690.12');
    expect(necSection('pv-rapid-shutdown-plaque')).not.toBe(necSection('pv-rapid-shutdown'));
    expect(necRequires('pv-rapid-shutdown')).toMatch(/initiation device/i);
  });

  it('705.60 is not cited for the continuous-load rule anywhere', () => {
    const offenders = FILES.filter(f => {
      // the citations table names the wrong pairing in order to forbid it
      if (f.endsWith(join('lib', 'nec', 'citations.ts'))) return false;
      const s = readFileSync(f, 'utf8');
      return /705\.60[^)]{0,40}(continuous|125)/i.test(s);
    });
    expect(offenders.map(f => f.slice(ROOT.length + 1))).toEqual([]);
  });
});

describe('a product class matches its part number', () => {
  it('LLNRK is Class RK1 — RK5 is the FLNR line', () => {
    const bom = readFileSync(join(ROOT, 'lib', 'bom-engine-v4.ts'), 'utf8');
    // wherever the LLNRK template appears, no RK5 claim may sit beside it
    expect(bom).toMatch(/LLNRK/);
    expect(bom, 'LLNRK cannot be Class RK5').not.toMatch(/Class RK5/);
  });
});
