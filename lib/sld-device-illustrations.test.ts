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
  it('Phase 1 + 1.5 ships Tesla (battery + BUI) and EcoFlow (inverter + battery + BUI)', () => {
    const all = listDeviceIllustrations();
    const ids = all.map(d => `${d.brand}::${d.kind}`).sort();
    expect(ids).toEqual([
      'ecoflow::battery',
      'ecoflow::bui',
      'ecoflow::inverter',
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
  });
  it('false for brands without illustrations', () => {
    expect(brandHasDevice('Enphase')).toBe(false); // Phase 2
    expect(brandHasDevice('SolarEdge')).toBe(false); // Phase 2
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