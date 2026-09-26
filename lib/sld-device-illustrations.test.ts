// ═══════════════════════════════════════════════════════════════════════════
// lib/sld-device-illustrations.test.ts
// v58.16 Phase 1 — Device illustration lock-in tests.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  brandHasDevice,
  listDeviceIllustrations,
  normalizeDeviceBrandKey,
  resolveDeviceIllustration,
  type DeviceKind,
} from './sld-device-illustrations';

describe('sld-device-illustrations — registry', () => {
  it('Phase 1-3 ships 8 brands (Tesla, EcoFlow, Enphase, SolarEdge, Generac, Sol-Ark, Growatt, Solis, APsystems, Hoymiles)', () => {
    const all = listDeviceIllustrations();
    const ids = all.map(d => `${d.brand}::${d.kind}`).sort();
    // 2026-09-26: + enphase::gateway (the IQ Gateway / Envoy, drawn as the
    // standalone gateway node and inside the IQ Combiner) and
    // enphase::combiner (the IQ Combiner enclosure, admin reference art).
    expect(ids).toEqual([
      'apsystems::inverter',
      'ecoflow::battery',
      'ecoflow::bui',
      'ecoflow::inverter',
      'enphase::battery',
      'enphase::bui',
      'enphase::combiner',
      'enphase::gateway',
      'enphase::inverter',
      'generac::battery',
      'generac::bui',
      'generac::inverter',
      'growatt::battery',
      'growatt::bui',
      'growatt::inverter',
      'hoymiles::inverter',
      'solaredge::battery',
      'solaredge::bui',
      'solaredge::inverter',
      'solark::bui',
      'solark::inverter',
      'solis::inverter',
      'tesla::battery',
      'tesla::bui',
    ]);
  });

  it('every illustration declares non-empty label, sub, aspect ratio, and render fn', () => {
    for (const d of listDeviceIllustrations()) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.sub.length).toBeGreaterThan(0);
      expect(d.aspectW).toBeGreaterThan(0);
      expect(d.aspectH).toBeGreaterThan(0);
      expect(typeof d.render).toBe('function');
    }
  });
});

describe('sld-device-illustrations — normalizeDeviceBrandKey', () => {
  it('lowercases and strips whitespace', () => {
    expect(normalizeDeviceBrandKey('EcoFlow')).toBe('ecoflow');
    expect(normalizeDeviceBrandKey(' ECOFLOW ')).toBe('ecoflow');
    expect(normalizeDeviceBrandKey('Eco Flow')).toBe('ecoflow');
  });
  it('strips trademark symbols', () => {
    expect(normalizeDeviceBrandKey('Tesla®')).toBe('tesla');
    expect(normalizeDeviceBrandKey('Powerwall™')).toBe('powerwall');
  });
  it('collapses hyphens, underscores, and dots (Sol-Ark family)', () => {
    expect(normalizeDeviceBrandKey('Sol-Ark')).toBe('solark');
    expect(normalizeDeviceBrandKey('Sol Ark')).toBe('solark');
    expect(normalizeDeviceBrandKey('SolArk')).toBe('solark');
    expect(normalizeDeviceBrandKey('sol_ark')).toBe('solark');
    expect(normalizeDeviceBrandKey('APsystems')).toBe('apsystems');
    expect(normalizeDeviceBrandKey('AP.systems')).toBe('apsystems');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeDeviceBrandKey('')).toBe('');
  });
});

