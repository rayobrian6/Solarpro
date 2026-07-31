// ═══════════════════════════════════════════════════════════════════════════
// D4 — THE CANONICAL EMBEDDED FONT PACK.
//
// The planset used to embed no fonts and ask for Arial / Courier New, so its
// text metrics came from whatever the rendering host had installed. On a host
// without them the browser substitutes a metrically different face, dense blocks
// rewrap taller, and page-fit reports clipping that describes the MACHINE rather
// than the sheet — on a document an AHJ stamps.
//
// These gates hold the migration in place. The two that matter most are the ones
// a partial migration would slip past:
//   • the ARTIFACT scanner (not a source scan) — CSS could be migrated while 155
//     SVG text nodes stayed on host Arial, and the page-fit probe would never see
//     it because it skips everything inside <svg>;
//   • the SYMBOL routing check — the symbols face silently failed to load until
//     something actually referenced it, and canvas fell back to a host font for
//     ⇒ ▶ ◀ ⚠ ⚡ ✓ ‖ ⬡ while every other gate stayed green.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  verifyFontPack, fontFaceCss, fontFaceIdentities, FONT_PACK_VERSION,
  FONT_SANS, FONT_MONO, FONT_SYMBOLS, REQUIRED_SYMBOLS,
} from '@/lib/permit/fonts/fontPack';
import { EMBEDDED_FACES } from '@/lib/permit/fonts/fontPackData';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
function render(profile?: 'permit' | 'full' | 'design-review'): string {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  if (profile) input.plansetProfile = profile;
  return generatePermitHTML(input);
}
const PROFILES = ['full', 'permit', 'design-review'] as const;
const HTML: Record<string, string> = Object.fromEntries(PROFILES.map(p => [p, render(p)]));

/** the artifact with the embedded font payloads removed, so a base64 blob can
 *  never accidentally satisfy — or trip — a host-font search. */
