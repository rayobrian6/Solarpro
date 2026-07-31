// ═══════════════════════════════════════════════════════════════════════════
// THE CANONICAL FONT PACK — the single authority for planset text rendering.
//
// The planset used to embed no fonts and ask for Arial / Courier New. Text
// metrics therefore came from whatever the rendering host happened to have
// installed: a host without them substitutes a metrically different face, dense
// blocks rewrap taller, and page-fit reports clipping that describes the MACHINE
// rather than the sheet. That is not a cosmetic problem on a permit drawing —
// it is the difference between a schedule that fits its page and one that does
// not, on a document an AHJ stamps.
//
// This module embeds the exact bytes. Liberation Sans / Liberation Mono are
// metric-compatible with Arial / Courier New, so embedding them REPRODUCES the
// accepted geometry rather than reflowing it; `SolarPro Symbols` carries the
// symbols neither Liberation face has, subset to codepoints ≥ U+2000 so it can
// never win a Latin glyph.
//
// EVERY authoritative text surface — CSS, tables, title blocks, and every SVG
// text node — resolves to these three families and nothing else. There is no
// host fallback on the authoritative path: a missing face must FAIL, not
// silently degrade to whatever the machine has.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { EMBEDDED_FACES, FONT_PACK_VERSION, type EmbeddedFace } from './fontPackData';
import manifest from './font-pack.manifest.json';

export { FONT_PACK_VERSION };

/** THE canonical family names. Every renderer imports these — never a literal.
 *  179 hardcoded family strings is how the codebase got here in the first place. */
export const FONT_SANS = 'SolarPro Sans';
export const FONT_MONO = 'SolarPro Mono';
export const FONT_SYMBOLS = 'SolarPro Symbols';

/** SVG `font-family` attribute values. Identical to the CSS families — named
 *  separately so an SVG generator reads as an SVG generator at the call site. */
export const SVG_FONT_SANS = FONT_SANS;
export const SVG_FONT_MONO = FONT_MONO;
export const SVG_FONT_SYMBOLS = FONT_SYMBOLS;

/** The six symbols Liberation does not carry, plus the two found by scanning all
 *  three profiles (‖ U+2016 which Liberation MONO lacks, and ⬡ U+2B21 which
 *  NEITHER face has). Asserted covered by test — a new symbol fails closed. */
export const REQUIRED_SYMBOLS = ['⇒', '▶', '◀', '⚠', '⚡', '✓', '‖', '⬡'] as const;

export interface FontFaceIdentity {
  family: string;
  weight: number;
  style: string;
  sha256: string;
  byteLength: number;
}

/** What the artifact records about the fonts that rendered it. */
export interface RenderingEnvironment {
  engineVersion: string;
  fontPackVersion: string;
  fontFaces: FontFaceIdentity[];
}

/** SHA-256 of the DECODED bytes — never of the base64 text, which changes with
 *  formatting and would make the hash a checksum of the source file rather than
 *  of the font. */
function decodedSha256(face: EmbeddedFace): { sha256: string; byteLength: number } {
  const buf = Buffer.from(face.base64, 'base64');
  return { sha256: createHash('sha256').update(buf).digest('hex'), byteLength: buf.length };
}

export interface FontPackVerification {
  ok: boolean;
  packVersion: string;
  faces: Array<FontFaceIdentity & { file: string; verified: boolean; reason?: string }>;
  failures: string[];
}

/**
 * Verify the embedded bytes against the manifest — the check that must pass
 * before any authoritative render. It compares the DECODED bytes' hash and
 * length to the manifest, and requires the face set to match exactly in both
 * directions (a missing face and an unexpected extra face are both failures).
 */
export function verifyFontPack(): FontPackVerification {
  const failures: string[] = [];
  const manifestFaces = (manifest as { faces: Array<{ file: string; family: string; weight: string; style: string; sha256: string; bytes: number }> }).faces;
  const faces = EMBEDDED_FACES.map(f => {
    const { sha256, byteLength } = decodedSha256(f);
    const m = manifestFaces.find(x => x.file === f.file);
    let verified = true;
    let reason: string | undefined;
    if (!m) { verified = false; reason = `no manifest entry for ${f.file}`; }
    else if (m.sha256 !== sha256) { verified = false; reason = `sha256 mismatch: embedded ${sha256.slice(0, 16)} vs manifest ${m.sha256.slice(0, 16)}`; }
    else if (m.bytes !== byteLength) { verified = false; reason = `byte length mismatch: embedded ${byteLength} vs manifest ${m.bytes}`; }
    else if (f.sha256 !== sha256) { verified = false; reason = `declared sha256 does not match the bytes it labels`; }
    if (!verified) failures.push(`${f.file}: ${reason}`);
    return { file: f.file, family: f.family, weight: Number(f.weight), style: f.style, sha256, byteLength, verified, reason };
  });
  // both directions: every manifest face must be embedded, and vice versa
  for (const m of manifestFaces) {
    if (!EMBEDDED_FACES.some(f => f.file === m.file)) failures.push(`${m.file}: in the manifest but NOT embedded`);
  }
  const packVersion = (manifest as { packVersion: string }).packVersion;
  if (packVersion !== FONT_PACK_VERSION) {
    failures.push(`pack version mismatch: data module ${FONT_PACK_VERSION} vs manifest ${packVersion}`);
  }
  return { ok: failures.length === 0, packVersion: FONT_PACK_VERSION, faces, failures };
}

/** The identities recorded in snapshot / render metadata. */
export function fontFaceIdentities(): FontFaceIdentity[] {
  return EMBEDDED_FACES.map(f => {
    const { sha256, byteLength } = decodedSha256(f);
    return { family: f.family, weight: Number(f.weight), style: f.style, sha256, byteLength };
  });
}

/**
 * The `@font-face` block for the artifact stylesheet.
 *
 * `font-display: block` is deliberate: an authoritative drawing must never paint
 * a frame in a fallback face. Deterministic order (the data module's order) so
 * two generations of identical input produce byte-identical CSS.
 *
 * THROWS on a verification failure. Emitting a stylesheet that references bytes
 * we have not verified would defeat the point of embedding them.
 */
export function fontFaceCss(): string {
  const v = verifyFontPack();
  if (!v.ok) {
    throw new Error(
      'CANONICAL FONT PACK FAILED VERIFICATION — refusing to emit a planset stylesheet.\n'
      + v.failures.map(f => `  • ${f}`).join('\n')
      + '\nThe embedded font bytes do not match the manifest. Authoritative rendering is not possible.',
    );
  }
  return EMBEDDED_FACES.map(f =>
    `@font-face{font-family:"${f.family}";src:url("data:font/woff2;base64,${f.base64}") format("woff2");font-style:${f.style};font-weight:${f.weight};font-display:block;}`,
  ).join('\n');
}
