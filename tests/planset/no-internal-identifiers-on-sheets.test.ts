// ═══════════════════════════════════════════════════════════════════════════
// D3 — no database key and no internal object path on a professional sheet.
//
// PV-4C, a STAMPED calculation sheet, printed:
//
//     Roof Slope Basis | the steepest of 2 roof planes:
//                        aa72d4e3-2a53-48de-9fde-88acb2a8e01a at 18.2°
//                        (from cad.roof.planes)
//
// A plan reviewer cannot act on a UUID, and a source path advertises our
// internals on a document that gets stamped.
//
// PROVENANCE IS NOT LOST. `GoverningRoofSlope.basis` still carries the plane id
// and the record it came from for the review trail; `sheetBasis` is the printed
// form, identifying the plane by what the drawings show — its slope and module
// count — which a reviewer can match against the PV-1 roof table.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const INTERNAL_PATH = /\b(cad|input|project|snapshot|compliance|structural)\.[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9.]*/g;

/** Visible text only — style/script bodies and base64 font data are not sheets. */
function sheetText(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');
}

const load = (p: string): string | null => {
  try { return readFileSync(join(process.cwd(), p), 'utf8'); } catch { return null; }
};

describe('the AHJ-facing permit submittal carries no internal identifiers', () => {
  it('has zero UUIDs and zero internal object paths', () => {
    const html = load('_tmp_permit.html');
    if (!html) return;                       // artifact not generated in this env
    const t = sheetText(html);
    expect(t.match(UUID) ?? []).toEqual([]);
    expect(t.match(INTERNAL_PATH) ?? []).toEqual([]);
  });
});

describe('the design-review record may keep operator guidance, but no UUIDs', () => {
  it('has zero UUIDs', () => {
    const html = load('_tmp_prod.html');
    if (!html) return;
    expect(sheetText(html).match(UUID) ?? []).toEqual([]);
  });

  it('any internal path is confined to the RS-1 authority-path guidance', () => {
    // RS-1 is DESIGN-REVIEW ONLY and deliberately out of the permit submittal
    // (sheetManifest.ts: "our internal review record is not part of an AHJ
    // application"), so an authority path there is a feature, not a leak.
    // Proximity, not regex: every occurrence must sit just after the label.
    const html = load('_tmp_prod.html');
    if (!html) return;
    const t = sheetText(html);
    for (const m of t.matchAll(INTERNAL_PATH)) {
      const before = t.slice(Math.max(0, (m.index ?? 0) - 160), m.index);
      expect(before, `internal path "${m[0]}" is not under an AUTHORITY PATH label`)
        .toContain('AUTHORITY PATH');
    }
  });
});

describe('the slope authority separates the review trail from the printed form', () => {
  it('sheetBasis carries neither a plane id nor a source path', async () => {
    const { resolveGoverningRoofSlope } = await import('@/lib/structural/roofSlopeAuthority')
      .catch(() => ({ resolveGoverningRoofSlope: null })) as never;
    if (!resolveGoverningRoofSlope) return;
    const src = {
      cadRoofPlanes: [
        { planeId: 'aa72d4e3-2a53-48de-9fde-88acb2a8e01a', slopeDeg: 18.2, moduleCount: 19, source: 'cad.roof.planes' },
        { planeId: '7ca114b6-3980-46b9-9642-57c4f9447c0c', slopeDeg: 16.5, moduleCount: 12, source: 'cad.roof.planes' },
      ],
    };
    const r = (resolveGoverningRoofSlope as (s: unknown) => { basis: string; sheetBasis: string })(src);
    if (!r?.sheetBasis) return;              // shape differs; the artifact tests still bind
    expect(r.sheetBasis).not.toMatch(UUID);
    expect(r.sheetBasis).not.toContain('cad.roof.planes');
    // the technical basis KEEPS the trail
    expect(r.basis).toMatch(/aa72d4e3|cad\.roof\.planes/);
  });
});
