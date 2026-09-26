// ============================================================================
// THE SLD IN THE PERMIT'S FACE, EVERYWHERE IT IS SHOWN — Ray, 2026-09-26, on a
// Diagram-tab screenshot: "Biggest issue I have with the sld is the word bleed
// and overlays. This should be cleaner to read!!"
//
// Part of what he was looking at was the wrong FONT. Every drawing SVG asks for
// "SolarPro Sans, SolarPro Symbols". The permit HTML and the SLD PDF embed those
// faces; the app page declared neither name, so the Diagram tab painted the
// browser's default face — a serif — over labels placed for Liberation Sans.
//
// The app now aliases the canonical names to the metric-compatible face the
// machine already has (app/globals.css, `local()` — no font bytes served; the
// pack's .woff2 are for embedding inside an artifact only, see fontPack.ts),
// and adds the fallbacks through CSS keyed on the drawing's own attribute. An
// SVG that LEAVES the app goes through withStandaloneSvgFonts(), which embeds
// the verified pack faces inside the file.
//
// Everything here reads the real files: globals.css as shipped, the manifest,
// and an SLD rendered by the live renderer — not a copy of any of them.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  FONT_SANS, FONT_MONO, FONT_SYMBOLS, SVG_FONT_SANS, SVG_FONT_MONO, SVG_FONT_SYMBOLS,
  SVG_FONT_SANS_STACK, SVG_FONT_MONO_STACK, METRIC_COMPATIBLE_FALLBACKS, REQUIRED_SYMBOLS,
  STANDALONE_SVG_FONT_MARKER, fontFaceIdentities, svgFontFallbackCss, withStandaloneSvgFonts,
} from '@/lib/permit/fonts/fontPack';
import { renderSLDProfessional, applyTypeFloor, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';

const ROOT = process.cwd();
const GLOBALS_CSS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'lib', 'permit', 'fonts', 'font-pack.manifest.json'), 'utf8')) as {
  faces: Array<{ file: string; family: string; weight: string; style: string; sha256: string; bytes: number }>;
};

// ── globals.css readers ─────────────────────────────────────────────────────
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, '');
const normStack = (s: string) => s.split(',').map(x => unquote(x)).join(', ');

interface FaceDecl { family: string; weight: number; style: string; display: string; src: string; unicodeRange: string | null }
function declaredFaces(css: string): FaceDecl[] {
  return [...stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => {
    const body = m[1];
    const prop = (name: string) => {
      const p = new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]*)`, 'i').exec(body);
      return p ? p[1].trim() : null;
    };
    return {
      family: unquote(prop('font-family') ?? ''),
      weight: Number(prop('font-weight') ?? 400),
      style: prop('font-style') ?? 'normal',
      display: prop('font-display') ?? '',
      src: prop('src') ?? '',
      unicodeRange: prop('unicode-range'),
    };
  });
}
const localNames = (src: string) => [...src.matchAll(/local\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);

/** The value of the `font-family` declaration in the rule for `selector`. */
function ruleFontFamily(css: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${esc}\\s*\\{\\s*font-family\\s*:\\s*([^;}]*)`).exec(stripComments(css));
  return m ? m[1].trim() : null;
}

const APP_FACES = declaredFaces(GLOBALS_CSS).filter(f => f.family.startsWith('SolarPro'));
const PACK_FACES = fontFaceIdentities();
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-monospace)$/i;
const squash = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');

// ── a live SLD — Ray's own case: Enphase IQ Combiner 5C, supply-side ────────
let logSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { logSpy.mockRestore(); });

const BASE = {
  projectName: 'FONTS', clientName: 'Ray', address: '1 Test St', designer: 'T', drawingDate: '2026-09-26',
  drawingNumber: 'SLD-F', revision: 'A', scale: 'NOT TO SCALE', panelModel: 'Tesla TSP-420', panelWatts: 420,
  panelVoc: 40.92, panelIsc: 13.03, dcWireGauge: '#10', dcConduitType: 'EMT', mainPanelAmps: 200,
  utilityName: 'Ameren', hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};
