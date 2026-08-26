// Phase-1 SLD PDF export contract.
//
// WHY THIS FILE EXISTS: before this repair the "Export PDF" button had never
// produced a PDF, in any environment, and the entire test suite was green while
// that was true. Three defects composed into one silent symptom:
//
//   1. the export wrapper embedded ZERO @font-face while every <text> in the SLD
//      asks for "SolarPro Sans, SolarPro Symbols";
//   2. the authoritative font gate therefore tripped on every call, via its
//      metric branch (548.17px measured against a 563.15–580.31 window);
//   3. the gate threw a PLAIN Error, but its own catch only re-threw
//      CanonicalFontError — a class that was declared, instanceof-checked, and
//      NEVER CONSTRUCTED anywhere in the repo. The fail-closed refusal was
//      swallowed into `return null`, which means "try wkhtmltopdf" — a binary
//      that is neither installed nor a dependency. The route then served the raw
//      SVG at HTTP 200 with a .svg filename, and the client saved it.
//
// Every existing test that touches this path mocks `generatePdfFromHtml` to
// resolve null, so a GREEN SUITE WAS NOT EVIDENCE THE GATE WORKED. These gates
// are deliberately source-level (the same technique as sld-canonical-only.test.ts)
// because that is the level at which the defects lived.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderSLDProfessional, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { fontFaceCss } from '@/lib/permit/fonts/fontPack';

