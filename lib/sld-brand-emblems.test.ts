// ═══════════════════════════════════════════════════════════════════════════
// lib/sld-brand-emblems.test.ts
// v58.15 — SLD Brand Emblem lock-in tests.
//
// CONTRACT (what these tests protect)
//   • Every ECOSYSTEM_BRANDS entry resolves to a hand-tuned (non-fallback)
//     emblem style. Adding a brand to the picker WITHOUT an emblem must
//     be caught here.
//   • Emblem SVG output is well-formed: contains a <rect> + <text> and the
//     brand wordmark, inside a <g class="brand-emblem"> wrapper with a
//     data-brand attribute.
//   • Unknown manufacturers return a neutral fallback emblem (slate) with
//     the raw manufacturer as wordmark (≤9 chars).
//   • Empty manufacturer returns '' (emitBrandEmblem is safe to chain).
//   • normalizeBrandKey is case/whitespace/punctuation insensitive so
//     equipment-db row variations ("Sol-Ark", "SolArk", "sol ark") map to
//     the same emblem.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  BRAND_EMBLEMS,
  emitBrandEmblem,
  getBrandEmblemStyle,
  hasTunedEmblem,
  normalizeBrandKey,
} from './sld-brand-emblems';
import { ECOSYSTEM_BRANDS } from './system/brandProfiles/resolveBrandEquipment';

describe('sld-brand-emblems — registry integrity', () => {
  it('has non-empty wordmark and valid hex colors for every registered brand', () => {
    const hex = /^#[0-9A-Fa-f]{6}$/;
    for (const [key, style] of Object.entries(BRAND_EMBLEMS)) {
      expect(style.wordmark.length, `wordmark for ${key}`).toBeGreaterThan(0);
      expect(style.wordmark.length, `wordmark for ${key} short enough`).toBeLessThanOrEqual(11);
      expect(style.fill, `fill for ${key}`).toMatch(hex);
      expect(style.ink, `ink for ${key}`).toMatch(hex);
      if (style.stroke) expect(style.stroke, `stroke for ${key}`).toMatch(hex);
    }
  });

  it('covers every ECOSYSTEM_BRANDS entry with a tuned emblem', () => {
    for (const brand of ECOSYSTEM_BRANDS) {
      expect(hasTunedEmblem(brand.id), `ecosystem brand ${brand.id} needs an emblem`).toBe(true);
      expect(hasTunedEmblem(brand.displayName), `ecosystem displayName ${brand.displayName} should resolve`).toBe(true);
    }
  });

  it('has no duplicate wordmark+color combos (catches copy-paste errors)', () => {
    // Ecosystem-tier brands should all be visually distinct.
    const ecosystemIds = ECOSYSTEM_BRANDS.map(b => b.id);
    const signatures = new Set<string>();
    for (const id of ecosystemIds) {
      const style = getBrandEmblemStyle(id);
      const sig = `${style.wordmark}|${style.fill}`;
      expect(signatures.has(sig), `duplicate emblem signature for ${id}: ${sig}`).toBe(false);
      signatures.add(sig);
    }
  });
});

describe('sld-brand-emblems — normalizeBrandKey', () => {
  it('lowercases and strips whitespace', () => {
    expect(normalizeBrandKey('EcoFlow')).toBe('ecoflow');
    expect(normalizeBrandKey('ECOFLOW')).toBe('ecoflow');
    expect(normalizeBrandKey(' ecoflow ')).toBe('ecoflow');
    expect(normalizeBrandKey('Enphase Energy')).toBe('enphaseenergy');
  });

  it('strips trademark symbols', () => {
    expect(normalizeBrandKey('Tesla®')).toBe('tesla');
    expect(normalizeBrandKey('Generac™')).toBe('generac');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeBrandKey('')).toBe('');
    expect(normalizeBrandKey(undefined as unknown as string)).toBe('');
  });
});

describe('sld-brand-emblems — getBrandEmblemStyle lookup', () => {
  it('resolves direct ecosystem ids', () => {
    expect(getBrandEmblemStyle('ecoflow').wordmark).toBe('EcoFlow');
    expect(getBrandEmblemStyle('tesla').wordmark).toBe('TESLA');
    expect(getBrandEmblemStyle('enphase').wordmark).toBe('Enphase');
    expect(getBrandEmblemStyle('solaredge').wordmark).toBe('SolarEdge');
    expect(getBrandEmblemStyle('generac').wordmark).toBe('GENERAC');
  });

  it('resolves display-name capitalisation', () => {
    expect(getBrandEmblemStyle('EcoFlow').wordmark).toBe('EcoFlow');
    expect(getBrandEmblemStyle('SolarEdge').wordmark).toBe('SolarEdge');
    expect(getBrandEmblemStyle('APsystems').wordmark).toBe('APsystems');
  });

  it('resolves Sol-Ark across hyphen/space/concat variants', () => {
    expect(getBrandEmblemStyle('Sol-Ark').wordmark).toBe('Sol-Ark');
    expect(getBrandEmblemStyle('sol-ark').wordmark).toBe('Sol-Ark');
    expect(getBrandEmblemStyle('SolArk').wordmark).toBe('Sol-Ark');
    expect(getBrandEmblemStyle('Sol Ark').wordmark).toBe('Sol-Ark');
  });

  it('returns neutral fallback for unknown brand', () => {
    const style = getBrandEmblemStyle('UnknownMfgCo');
    expect(style.fill).toBe('#455A64'); // slate
    expect(style.wordmark).toBe('UnknownMf'); // truncated to 9 chars via substring(0, 9)
    expect(style.italic).toBe(true);
  });

  it('truncates fallback wordmark to 9 chars', () => {
    const style = getBrandEmblemStyle('VeryLongBrandNameCorp');
    expect(style.wordmark.length).toBeLessThanOrEqual(9);
  });
});

