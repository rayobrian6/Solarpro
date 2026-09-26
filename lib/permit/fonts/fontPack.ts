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

// ═══════════════════════════════════════════════════════════════════════════
// CSS FONT STACKS FOR INLINE `style="…"` ATTRIBUTES.
//
// THE DEFECT THESE CLOSE. Forty-six renderer call sites hand-wrote the stack
// with DOUBLE quotes inside a DOUBLE-quoted HTML attribute:
//
//     style="font-family:"SolarPro Mono","SolarPro Symbols";font-size:6.4px;"
//              ─────────┬────────────────────────────────┬─
//              the attribute ENDS here ───────────────────┘
//
// The parser closes `style` at the first inner quote, and everything after it
// becomes stray attributes. The declared font never applies, and the emitted
// markup is invalid. It appears in the shipped Braidon artifact.
//
// CSS font-family names may be quoted with SINGLE quotes, which nest safely
// inside a double-quoted attribute. These constants are the ONLY correct way to
// write the stack inline — no call site may spell it out again.
// ═══════════════════════════════════════════════════════════════════════════

/** `font-family` value for an inline style attribute — sans + symbol fallback. */
export const CSS_FONT_SANS_STACK = `'${FONT_SANS}','${FONT_SYMBOLS}'`;
/** `font-family` value for an inline style attribute — mono + symbol fallback. */
export const CSS_FONT_MONO_STACK = `'${FONT_MONO}','${FONT_SYMBOLS}'`;
/** `font-family` value for an inline style attribute — symbols only. */
export const CSS_FONT_SYMBOLS_STACK = `'${FONT_SYMBOLS}'`;
/** Sans with the generic UI fallbacks, for pages that degrade outside the pack. */
export const CSS_FONT_SANS_UI_STACK = `'${FONT_SANS}',Helvetica,Arial,sans-serif`;

/** Matches the malformed construction: a double-quoted family name inside a
 *  `style="…"` attribute. Exported so the regression test and any future audit
 *  share ONE definition of "malformed" rather than two that can drift. */
export const MALFORMED_STYLE_FONT_FAMILY_RE = /style="[^"]*font-family:\s*"/;

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
  requireVerifiedPack('a planset stylesheet');
  return EMBEDDED_FACES.map(faceRule).join('\n');
}

/** Fail closed before ANY bytes are emitted — the planset stylesheet and a
 *  standalone SVG alike. One check, so the two cannot disagree on "verified". */
function requireVerifiedPack(what: string): void {
  const v = verifyFontPack();
  if (!v.ok) {
    throw new Error(
      `CANONICAL FONT PACK FAILED VERIFICATION — refusing to emit ${what}.\n`
      + v.failures.map(f => `  • ${f}`).join('\n')
      + '\nThe embedded font bytes do not match the manifest. Authoritative rendering is not possible.',
    );
  }
}

/** ONE serialisation of a face. fontFaceCss() and withStandaloneSvgFonts() both
 *  use it, so the SVG a user downloads declares the face byte-for-byte as the
 *  permit does. */