const PDF_LIB   = 'lib/pdf/generatePdf.ts';
const SLD_ROUTE = 'app/api/engineering/sld/pdf/route.ts';
const PROPOSAL  = 'app/api/proposals/[id]/pdf/route.ts';
const PERMIT    = 'app/api/engineering/permit/route.ts';
const RENDERER  = 'lib/sld-professional-renderer.ts';
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('the canonical font gate is ARMED (it can actually fire)', () => {
  it('CanonicalFontError is CONSTRUCTED, not merely declared', () => {
    const s = read(PDF_LIB);
    // The exact defect: `class CanonicalFontError` existed with zero `new`
    // sites, so `err instanceof CanonicalFontError` was unreachable.
    expect(s).toMatch(/new CanonicalFontError\s*\(/);
  });

  it('the font-gate refusal throws CanonicalFontError, never a plain Error', () => {
    const s = read(PDF_LIB);
    const refusal = s.slice(s.indexOf('AUTHORITATIVE PDF REFUSED') - 400, s.indexOf('AUTHORITATIVE PDF REFUSED'));
    expect(refusal).toMatch(/throw new CanonicalFontError\s*\($/m);
    expect(refusal).not.toMatch(/throw new Error\s*\($/m);
  });

  it('the catch duck-types as well as instanceof (bundlers duplicate the class)', () => {
    const s = read(PDF_LIB);
    expect(s).toMatch(/isCanonicalFontError\s*\]?\s*\)?\s*\?\.\s*isCanonicalFontError\s*===\s*true|isCanonicalFontError\s*===\s*true/);
  });
});

describe('the SLD export wrapper can PASS the gate', () => {
  it('embeds the canonical font pack', () => {
    const s = read(SLD_ROUTE);
    expect(s).toMatch(/fontFaceCss\s*\(\s*\)/);
    expect(s).toMatch(/from '@\/lib\/permit\/fonts\/fontPack'/);
  });

  it('the pack it embeds really contains all five faces', () => {
    // Guards the wrapper against silently embedding an empty/partial stylesheet.
    expect((fontFaceCss().match(/@font-face/g) ?? []).length).toBe(5);
  });

  it('forces the faces to LOAD, not merely declare them', () => {
    // document.fonts.check() reports FALSE for a declared-but-unused face and
    // does not trigger a load, so a purely-declared pack still fails the gate.
    // The preloader must stay laid out: display:none suppresses the load.
    const s = read(SLD_ROUTE);
    expect(s).toMatch(/font-preload/);
    expect(s).not.toMatch(/\.font-preload\s*\{[^}]*display:\s*none/);
  });
});

describe('a failed PDF is reported as a FAILURE', () => {
  it('the route never serves an SVG dressed as the PDF export', () => {
    const s = read(SLD_ROUTE);
    expect(s).not.toMatch(/svg-fallback/);
    expect(s).toMatch(/PDF_ENGINE_UNAVAILABLE/);
    expect(s).toMatch(/status:\s*502/);
  });

  it('the route refuses the non-authoritative wkhtmltopdf preview', () => {
    expect(read(SLD_ROUTE)).toMatch(/authoritativeOnly:\s*true/);
  });

  it('a font failure is surfaced as itself, not relabelled a DB error', () => {
    const s = read(SLD_ROUTE);
    expect(s).toMatch(/CANONICAL_FONT_FAILURE/);
    // and it must be caught BEFORE handleRouteDbError, or the message is buried
    expect(s.indexOf('CANONICAL_FONT_FAILURE')).toBeLessThan(s.indexOf('handleRouteDbError(\'[SLD PDF err]\''));
  });

  it('escHtml actually escapes (it used to map every character to itself)', () => {
    // Plain substring assertions on purpose: a regex literal spelling out the
    // source's own `/</g` terminates the literal early and fails to parse.
    // Scoped to the FUNCTION BODY — the surrounding comment quotes the old
    // identity form as an example, and a whole-file search matches the prose.
    const s = read(SLD_ROUTE);
    const body = s.slice(s.indexOf('function escHtml'), s.indexOf('function wrapSVGinHTML'));
    expect(body).toContain(".replace(/&/g, '&amp;')");
    expect(body).toContain(".replace(/</g, '&lt;')");
    expect(body).toContain(".replace(/>/g, '&gt;')");
    // the identity forms that shipped, e.g. .replace(/&/g, '&')
    expect(body).not.toContain(".replace(/&/g, '&')");
    expect(body).not.toContain(".replace(/</g, '<')");
  });
});

describe('arming the gate does not break the routes that never embedded the pack', () => {
  it('the proposal PDF opts out of the canonical-font requirement', () => {
    // It renders a marketing document with its own faces and has always been
    // allowed to degrade. Without this it would start throwing on every call.
    expect(read(PROPOSAL)).toMatch(/requireCanonicalFonts:\s*false/);
  });

  it('the permit route degrades to HTML instead of 500-ing on a gate failure', () => {
    const s = read(PERMIT);
    // Both call sites must be inside a scoped try, or a font problem becomes a
    // total outage of permit generation.
    const guarded = s.match(/try\s*\{\s*\n\s*pdfResult = await generatePdfFromHtml\(/g) ?? [];
    expect(guarded.length).toBe(2);
  });
});

describe('the Chromium download URL is the one that actually exists', () => {
  it('names the architecture — the unsuffixed asset 404s from v147 on', () => {
    // THE reason no PDF was ever produced in production. chromium-min ships no
    // binary; it fetches one from this URL. The release assets are
    // `chromium-v147.0.0-pack.x64.tar` / `-pack.arm64.tar`. The old unsuffixed
    // `-pack.tar` name 404s, executablePath() rejects, and this function's catch
    // turns that into `return null` = "no PDF" for EVERY caller, silently.
    const s = read(PDF_LIB);
    expect(s).toMatch(/pack\.\$\{packArch\}\.tar/);
    expect(s).not.toMatch(/chromium-v[\d.]+-pack\.tar/);
    expect(s).toMatch(/process\.arch === 'arm64'/);
  });

  it('the SLD route allows enough time for the cold-start download', () => {
    // ~65 MB tarball + extract + launch before anything is drawn. 30s cannot fit
    // it, so even a correct URL would time out on the first request.
    expect(read(SLD_ROUTE)).toMatch(/export const maxDuration = 60/);
  });
});

describe('wkhtmltopdf geometry — no double transposition', () => {
  it('--orientation is only passed when there are NO explicit dimensions', () => {
    const s = read(PDF_LIB);
    // Explicit width/height already encode orientation; passing both makes Qt
    // transpose a second time and print 24x18 on an 18x24 portrait page.
    const from = s.indexOf('const args = [');
    // The ARRAY LITERAL only — up to its closing `];`. --orientation must not be
    // seeded here, because the explicit-dimensions branch never removes it.
    const literal = s.slice(from, s.indexOf('];', from));
    expect(literal).not.toContain('--orientation');
    // ...and it must appear in the else (no-explicit-dimensions) branch.
    const geometry = s.slice(s.indexOf('if (opts.widthIn && opts.heightIn)', from), s.indexOf('args.push(htmlPath'));
    expect(geometry).toMatch(/else\s*\{[\s\S]*'--orientation'/);
    // The old splice-out hack must be gone entirely.
    expect(s).not.toContain("args.indexOf('--page-size')");
  });
});

describe('NEC 690.7 provenance — the sheet never states what it was not given', () => {
  const base = {
    projectName: 'T', clientName: 'T', address: 'T', designer: 'T',
    drawingDate: '2026-01-01', drawingNumber: 'SLD-001', revision: 'A',
    topologyType: 'STRING_INVERTER', totalModules: 30, totalStrings: 3,
    panelModel: 'M', panelWatts: 400, panelVoc: 41.6, panelIsc: 12.26,
    dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20,
    inverterModel: 'I', inverterManufacturer: 'Mfr',
    acOutputKw: 10, acOutputAmps: 42, acWireGauge: '#6 AWG', acConduitType: 'EMT',
    acOCPD: 60, acWireLength: 60, backfeedAmps: 60, mainPanelAmps: 200,
    utilityName: 'U', interconnection: 'Load Side Tap',
    rapidShutdownIntegrated: true, hasProductionMeter: true, hasBattery: false,
    batteryModel: '', batteryKwh: 0, scale: 'NOT TO SCALE',
  } as unknown as SLDProfessionalInput;

  it('prints NOT COMPUTED rather than the STC voltage under "Voc Corrected"', () => {
    // The retired fallback was `input.vocCorrected ?? input.panelVoc`. A
    // corrected Voc is always HIGHER than STC, so the stand-in understated the
    // real figure in the UNSAFE direction and could hide a string that exceeds
    // the inverter's max DC voltage.
    const svg = renderSLDProfessional({ ...base });
    expect(svg).toContain('NOT COMPUTED');
    expect(svg).not.toMatch(/>41\.60 V</);   // panelVoc must not appear as "corrected"
  });

  it('does not fabricate a -10C design temperature', () => {
    const svg = renderSLDProfessional({ ...base });
    expect(svg).not.toMatch(/>-10°C</);
  });

  it('a supplied corrected Voc IS printed, and the string total derives from it', () => {
    const svg = renderSLDProfessional({ ...base, vocCorrected: 48.2, panelsPerString: 10 } as SLDProfessionalInput);
    expect(svg).toMatch(/>48\.20 V</);       // per-module corrected
    expect(svg).toMatch(/>482\.0 V</);       // x 10 modules = the string total
  });

  it('an uncorrected array summary is LABELLED as STC, never as a bare Voc', () => {
    const svg = renderSLDProfessional({ ...base });
    expect(svg).toMatch(/Voc\(STC\)=/);
  });
});

describe('the embedded multi-lane root states its aspect contract', () => {
  it('renderSLDMultiLane emits preserveAspectRatio explicitly', () => {
    const s = read(RENDERER);
    // Both SVG roots must state it. The hybrid root previously omitted it and
    // passed the page-fit harness only through its `par === ''` escape hatch.
    expect((s.match(/preserveAspectRatio="xMidYMid meet"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