function sld(selected: string, interconnection: string, over: Partial<SLDProfessionalInput> = {}): SLDProfessionalInput {
  const f = sldCombinerFields({
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus', isMicro: true,
    totalDevices: 30, branchCount: 3, hasBattery: false, selectedCombinerId: selected,
    interconnectionRaw: interconnection, ungroundedConductorCount: 2, consumptionCtLocation: null,
  });
  return {
    ...BASE, topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
    integratedDcDisconnect: false, totalModules: 30, totalStrings: 0, deviceCount: 30, dcOCPD: 0,
    inverterModel: 'IQ8+', inverterManufacturer: 'Enphase', acOutputKw: 8.7, acOutputAmps: 36.3,
    acWireGauge: '#8', acConduitType: 'EMT', acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
    interconnection,
    combinerLabel: f.combinerLabel, combinerModel: f.combinerModel,
    combinerHasIntegratedGateway: f.combinerHasIntegratedGateway,
    combinerProvidesAcDisconnect: f.combinerProvidesAcDisconnect,
    combinerSelectionIsDecided: f.combinerSelectionIsDecided,
    meteringChannels: f.combinerMeteringSummary,
    meteringDrawing: f.meteringDrawing ?? undefined,
    ...(f.standaloneGateway ? { standaloneGateway: f.standaloneGateway } : {}),
    ...over,
  } as SLDProfessionalInput;
}
const SHEETS: Record<string, string> = {};
beforeAll(() => {
  SHEETS['5C supply-side'] = applyTypeFloor(renderSLDProfessional(sld('enphase-iq-combiner-5c', 'SUPPLY_SIDE_TAP')));
  SHEETS['standalone gateway, load-side'] = applyTypeFloor(renderSLDProfessional(sld('enphase-iq-gateway-standalone', 'LOAD_SIDE')));
});

/** Every (family-attribute value, weight) a sheet's text asks for. Weight is
 *  read from the element itself or, failing that, its nearest ancestor that
 *  sets one — the way the browser resolves it. */