describe('sld-brand-emblems — emitBrandEmblem SVG output', () => {
  it('returns empty string for empty manufacturer', () => {
    expect(emitBrandEmblem('', 0, 0)).toBe('');
    expect(emitBrandEmblem(undefined as unknown as string, 0, 0)).toBe('');
  });

  it('emits a well-formed <g> wrapper with data-brand attribute', () => {
    const svg = emitBrandEmblem('EcoFlow', 10, 20);
    expect(svg).toContain('<g class="brand-emblem"');
    expect(svg).toContain('data-brand="ecoflow"');
    expect(svg).toContain('</g>');
  });

  it('includes a <rect> with the brand fill color', () => {
    const svg = emitBrandEmblem('Tesla', 0, 0);
    expect(svg).toContain('<rect ');
    expect(svg).toContain('fill="#CC0000"'); // Tesla red
    expect(svg).toContain('rx="3"');
  });

  it('includes a <text> with the brand wordmark', () => {
    const svg = emitBrandEmblem('Enphase', 0, 0);
    expect(svg).toContain('<text ');
    expect(svg).toContain('>Enphase</text>');
    expect(svg).toContain('text-anchor="middle"');
  });

  it('honours custom coordinates and dimensions', () => {
    const svg = emitBrandEmblem('EcoFlow', 140, 10, 54, 14);
    expect(svg).toContain('x="140.0"');
    expect(svg).toContain('y="10.0"');
    expect(svg).toContain('width="54.0"');
    expect(svg).toContain('height="14.0"');
  });

  it('defaults to 54×14 badge when dimensions omitted', () => {
    const svg = emitBrandEmblem('Tesla', 0, 0);
    expect(svg).toContain('width="54.0"');
    expect(svg).toContain('height="14.0"');
  });

  it('escapes < > & in wordmarks and data-brand attribute (defence-in-depth)', () => {
    // Fallback path: unknown brand with unusual chars goes straight into the
    // wordmark. Every < > & must come out as entity refs inside both the
    // <text> body and the data-brand attribute.
    const svg = emitBrandEmblem('<Bad&Co>', 0, 0);
    expect(svg).not.toContain('<Bad&Co>');        // raw injection must not appear
    expect(svg).toContain('&lt;Bad&amp;Co&gt;'); // fully escaped wordmark
    expect(svg).toContain('data-brand="&lt;bad&amp;co&gt;"'); // attribute safe too
  });

  it('emits italic style for fallback brands', () => {
    const svg = emitBrandEmblem('UnknownMfgCo', 0, 0);
    expect(svg).toContain('font-style="italic"');
  });

  it('emits bold font-weight for tuned brands by default', () => {
    const svg = emitBrandEmblem('EcoFlow', 0, 0);
    expect(svg).toContain('font-weight="700"');
  });
});

describe('sld-brand-emblems — ecosystem brand color rules', () => {
  it('EcoFlow emblem uses EcoFlow blue', () => {
    const style = getBrandEmblemStyle('ecoflow');
    expect(style.fill).toBe('#0E7CFF');
    expect(style.ink).toBe('#FFFFFF');
  });

  it('Tesla emblem uses Tesla red', () => {
    const style = getBrandEmblemStyle('tesla');
    expect(style.fill).toBe('#CC0000');
  });

  it('Enphase emblem uses Enphase orange', () => {
    const style = getBrandEmblemStyle('enphase');
    expect(style.fill).toBe('#F37021');
  });

  it('SolarEdge emblem uses SolarEdge red', () => {
    const style = getBrandEmblemStyle('solaredge');
    expect(style.fill).toBe('#E30613');
  });

  it('Generac emblem uses Generac orange', () => {
    const style = getBrandEmblemStyle('generac');
    expect(style.fill).toBe('#F68B1F');
  });

  it('Growatt emblem uses Growatt green', () => {
    const style = getBrandEmblemStyle('growatt');
    expect(style.fill).toBe('#1F8A3A');
  });

  it('Tigo emblem uses Tigo green-yellow', () => {
    const style = getBrandEmblemStyle('tigo');
    expect(style.fill).toBe('#7AB800');
  });
});