function faceRule(f: EmbeddedFace): string {
  return `@font-face{font-family:"${f.family}";src:url("data:font/woff2;base64,${f.base64}") format("woff2");font-style:${f.style};font-weight:${f.weight};font-display:block;}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// OUTSIDE THE ARTIFACT — every place a drawing SVG is shown WITHOUT the pack.
//
// The permit HTML and the SLD PDF carry fontFaceCss(). Nothing else did. The
// Diagram tab inlines the renderer's SVG into the app page, a downloaded .svg
// opens in whatever viewer the user has, and librsvg (sharp) rasterises through
// fontconfig. In all three, `font-family="SolarPro Sans, SolarPro Symbols"`
// named two families that did not exist and no generic, so the browser painted
// its DEFAULT face — a serif, with advances unlike the Liberation Sans ones every
// label on the sheet was placed for. Ray reviews the one-line on that screen.
//
// 🚨 A RENDERER NEVER WRITES THE STACKS BELOW INTO A NODE ATTRIBUTE. The same
// SLD markup is E-1 of the permit, where there is no host fallback on the
// authoritative path (this file's header), and
// tests/planset/d4-canonical-font-pack.test.ts fails on any Arial / Helvetica /
// Liberation / sans-serif in an SVG text attribute. The fallbacks are applied at
// the BOUNDARY instead, by CSS keyed on the canonical attribute value — a
// stylesheet rule outranks an SVG presentation attribute. app/globals.css does
// it for every SVG inlined in the app; withStandaloneSvgFonts() does it for an
// SVG that leaves the app. The renderer's bytes, E-1 and its digest do not move.
//
// 🚨 WHY THE APP DOES NOT SERVE THE PACK'S .woff2 FROM /public. The README rules
// these bytes "embedded inside the generated artifact only", and the bytes say
// why. They are fontTools subsets that still call themselves "Liberation Sans" /
// "Liberation Mono" (name IDs 1, 4, 6 — "Liberation" is the Reserved Font Name
// of their SIL OFL 1.1 licence) and carry no licence text (the subsetter kept
// name IDs 0–6 only). The OFL FAQ treats a subset as a Modified Version (§2.6)
// and asks a web font to carry its licence in its own metadata (§2.4).
// Publishing them at a URL needs a renamed, licence-carrying rebuild first — a
// pack v2, not a file copy. The app aliases the canonical names to the
// metric-compatible face the machine already has (globals.css `local()`), which
// serves no bytes at all and puts every label in the box it has on the permit.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Installed faces with the SAME advance widths as each canonical family, in
 * preference order. Liberation is the pack's own source; Arimo / Cousine are
 * the Chrome OS faces Liberation 2.x was built from; Arial / Courier New are the
 * faces Liberation was drawn to match, and Helvetica / Courier the faces THEY
 * were drawn to match. Anything else (DejaVu Sans, Verdana, Segoe UI) spaces
 * text differently — the reflow the pack exists to prevent — so it is not here.
 */
export const METRIC_COMPATIBLE_FALLBACKS = {
  [FONT_SANS]: ['Liberation Sans', 'Arimo', 'Arial', 'Helvetica'],
  [FONT_MONO]: ['Liberation Mono', 'Cousine', 'Courier New', 'Courier'],
} as const;

/**
 * SVG `font-family` stacks WITH metric-compatible fallbacks, for contexts that
 * cannot load the pack. The generic comes LAST, after a metric-compatible face,
 * so it is reached only on a machine that has none of them. Unquoted — CSS reads
 * a multi-word family as bare identifiers — so the same string is valid inside a
 * double-quoted attribute and inside a CSS rule.
 *
 * Applied through CSS at the boundary, never as a renderer's node attribute
 * (see the section header above).
 */
export const SVG_FONT_SANS_STACK =
  [FONT_SANS, FONT_SYMBOLS, ...METRIC_COMPATIBLE_FALLBACKS[FONT_SANS], 'sans-serif'].join(', ');
export const SVG_FONT_MONO_STACK =
  [FONT_MONO, FONT_SYMBOLS, ...METRIC_COMPATIBLE_FALLBACKS[FONT_MONO], 'monospace'].join(', ');

/**
 * The rules that give a canonical attribute its fallbacks. No font bytes.
 * `*=` rather than `^=` so a quoted spelling (`'SolarPro Sans'`) matches too.
 * app/globals.css carries the same two rules for the app page;
 * tests/sldFontsLoadEverywhere.test.ts holds them equal.
 */
export function svgFontFallbackCss(): string {
  return `[font-family*="${FONT_SANS}"]{font-family:${SVG_FONT_SANS_STACK}}\n`
    + `[font-family*="${FONT_MONO}"]{font-family:${SVG_FONT_MONO_STACK}}`;
}

/** Carried by the <style> withStandaloneSvgFonts() inserts, so a second pass is
 *  a no-op rather than a second copy of the pack (≈290 KB of base64). */
export const STANDALONE_SVG_FONT_MARKER = 'data-solarpro-font-pack';

/**
 * An SVG that is about to LEAVE the app — a download, a stored project file —
 * made to render in the permit's face wherever it is opened.
 *
 * Inserts one <style> as the first child of the root <svg>: the verified pack
 * faces for every canonical family the SVG names (an SLD names all three — its
 * symbol labels, lib/sld-symbols.ts, are Mono bold — so a 78 KB sheet grows by
 * ≈290 KB), then the fallback rules for viewers that ignore an embedded
 * @font-face (Inkscape, librsvg). `embedFaces: false` keeps only the fallback
 * rules — about 300 bytes — for a copy stored per project.
 *
 * The embedded faces are INSIDE the artifact, which is the one place the README
 * allows these bytes to go. Throws, like fontFaceCss(), if they fail
 * verification.
 *
 * 🚨 NEVER on the permit path. E-1 sits inside an HTML document that already
 * carries fontFaceCss(), and its SVG bytes are what the planset tests pin.
 */
export function withStandaloneSvgFonts(svg: string, opts: { embedFaces?: boolean } = {}): string {
  if (svg.includes(STANDALONE_SVG_FONT_MARKER)) return svg;
  const root = /<svg\b[^>]*>/.exec(svg);
  if (!root) return svg;
  let faces = '';
  if (opts.embedFaces !== false) {
    const named = EMBEDDED_FACES.filter(f => svg.includes(f.family));
    if (named.length) {
      requireVerifiedPack('a standalone SVG');
      faces = named.map(faceRule).join('\n') + '\n';
    }
  }
  const style = `<style ${STANDALONE_SVG_FONT_MARKER}="${FONT_PACK_VERSION}">\n${faces}${svgFontFallbackCss()}\n</style>`;
  const at = root.index + root[0].length;
  return svg.slice(0, at) + style + svg.slice(at);
}
