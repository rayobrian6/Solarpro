// W4 §5 acceptance — the dead inline buildSLD implementation is DELETED and the
// ONLY reachable SLD renderer is the canonical live path (generateLiveSLD →
// renderSLDProfessional / renderSLDMultiLane) built from the validated snapshot.
//
// These gates prove, at the source + module-surface level:
//   • no `buildSLD` implementation survives in electricalPages (deletion);
//   • no legacy SLD builder is exported (no bypass module surface);
//   • the E-1 SLD sheet consumes the canonical renderer and FAILS CLOSED — no
//     stored-SVG tier and no fabricated inline-SLD tier in the live path;
//   • every rendered SLD carries the snapshot id + schema version + digest as
//     machine-extractable data attributes sourced from the snapshot meta.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ELEC = 'lib/permit/sections/electricalPages.ts';
const RENDERER = 'lib/sld-professional-renderer.ts';
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('W4 §5 — canonical-only SLD (dead buildSLD deleted, snapshot-bound)', () => {
  it('the dead inline buildSLD implementation is deleted from electricalPages', () => {
    const s = read(ELEC);
    // No implementation and no call site survive (comments may still name the
    // historical builder; the gates below target code, not prose).
    expect(s).not.toMatch(/function\s+buildSLD\b/);          // no implementation
    expect(s).not.toMatch(/=\s*buildSLD\s*\(\s*\)/);         // no assignment call
    expect(s).not.toMatch(/^\s*buildSLD\s*\(\s*\)\s*;?\s*$/m); // no statement call
    expect(s).not.toMatch(/const svgContent = buildSLD\(\)/);
  });

  it('no legacy/alternate SLD builder is exported from electricalPages (no bypass surface)', async () => {
    const mod = await import('@/lib/permit/sections/electricalPages');
    const surface = Object.keys(mod);
    // The single SLD-sheet emitter is pageSingleLineDiagram; nothing else.
    expect(surface).toContain('pageSingleLineDiagram');
    expect(surface.some(k => /buildSLD|legacySLD|storedSLD|inlineSLD/i.test(k))).toBe(false);
  });

  it('the canonical renderSLDMultiLane path stays internal — only renderSLDProfessional is exported', () => {
    const r = read(RENDERER);
    expect(r).toMatch(/export function renderSLDProfessional\(/);
    // multi-lane renderer is reachable ONLY through the canonical entrypoint.
    expect(r).toMatch(/function renderSLDMultiLane\(/);
    expect(r).not.toMatch(/export function renderSLDMultiLane\(/);
  });

  it('E-1 consumes the canonical live renderer and fails closed (no stored/inline tier)', () => {
    const s = read(ELEC);
    expect(s).toContain('generateLiveSLD(input, cad, { embedded: true })');
    expect(s).toContain('fail closed (no stored/inline fallback renders');
    // No stored-SVG render assignment, no inline builder in the live path.
    expect(s).not.toMatch(/sldBodyHtml\s*=[^;]*storedSldSvg/);
    expect(s).not.toMatch(/function\s+buildSLD\b/);
  });

  it('every rendered SLD carries snapshot id + schema version + digest (machine-extractable)', () => {
    const s = read(ELEC);
    // The stamp attributes exist and are sourced from the snapshot meta (not fabricated).
    expect(s).toContain('data-sld-snapshot-id');
    expect(s).toContain('data-sld-schema-version');
    expect(s).toContain('data-sld-digest');
    expect(s).toMatch(/_snapshot\??\.\s*meta|_snapshot\b[^\n]*meta/);
    // The stamp is inside the E-1 sheet return (rendered on every E-1).
    const sheet = s.slice(s.indexOf('export function pageSingleLineDiagram'));
    expect(sheet).toMatch(/\$\{_sldStamp\}/);
    expect(sheet).toMatch(/class="page sld-page"/);
  });

  it('the SLD snapshot stamp degrades honestly (empty values) when unstamped — never a fabricated id', () => {
    const s = read(ELEC);
    // Falls back to '' (empty) — an unstamped SLD is visible to the harness,
    // not masked behind a plausible-looking fake snapshot id/digest.
    expect(s).toMatch(/data-sld-snapshot-id="\$\{_sldMeta\?\.snapshotId \?\? ''\}"/);
    // digest emitted as the same 20-char prefix the title block uses (empty when unstamped).
    expect(s).toMatch(/data-sld-digest="\$\{\(_sldMeta\?\.digest \?\? ''\)\.slice\(0, 20\)\}"/);
  });
});