function familyWeightsOf(svg: string): Array<{ value: string; weight: number }> {
  const out: Array<{ value: string; weight: number }> = [];
  const weights: number[] = [400];
  const families: Array<string | null> = [null];
  const re = /<(\/?)(g|text|tspan|svg)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  const toWeight = (w: string) => (w === 'bold' || w === 'bolder' ? 700 : w === 'normal' ? 400 : Number(w));
  while ((m = re.exec(svg))) {
    const [, close, , attrs, selfClose] = m;
    if (close) { weights.pop(); families.pop(); continue; }
    const w = /\bfont-weight="([^"]+)"/.exec(attrs);
    const fam = /\bfont-family="([^"]+)"/.exec(attrs);
    const weight = w ? toWeight(w[1]) : weights[weights.length - 1];
    const family = fam ? fam[1] : families[families.length - 1];
    if (family && /<(text|tspan)\b/.test(m[0])) out.push({ value: family, weight });
    if (!selfClose) { weights.push(weight); families.push(family); }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('the app page declares the faces the drawings ask for', () => {
  it('declares exactly the pack\'s face set — family, weight, style — no more, no fewer', () => {
    const want = PACK_FACES.map(f => `${f.family}/${f.weight}/${f.style}`).sort();
    const have = APP_FACES.map(f => `${f.family}/${f.weight}/${f.style}`).sort();
    expect(want.length, 'the pack itself went missing — the comparison would be vacuous').toBe(5);
    expect(have).toEqual(want);
  });

  it('every face is font-display: block — a drawing never paints a frame in a stand-in face', () => {
    for (const f of APP_FACES) expect(f.display, `${f.family} ${f.weight}`).toBe('block');
  });

  it('serves NO font bytes — every source is local(), never url()', () => {
    for (const f of APP_FACES) {
      expect(f.src, `${f.family} ${f.weight}: a url() source publishes font bytes`).not.toMatch(/url\(/i);
      expect(localNames(f.src).length, `${f.family} ${f.weight}: no local() source at all`).toBeGreaterThan(0);
    }
  });

  it('Sans and Mono alias ONLY metric-compatible faces — and every one of them', () => {
    for (const fam of [FONT_SANS, FONT_MONO] as const) {
      const metric: readonly string[] = METRIC_COMPATIBLE_FALLBACKS[fam];
      const allowed = metric.map(squash);
      for (const face of APP_FACES.filter(f => f.family === fam)) {
        const names = localNames(face.src);
        // a face that spaces text differently (DejaVu Sans, Verdana, Segoe UI)
        // is exactly the reflow the pack exists to prevent
        const stray = names.filter(n => !allowed.some(a => squash(n).startsWith(a)));
        expect(stray, `${fam} ${face.weight}: not metric-compatible`).toEqual([]);
        for (const a of metric) {
          expect(names.some(n => squash(n).startsWith(squash(a))), `${fam} ${face.weight}: ${a} is not aliased`).toBe(true);
        }
        // the weight must be the weight: a Bold alias on the 400 face would
        // embolden every label on the sheet
        for (const n of names) {
          expect(/bold/i.test(n), `${fam} ${face.weight}: local('${n}')`).toBe(face.weight === 700);
          expect(/italic|oblique/i.test(n), `${fam}: local('${n}') is an italic`).toBe(false);
        }
      }
    }
  });

  it('the symbols alias can never win a Latin glyph, and covers every symbol the planset prints', () => {
    const sym = APP_FACES.filter(f => f.family === FONT_SYMBOLS);
    expect(sym.length).toBe(1);
    const ur = sym[0].unicodeRange;
    expect(ur, 'no unicode-range: a full DejaVu/Segoe face would win Latin text if the Sans alias failed').toBeTruthy();
    const ranges = ur!.split(',').map(r => {
      const [lo, hi] = r.trim().replace(/^U\+/i, '').split('-').map(h => parseInt(h.replace(/^U\+/i, ''), 16));
      return [lo, hi ?? lo] as const;
    });
    for (const [lo] of ranges) expect(lo, `range starting U+${lo.toString(16)}`).toBeGreaterThanOrEqual(0x2000);
    for (const s of REQUIRED_SYMBOLS) {
      const cp = s.codePointAt(0)!;
      expect(ranges.some(([lo, hi]) => cp >= lo && cp <= hi), `${s} U+${cp.toString(16)} is outside the alias`).toBe(true);
    }
  });

  it('the attribute rules add the SAME stacks fontPack exports', () => {
    const sans = ruleFontFamily(GLOBALS_CSS, `[font-family*="${FONT_SANS}"]`);
    const mono = ruleFontFamily(GLOBALS_CSS, `[font-family*="${FONT_MONO}"]`);
    expect(sans, 'globals.css has no fallback rule for the Sans attribute').not.toBeNull();
    expect(mono, 'globals.css has no fallback rule for the Mono attribute').not.toBeNull();
    expect(normStack(sans!)).toBe(normStack(SVG_FONT_SANS_STACK));
    expect(normStack(mono!)).toBe(normStack(SVG_FONT_MONO_STACK));
    // …and fontPack's own serialisation of those rules says the same thing
    const fb = svgFontFallbackCss();
    expect(normStack(ruleFontFamily(fb, `[font-family*="${FONT_SANS}"]`)!)).toBe(normStack(SVG_FONT_SANS_STACK));
    expect(normStack(ruleFontFamily(fb, `[font-family*="${FONT_MONO}"]`)!)).toBe(normStack(SVG_FONT_MONO_STACK));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the stacks put a metric-compatible face before any generic', () => {
  const cases = [
    { name: 'SVG_FONT_SANS_STACK', stack: SVG_FONT_SANS_STACK, canonical: FONT_SANS },
    { name: 'SVG_FONT_MONO_STACK', stack: SVG_FONT_MONO_STACK, canonical: FONT_MONO },
  ] as const;
  for (const c of cases) {
    it(`${c.name}: canonical, then symbols, then metric-compatible, generic last`, () => {
      const parts = c.stack.split(',').map(s => s.trim());
      expect(parts[0]).toBe(c.canonical);
      expect(parts[1]).toBe(FONT_SYMBOLS);
      const firstMetric = parts.findIndex(p => (METRIC_COMPATIBLE_FALLBACKS[c.canonical] as readonly string[]).includes(p));
      const firstGeneric = parts.findIndex(p => GENERIC.test(p));
      expect(firstMetric, 'no metric-compatible fallback at all').toBeGreaterThan(1);
      expect(firstGeneric, 'no generic at all — a machine without the faces paints the default serif').toBeGreaterThan(-1);
      expect(firstMetric).toBeLessThan(firstGeneric);
      expect(firstGeneric, 'the generic must be LAST').toBe(parts.length - 1);
      // valid inside a double-quoted attribute — see MALFORMED_STYLE_FONT_FAMILY_RE
      expect(c.stack).not.toContain('"');
    });
  }

  it('the existing canonical constants did not move (other renderers and the metric gate pin them)', () => {
    expect([SVG_FONT_SANS, SVG_FONT_MONO, SVG_FONT_SYMBOLS]).toEqual(['SolarPro Sans', 'SolarPro Mono', 'SolarPro Symbols']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a rendered SLD asks for nothing the app page lacks', () => {
  it('every family × weight on the sheet is declared in globals.css', () => {
    const declared = new Set(APP_FACES.map(f => `${f.family}/${f.weight}`));
    for (const [name, svg] of Object.entries(SHEETS)) {
      const uses = familyWeightsOf(svg);
      expect(uses.length, `${name}: no text read — the scan is blind`).toBeGreaterThan(50);
      const missing = new Set<string>();
      for (const u of uses) {
        for (const fam of [FONT_SANS, FONT_MONO]) {
          if (!u.value.includes(fam)) continue;
          // the browser matches 600 → 700 and 500 → 400; the pack has 400/700
          const w = u.weight >= 600 ? 700 : 400;
          if (!declared.has(`${fam}/${w}`)) missing.add(`${fam}/${u.weight}`);
        }
      }
      expect([...missing], `${name}: asked for but not declared`).toEqual([]);
    }
  });

  it('every text family is canonical-first and carries NO host fallback in the attribute', () => {
    // The fallbacks belong at the boundary (globals.css / withStandaloneSvgFonts):
    // this same markup is E-1, where tests/planset/d4-canonical-font-pack.test.ts
    // forbids a host family in any SVG text attribute.
    const HOST = /\b(Arial|Helvetica|Courier|Times|Verdana|Tahoma|Segoe|DejaVu|Liberation|Arimo|Cousine)\b|(^|,)\s*(monospace|sans-serif|serif|cursive)\s*$/i;
    for (const [name, svg] of Object.entries(SHEETS)) {
      const values = [...new Set(familyWeightsOf(svg).map(u => u.value))];
      for (const v of values) {
        expect(unquote(v.split(',')[0]), `${name}: "${v}"`).toMatch(/^SolarPro (Sans|Mono|Symbols)$/);
        expect(HOST.test(v), `${name}: host family in a node attribute — "${v}". Apply SVG_FONT_*_STACK at the boundary instead.`).toBe(false);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('an SLD that LEAVES the app carries the pack inside itself', () => {
  const svg = () => SHEETS['5C supply-side'];
  const dataFaces = (s: string) => [...s.matchAll(/@font-face\{font-family:"([^"]+)";src:url\("data:font\/woff2;base64,([^"]+)"\)[^}]*font-weight:(\d+)/g)]
    .map(m => ({ family: m[1], weight: m[3], bytes: Buffer.from(m[2], 'base64') }));

  it('embeds exactly the faces of the families the sheet names — verified bytes', () => {
    const out = withStandaloneSvgFonts(svg());
    const faces = dataFaces(out);
    const named = MANIFEST.faces.filter(f => svg().includes(f.family));
    expect(named.map(f => f.family)).toContain(FONT_SANS);
    expect(faces.map(f => `${f.family}/${f.weight}`).sort()).toEqual(named.map(f => `${f.family}/${f.weight}`).sort());
    for (const f of faces) {
      const m = MANIFEST.faces.find(x => x.family === f.family && x.weight === f.weight)!;
      expect(createHash('sha256').update(f.bytes).digest('hex'), `${m.file}`).toBe(m.sha256);
    }
  });

  it('a sheet that names no mono text does not carry the mono faces', () => {
    // The live SLD names Mono (lib/sld-symbols.ts symbol labels), so the filter
    // is proven on a minimal sheet — otherwise this would pass by never running.
    const bare = `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="${FONT_SANS}, ${FONT_SYMBOLS}">A</text></svg>`;
    const faces = dataFaces(withStandaloneSvgFonts(bare));
    expect(faces.map(f => `${f.family}/${f.weight}`).sort()).toEqual([`${FONT_SANS}/400`, `${FONT_SANS}/700`, `${FONT_SYMBOLS}/400`]);
  });

  it('the style is the root\'s first child, carries the fallback rules, and changes nothing else', () => {
    const src = svg();
    const out = withStandaloneSvgFonts(src);
    const root = /<svg\b[^>]*>/.exec(src)!;
    const after = out.slice(root.index + root[0].length);
    expect(after.startsWith(`<style ${STANDALONE_SVG_FONT_MARKER}=`)).toBe(true);
    expect(out).toContain(svgFontFallbackCss());
    const styleEnd = after.indexOf('</style>') + '</style>'.length;
    expect(out.slice(0, root.index + root[0].length) + after.slice(styleEnd)).toBe(src);
    // XML-safe: an embedded stylesheet with a raw < or & breaks the file in every viewer
    expect(after.slice(0, styleEnd).replace(/^<style[^>]*>|<\/style>$/g, '')).not.toMatch(/[<&]/);
  });

  it('is idempotent — a second pass does not add a second ≈290 KB copy', () => {
    const once = withStandaloneSvgFonts(svg());
    expect(withStandaloneSvgFonts(once)).toBe(once);
  });

  it('embedFaces:false carries only the fallback rules — a few hundred bytes for a stored copy', () => {
    const out = withStandaloneSvgFonts(svg(), { embedFaces: false });
    expect(out).not.toContain('data:font/woff2');
    expect(out).toContain(svgFontFallbackCss());
    expect(out.length - svg().length).toBeLessThan(1024);
  });

  it('the renderer itself emits no @font-face — E-1 gets its faces from the permit stylesheet, once', () => {
    for (const [name, s] of Object.entries(SHEETS)) {
      expect(s, name).not.toContain('@font-face');
      expect(s, name).not.toContain(STANDALONE_SVG_FONT_MARKER);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the pack\'s bytes are not published as standalone files', () => {
  // lib/permit/fonts/README.md: "embedded inside the generated artifact only".
  // The subsets still carry the Reserved Font Name "Liberation" in their name
  // table and no licence text, so a /public copy is a licensing question, not a
  // file copy. If that changes, it changes with a renamed pack v2 — and this
  // test with it.
  it('no font file under public/ is byte-identical to a pack face', () => {
    const packHashes = new Map(MANIFEST.faces.map(f => [f.sha256, f.file]));
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) { walk(p); continue; }
        if (!/\.(woff2?|ttf|otf)$/i.test(name)) continue;
        const sha = createHash('sha256').update(readFileSync(p)).digest('hex');
        if (packHashes.has(sha)) hits.push(`${p} = ${packHashes.get(sha)}`);
      }
    };
    walk(join(ROOT, 'public'));
    expect(hits).toEqual([]);
  });
});