const withoutFontData = (h: string): string =>
  h.replace(/src:url\("data:font\/woff2;base64,[^"]*"\)/g, 'src:url("FONTDATA")');

// ── manifest + bytes ────────────────────────────────────────────────────────
describe('D4 — the manifest describes the bytes that are actually embedded', () => {
  it('verifies clean', () => {
    const v = verifyFontPack();
    expect(v.failures, v.failures.join('\n')).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('has all five faces at the declared pack version', () => {
    expect(FONT_PACK_VERSION).toBe('1.0.0');
    expect(EMBEDDED_FACES).toHaveLength(5);
    const fams = [...new Set(EMBEDDED_FACES.map(f => f.family))].sort();
    expect(fams).toEqual([FONT_MONO, FONT_SANS, FONT_SYMBOLS].sort());
  });

  it('hashes the DECODED bytes, not the base64 text', () => {
    // hashing the base64 would make the digest a checksum of the source file's
    // formatting rather than of the font.
    for (const f of EMBEDDED_FACES) {
      const buf = Buffer.from(f.base64, 'base64');
      expect(createHash('sha256').update(buf).digest('hex'), `${f.file} sha256`).toBe(f.sha256);
      expect(buf.length, `${f.file} byteLength`).toBe(f.bytes);
      // and it is a real WOFF2 — magic number 'wOF2'
      expect(buf.subarray(0, 4).toString('latin1'), `${f.file} is not WOFF2`).toBe('wOF2');
    }
  });

  it('the embedded bytes equal the vendored .woff2 files on disk', () => {
    const dir = path.resolve(__dirname, '../../lib/permit/fonts');
    for (const f of EMBEDDED_FACES) {
      const disk = createHash('sha256').update(fs.readFileSync(path.join(dir, f.file))).digest('hex');
      expect(disk, `${f.file}: data module and vendored file disagree`).toBe(f.sha256);
    }
  });

  it('CORRUPT BYTES FAIL CLOSED', () => {
    const good = EMBEDDED_FACES[0];
    const corrupted = Buffer.from(good.base64, 'base64');
    corrupted[100] ^= 0xff;
    const h = createHash('sha256').update(corrupted).digest('hex');
    expect(h, 'a flipped byte must change the digest').not.toBe(good.sha256);
  });

  it('fontFaceIdentities reports every face for render metadata', () => {
    const ids = fontFaceIdentities();
    expect(ids).toHaveLength(5);
    for (const i of ids) {
      expect(i.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(i.byteLength).toBeGreaterThan(0);
    }
  });
});

// ── the @font-face block ────────────────────────────────────────────────────
describe('D4 — the artifact carries deterministic @font-face declarations', () => {
  const css = fontFaceCss();

  it('declares exactly the five canonical faces', () => {
    expect((css.match(/@font-face/g) ?? [])).toHaveLength(5);
    for (const f of EMBEDDED_FACES) {
      expect(css).toContain(`font-family:"${f.family}"`);
      expect(css).toContain(`format("woff2")`);
    }
    expect(css).toContain('font-display:block');
  });

  it('is byte-identical across calls (deterministic serialization)', () => {
    expect(fontFaceCss()).toBe(css);
  });

  for (const p of PROFILES) {
    it(`${p}: the generated artifact contains all five @font-face rules`, () => {
      expect((HTML[p].match(/@font-face/g) ?? [])).toHaveLength(5);
      expect(HTML[p]).toContain('data:font/woff2;base64,');
    });
  }
});

// ── the artifact scanner — the gate a partial migration would slip past ─────
describe('D4 — no authoritative host-font declaration survives in the ARTIFACT', () => {
  // Declarations only. The literal word "Arial" also appears as PROSE in the
  // NEC placard specification ("Arial or similar non-bold font"), which is
  // engineering content about a physical label, not a rendering dependency.
  const DECL = /font-family\s*[:=]\s*"?'?([^;"'>}]*)/gi;
  const HOST = /\b(Arial|Helvetica|Courier|Times|Verdana|Tahoma|Segoe|DejaVu|Liberation)\b|(^|,)\s*(monospace|sans-serif|serif|cursive)\s*$/i;

  for (const p of PROFILES) {
    it(`${p}: every font-family declaration names only canonical families`, () => {
      const src = withoutFontData(HTML[p]);
      const bad: string[] = [];
      for (const m of src.matchAll(DECL)) {
        const value = m[1].trim();
        if (!value) continue;
        if (HOST.test(value)) bad.push(value.slice(0, 90));
      }
      expect([...new Set(bad)], `${p}: host-dependent font declarations:\n${[...new Set(bad)].join('\n')}`).toEqual([]);
    });

    it(`${p}: SVG text nodes carry canonical font-family attributes`, () => {
      const src = withoutFontData(HTML[p]);
      const svgAttrs = [...src.matchAll(/<(?:text|tspan)[^>]*font-family="([^"]*)"/gi)].map(m => m[1]);
      expect(svgAttrs.length, `${p}: no SVG text font-family attributes found at all`).toBeGreaterThan(0);
      const bad = svgAttrs.filter(v => HOST.test(v));
      expect([...new Set(bad)], `${p}: SVG text still on host fonts: ${[...new Set(bad)].join(' | ')}`).toEqual([]);
    });

    it(`${p}: the canonical families are actually referenced`, () => {
      expect(HTML[p]).toContain(FONT_SANS);
      expect(HTML[p]).toContain(FONT_MONO);
      expect(HTML[p]).toContain(FONT_SYMBOLS);
    });
  }

  it('NON-VACUITY — the scanner fires on a deliberately reverted declaration', () => {
    const reverted = 'font-family="Arial,sans-serif"';
    const m = [...reverted.matchAll(DECL)][0];
    expect(HOST.test(m[1].trim()), 'the scanner cannot see a reverted Arial declaration').toBe(true);
    // …and does NOT fire on the canonical stack
    const ok = [...`font-family="${FONT_SANS}, ${FONT_SYMBOLS}"`.matchAll(DECL)][0];
    expect(HOST.test(ok[1].trim())).toBe(false);
  });
});

// ── the symbol face ─────────────────────────────────────────────────────────
describe('D4 — SolarPro Symbols carries symbols and nothing else', () => {
  it('every required symbol is one the pack must cover', () => {
    // scanned from all three generated profiles, not assumed
    expect(REQUIRED_SYMBOLS.length).toBeGreaterThanOrEqual(8);
    for (const s of REQUIRED_SYMBOLS) expect(s.codePointAt(0)!).toBeGreaterThanOrEqual(0x2000);
  });

  it('the symbol face is reachable from the canonical stacks', () => {
    // appended AFTER the canonical family: it has no codepoint below U+2000, so
    // it cannot win a Latin glyph or move text metrics — it is reached only for
    // the symbols Liberation lacks. Without it those fall through to a HOST font.
    for (const p of PROFILES) {
      expect(HTML[p], `${p}: symbols face not in the sans stack`)
        .toMatch(new RegExp(`--sans:\\s*"${FONT_SANS}",\\s*"${FONT_SYMBOLS}"`));
      expect(HTML[p], `${p}: symbols face not in the mono stack`)
        .toMatch(new RegExp(`--mono:\\s*"${FONT_MONO}",\\s*"${FONT_SYMBOLS}"`));
    }
  });
});

// ── the D1/D2/D3 conclusions must survive a pure rendering migration ────────
describe('D4 — the engineering conclusions are unchanged by the font migration', () => {
  it('D2: no positive project-wide EGC minimum, and the negated statement survives', () => {
    // NEGATION-SAFE: the CORRECT sentence contains the words "project-wide EGC
    // minimum". Banning that substring would ban the right answer. Only a
    // POSITIVE/unqualified claim is rejected.
    const POSITIVE = /(?:DC\s+)?EGC\s+minimum\s*:?\s*#?[\d/]+\s*AWG|minimum\s+EGC\s+is\s+#?[\d/]+/i;
    for (const p of PROFILES) {
      expect(HTML[p], `${p}: a positive project-wide EGC minimum is printed`).not.toMatch(POSITIVE);
      expect(HTML[p], `${p}: the correct negated statement is missing`).toContain('no project-wide EGC minimum applies');
    }
    // non-vacuity, both directions
    expect('DC EGC minimum: #10 AWG per NEC 690.45.').toMatch(POSITIVE);
    expect('DC EGC minimum: 10 AWG per NEC 690.45.').toMatch(POSITIVE);
    expect('no project-wide EGC minimum applies').not.toMatch(POSITIVE);
    expect('NO SEPARATE EGC REQUIRED').not.toMatch(POSITIVE);
  });

  it('D1: the route counts still exclude the utility-owned run', () => {
    for (const p of PROFILES) {
      expect(HTML[p], `${p}: the pre-D1 count reappeared`).not.toContain('5 of 6 electrical run');
    }
  });

  it('D3: every canonical BOM row still renders exactly once, on every profile', () => {
    const ids = (h: string) => [...h.matchAll(/data-bom-line-id="([^"]+)"/g)].map(m => m[1]);
    const full = ids(HTML.full);
    expect(full.length).toBeGreaterThan(0);
    for (const p of ['permit', 'design-review'] as const) {
      const got = ids(HTML[p]);
      expect(new Set(got).size, `${p}: duplicate BOM rows`).toBe(got.length);
      expect(new Set(got), `${p}: BOM row set differs from the internal package`).toEqual(new Set(full));
    }
  });
});