describe('sld-device-illustrations — resolveDeviceIllustration', () => {
  it('resolves Tesla battery by direct brand key', () => {
    const d = resolveDeviceIllustration('Tesla', 'battery');
    expect(d).not.toBeNull();
    expect(d!.label).toContain('Powerwall');
  });
  it('resolves EcoFlow inverter + battery + BUI', () => {
    expect(resolveDeviceIllustration('EcoFlow', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('EcoFlow', 'battery')).not.toBeNull();
    expect(resolveDeviceIllustration('EcoFlow', 'bui')).not.toBeNull();
  });
  it('resolves Enphase inverter + battery + BUI (Phase 2)', () => {
    expect(resolveDeviceIllustration('Enphase', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('Enphase', 'battery')).not.toBeNull();
    expect(resolveDeviceIllustration('Enphase', 'bui')).not.toBeNull();
  });
  it('resolves SolarEdge inverter + battery + BUI (Phase 2)', () => {
    expect(resolveDeviceIllustration('SolarEdge', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('SolarEdge', 'battery')).not.toBeNull();
    expect(resolveDeviceIllustration('SolarEdge', 'bui')).not.toBeNull();
  });
  it('resolves Generac inverter + battery + BUI (Phase 2)', () => {
    expect(resolveDeviceIllustration('Generac', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('Generac', 'battery')).not.toBeNull();
    expect(resolveDeviceIllustration('Generac', 'bui')).not.toBeNull();
  });
  it('Phase 2 brand labels reference actual product lines', () => {
    expect(resolveDeviceIllustration('Enphase', 'inverter')!.label).toMatch(/IQ8/i);
    expect(resolveDeviceIllustration('Enphase', 'battery')!.label).toMatch(/IQ Battery/i);
    expect(resolveDeviceIllustration('SolarEdge', 'inverter')!.label).toMatch(/Home Hub/i);
    expect(resolveDeviceIllustration('SolarEdge', 'battery')!.label).toMatch(/Energy Bank/i);
    expect(resolveDeviceIllustration('Generac', 'inverter')!.label).toMatch(/PWRcell/i);
    expect(resolveDeviceIllustration('Generac', 'battery')!.label).toMatch(/PWRcell/i);
    expect(resolveDeviceIllustration('Generac', 'bui')!.label).toMatch(/PWRmanager/i);
  });
  it('resolves Sol-Ark inverter + BUI (Phase 3)', () => {
    expect(resolveDeviceIllustration('Sol-Ark', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('Sol-Ark', 'bui')).not.toBeNull();
    expect(resolveDeviceIllustration('SolArk', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('sol ark', 'bui')).not.toBeNull();
  });
  it('resolves Growatt inverter + battery + BUI (Phase 3)', () => {
    expect(resolveDeviceIllustration('Growatt', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('Growatt', 'battery')).not.toBeNull();
    expect(resolveDeviceIllustration('Growatt', 'bui')).not.toBeNull();
  });
  it('resolves Solis inverter only (Phase 3)', () => {
    expect(resolveDeviceIllustration('Solis', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('Solis', 'battery')).toBeNull();
    expect(resolveDeviceIllustration('Solis', 'bui')).toBeNull();
  });
  it('resolves APsystems and Hoymiles microinverters (Phase 3)', () => {
    expect(resolveDeviceIllustration('APsystems', 'inverter')).not.toBeNull();
    expect(resolveDeviceIllustration('Hoymiles', 'inverter')).not.toBeNull();
    // No first-party batteries or BUIs for these two in Phase 3
    expect(resolveDeviceIllustration('APsystems', 'battery')).toBeNull();
    expect(resolveDeviceIllustration('Hoymiles', 'bui')).toBeNull();
  });
  it('Phase 3 brand labels reference actual product lines', () => {
    expect(resolveDeviceIllustration('Sol-Ark', 'inverter')!.label).toMatch(/15K/i);
    expect(resolveDeviceIllustration('Sol-Ark', 'bui')!.label).toMatch(/Load Center/i);
    expect(resolveDeviceIllustration('Growatt', 'inverter')!.label).toMatch(/SPH/i);
    expect(resolveDeviceIllustration('Growatt', 'battery')!.label).toMatch(/ARK/i);
    expect(resolveDeviceIllustration('Growatt', 'bui')!.label).toMatch(/ATS/i);
    expect(resolveDeviceIllustration('Solis', 'inverter')!.label).toMatch(/S6/i);
    expect(resolveDeviceIllustration('APsystems', 'inverter')!.label).toMatch(/DS3/i);
    expect(resolveDeviceIllustration('Hoymiles', 'inverter')!.label).toMatch(/HMS/i);
  });
  it('resolves Tesla BUI (Backup Gateway 2)', () => {
    const d = resolveDeviceIllustration('Tesla', 'bui');
    expect(d).not.toBeNull();
    expect(d!.label).toContain('Gateway');
  });
  it('returns null for brand without a registered illustration', () => {
    expect(resolveDeviceIllustration('Fronius', 'inverter')).toBeNull();
    expect(resolveDeviceIllustration('SMA', 'battery')).toBeNull();
  });
  it('returns null for wrong kind on a known brand', () => {
    // Tesla has no inverter illustration in Phase 1 (Powerwall 3 is the unit).
    expect(resolveDeviceIllustration('Tesla', 'inverter')).toBeNull();
  });
  it('returns null for empty manufacturer', () => {
    expect(resolveDeviceIllustration('', 'inverter')).toBeNull();
    expect(resolveDeviceIllustration('', 'battery')).toBeNull();
  });
  it('is case/whitespace insensitive', () => {
    expect(resolveDeviceIllustration('TESLA', 'battery')).not.toBeNull();
    expect(resolveDeviceIllustration(' tesla ', 'battery')).not.toBeNull();
    expect(resolveDeviceIllustration('eco flow', 'battery')).not.toBeNull();
  });
});

describe('sld-device-illustrations — brandHasDevice', () => {
  it('true when any kind is registered for the brand', () => {
    expect(brandHasDevice('Tesla')).toBe(true);
    expect(brandHasDevice('EcoFlow')).toBe(true);
    // Phase 2 brands
    expect(brandHasDevice('Enphase')).toBe(true);
    expect(brandHasDevice('SolarEdge')).toBe(true);
    expect(brandHasDevice('Generac')).toBe(true);
    // Phase 3 brands
    expect(brandHasDevice('Sol-Ark')).toBe(true);
    expect(brandHasDevice('Growatt')).toBe(true);
    expect(brandHasDevice('Solis')).toBe(true);
    expect(brandHasDevice('APsystems')).toBe(true);
    expect(brandHasDevice('Hoymiles')).toBe(true);
  });
  it('false for brands without illustrations', () => {
    expect(brandHasDevice('Fronius')).toBe(false);
    expect(brandHasDevice('SMA')).toBe(false);
    expect(brandHasDevice('Tigo')).toBe(false);  // MLPE vendor, deferred
    expect(brandHasDevice('Unknown OEM')).toBe(false);
  });
  it('false for empty manufacturer', () => {
    expect(brandHasDevice('')).toBe(false);
  });
});

describe('sld-device-illustrations — render output', () => {
  const kinds: DeviceKind[] = ['inverter', 'battery'];
  const samples: Array<{ brand: string; kind: DeviceKind }> = [
    { brand: 'Tesla',   kind: 'battery' },
    { brand: 'EcoFlow', kind: 'inverter' },
    { brand: 'EcoFlow', kind: 'battery' },
  ];

  it.each(samples)('$brand $kind emits a wrapped <g data-device=…> element', ({ brand, kind }) => {
    const d = resolveDeviceIllustration(brand, kind);
    expect(d).not.toBeNull();
    const svg = d!.render(50, 50, 80, 100);
    expect(svg).toMatch(/^<g data-device="/);
    expect(svg).toMatch(/<\/g>$/);
  });

  it.each(samples)('$brand $kind contains at least one <rect> (cabinet body)', ({ brand, kind }) => {
    const d = resolveDeviceIllustration(brand, kind)!;
    const svg = d.render(0, 0, 100, 100);
    // Either plain <rect ...> OR a rounded-top <path> for the Powerwall.
    expect(svg.includes('<rect ') || svg.includes('<path ')).toBe(true);
  });

  it.each(samples)('$brand $kind output is deterministic for identical args', ({ brand, kind }) => {
    const d = resolveDeviceIllustration(brand, kind)!;
    const a = d.render(50, 50, 80, 100);
    const b = d.render(50, 50, 80, 100);
    expect(a).toBe(b);
  });

  it('Tesla Powerwall illustration carries the TESLA nameplate', () => {
    const d = resolveDeviceIllustration('Tesla', 'battery')!;
    expect(d.render(0, 0, 100, 180)).toContain('>TESLA<');
  });

  it('EcoFlow illustrations carry the EcoFlow wordmark', () => {
    const inv = resolveDeviceIllustration('EcoFlow', 'inverter')!;
    const bat = resolveDeviceIllustration('EcoFlow', 'battery')!;
    expect(inv.render(0, 0, 100, 140)).toContain('>EcoFlow<');
    expect(bat.render(0, 0, 100, 140)).toContain('>EcoFlow<');
  });

  it('EcoFlow inverter carries the EF-PCS-24 model number', () => {
    const inv = resolveDeviceIllustration('EcoFlow', 'inverter')!;
    expect(inv.render(0, 0, 100, 140)).toContain('EF-PCS-24');
  });

  it('EcoFlow battery carries the EF-BP-10 module label', () => {
    const bat = resolveDeviceIllustration('EcoFlow', 'battery')!;
    expect(bat.render(0, 0, 100, 140)).toContain('EF-BP-10');
  });

  describe('Enphase IQ Gateway (the Envoy)', () => {
    const gw = () => resolveDeviceIllustration('Enphase', 'gateway')!;

    it('resolves, keeps the data-sheet 8.4 × 5.0 in aspect, and names the device', () => {
      expect(gw()).not.toBeNull();
      expect(gw().aspectW / gw().aspectH).toBeCloseTo(8.4 / 5.0, 2);
      expect(gw().label).toMatch(/IQ Gateway/);
      const svg = gw().render(100, 60, 168, 100);
      expect(svg).toMatch(/^<g data-device="enphase-iq-gateway">/);
      expect(svg).toContain('>ENPHASE<');
      expect(svg).toContain('>IQ GATEWAY<');
    });

    it('draws the front the data sheet shows: near-black body, four green LEDs, two buttons, two USB-A ports, the door', () => {
      const svg = gw().render(100, 60, 168, 100);
      expect(svg).toContain('fill="#1B1D20"');                          // body
      expect(svg.match(/fill="#39D26B"/g)?.length).toBe(4);             // cloud · AP · production · PLC
      expect(svg.match(/fill="#2B2F33"/g)?.length).toBe(2);             // AP + device-scan buttons
      expect(svg.match(/fill="#0C0D0F" stroke="#5A5F66"/g)?.length).toBe(2); // USB-A ×2
      expect(svg).toContain('fill="#15171A"');                          // hinged terminal door
    });

    it('🚨 reproduces NO logo: the brand is plain text — no image, no embedded glyph art', () => {
      const svg = gw().render(100, 60, 168, 100);
      expect(svg).not.toMatch(/<image|<use|href=|xlink/);
      // The only orange is the product-name TEXT (the "e" mark is orange).
      const orange = [...svg.matchAll(/<(\w+)[^>]*#F37021/g)].map(m => m[1]);
      expect(orange).toEqual(['text']);
    });

    it('authors every glyph at or above the printed type floor, and drops a line that would not fit at it', () => {
      const sizes = (s: string) => [...s.matchAll(/font-size="([\d.]+)"/g)].map(m => Number(m[1]));
      const big = gw().render(100, 60, 168, 100);
      const mini = gw().render(40, 25, 64, 38);    // the miniature inside an IQ Combiner
      for (const v of [...sizes(big), ...sizes(mini)]) expect(v).toBeGreaterThanOrEqual(8.67);
      expect(mini).toContain('>ENPHASE<');
      // In the printed face (Liberation Sans Bold) 'IQ GATEWAY' at 8.67 uu is
      // 55.9 uu; the miniature's face is 49.5.
      expect(mini).not.toContain('>IQ GATEWAY<');
    });

    it('judges "fits" in the PRINTED face\'s widths, not a flat per-glyph guess', () => {
      // 50×30: the face is 38.8 uu; 'ENPHASE' at 8.67 uu is 41.9 in Liberation
      // Sans Bold. The old 0.62 em guess (37.6) printed it past the face.
      expect(gw().render(0, 0, 50, 30)).not.toContain('>ENPHASE<');
      // 80×48: the face is 62.0 uu; 'IQ GATEWAY' is 55.9 — it fits, and is
      // kept (a flat 0.72 em, 62.4, would have dropped it).
      expect(gw().render(0, 0, 80, 48)).toContain('>IQ GATEWAY<');
    });

    it('stays inside its slot and is deterministic', () => {
      const cx = 200, cy = 100, slotW = 150, slotH = 88;
      const svg = gw().render(cx, cy, slotW, slotH);
      expect(svg).toBe(gw().render(cx, cy, slotW, slotH));
      const xs = [...svg.matchAll(/\b(?:x|x1|x2|cx)="([\d.-]+)"/g)].map(m => parseFloat(m[1]));
      const ys = [...svg.matchAll(/\b(?:y|y1|y2|cy)="([\d.-]+)"/g)].map(m => parseFloat(m[1]));
      for (const v of xs) { expect(v).toBeGreaterThanOrEqual(cx - slotW / 2 - 1); expect(v).toBeLessThanOrEqual(cx + slotW / 2 + 1); }
      for (const v of ys) { expect(v).toBeGreaterThanOrEqual(cy - slotH / 2 - 1); expect(v).toBeLessThanOrEqual(cy + slotH / 2 + 1); }
    });

    it('the IQ Combiner art is registered too, and brandHasDevice counts both new kinds', () => {
      const cb = resolveDeviceIllustration('Enphase', 'combiner')!;
      expect(cb.render(0, 0, 74, 98)).toMatch(/^<g data-device="enphase-iq-combiner">/);
      expect(resolveDeviceIllustration('Tesla', 'gateway')).toBeNull();
      expect(brandHasDevice('Enphase')).toBe(true);
    });
  });

  it('fits inside the requested slot (no coordinate leaks beyond ±slotW)', () => {
    // Spot-check one device at known coords: illustration must be centred on
    // (cx, cy) with all geometry within [cx - slotW/2, cx + slotW/2].
    const d = resolveDeviceIllustration('Tesla', 'battery')!;
    const cx = 100, cy = 100, slotW = 80, slotH = 140;
    const svg = d.render(cx, cy, slotW, slotH);
    // Pull all numeric x coordinates from the output.
    const xs = [...svg.matchAll(/\b(?:x|x1|x2|cx)="([\d.-]+)"/g)].map(m => parseFloat(m[1]));
    for (const xv of xs) {
      expect(xv).toBeGreaterThanOrEqual(cx - slotW / 2 - 1);
      expect(xv).toBeLessThanOrEqual(cx + slotW / 2 + 1);
    }
  });
});