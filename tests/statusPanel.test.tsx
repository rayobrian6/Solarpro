/**
 * @vitest-environment jsdom
 *
 * tests/statusPanel.test.ts
 *
 * Unit tests for the bottom-right Design-phase status panel
 * (Aurora frame 0147 parity, components/3d/status/).
 *
 * Coverage:
 *   1. Default constants (Solarpro 400W module, $0/W default).
 *   2. Pure math: system size (modules × wattage / 1000, 1dp).
 *   3. Pure math: impact price (modules × wattage × $/W, whole $).
 *   4. Formatters: thousands separators, kW suffix, "$ —" placeholder.
 *   5. useDesignTotals hook: returns pre-formatted labels.
 *   6. StatusPanel component: renders the three rows verbatim with
 *      Aurora-matching labels and the correct values for a sample
 *      input.
 *
 * These tests cover only the status-panel slice. The design-panel
 * agent's Create Design modal will add their own wiring tests when
 * they thread costPerWatt through to <StatusPanel>.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import {
  DEFAULT_MODULE_WATTAGE,
  COST_NOT_SET,
  computeSystemSizeKw,
  computeImpactPrice,
  formatModuleCount,
  formatSystemSizeLabel,
  formatImpactPriceLabel,
  useDesignTotals,
  StatusPanel,
  type DesignTotals,
} from '@/components/3d/status';

// ─── Constants ──────────────────────────────────────────────────────────────

describe('status panel — defaults', () => {
  it('DEFAULT_MODULE_WATTAGE is 400 (Solarpro canonical module size)', () => {
    // 400W matches the equipment-db baseline (SunPower Maxeon 6 / 3
    // 400W) and DesignStudio.tsx's `panelCount400w` / `/ 400` math.
    expect(DEFAULT_MODULE_WATTAGE).toBe(400);
  });

  it('COST_NOT_SET is null (Aurora "$ —" placeholder sentinel)', () => {
    // The impact-price math uses `null` as the "no Design yet"
    // signal. The costPerWatt parameter defaults to this value
    // when the parent doesn't supply one, so the panel renders
    // "$ —" until a Design is created.
    expect(COST_NOT_SET).toBeNull();
  });
});

// ─── System size (kW STC) ───────────────────────────────────────────────────

describe('computeSystemSizeKw', () => {
  it('zero modules → 0 kW', () => {
    expect(computeSystemSizeKw(0)).toBe(0);
  });

  it('one 400W module → 0.4 kW', () => {
    expect(computeSystemSizeKw(1)).toBe(0.4);
  });

  it('ten 400W modules → 4 kW', () => {
    expect(computeSystemSizeKw(10)).toBe(4);
  });

  it('twenty-five 400W modules → 10 kW', () => {
    expect(computeSystemSizeKw(25)).toBe(10);
  });

  it('one hundred 400W modules → 40 kW', () => {
    expect(computeSystemSizeKw(100)).toBe(40);
  });

  it('honors a custom wattage (440W module, 10 panels → 4.4 kW)', () => {
    // 10 × 440 / 1000 = 4.4 kW exact.
    expect(computeSystemSizeKw(10, 440)).toBe(4.4);
  });

  it('degenerate wattage (0W) → 0 kW (does not NaN)', () => {
    expect(computeSystemSizeKw(100, 0)).toBe(0);
  });

  it('degenerate wattage (negative) → 0 kW (defensive)', () => {
    expect(computeSystemSizeKw(10, -100)).toBe(0);
  });

  it('non-finite inputs → 0 kW (defensive)', () => {
    expect(computeSystemSizeKw(NaN, 400)).toBe(0);
    expect(computeSystemSizeKw(10, Infinity)).toBe(0);
    expect(computeSystemSizeKw(10, NaN)).toBe(0);
  });

  it('fractional module counts round to 1 decimal place', () => {
    // 1.5 × 400 = 600W = 0.6 kW exact.
    expect(computeSystemSizeKw(1.5)).toBe(0.6);
  });
});

// ─── Impact price (whole $) ─────────────────────────────────────────────────

describe('computeImpactPrice', () => {
  it('zero modules → null (Aurora "$ —" placeholder)', () => {
    // Aurora shows "$ —" until the user places a module. The math
    // returns null to signal "render the dash".
    expect(computeImpactPrice(0)).toBeNull();
  });

  it('ten 400W modules × $4/W → $16,000', () => {
    // 10 × 400 × 4 = 16,000.
    expect(computeImpactPrice(10, 400, 4)).toBe(16000);
  });

  it('twenty-five 400W modules × $3.50/W → $35,000', () => {
    // 25 × 400 × 3.5 = 35,000.
    expect(computeImpactPrice(25, 400, 3.5)).toBe(35000);
  });

  it('one module × 400W × $4/W → $1,600 (sanity)', () => {
    expect(computeImpactPrice(1, 400, 4)).toBe(1600);
  });

  it('zero costPerWatt with modules → 0 (explicit zero, not null)', () => {
    // Once a Design exists, $0/W with N modules is a real $0 result,
    // not the "no design yet" placeholder. The formatImpactPriceLabel
    // helper distinguishes null from 0.
    expect(computeImpactPrice(10, 400, 0)).toBe(0);
  });

  it('zero modules + zero cost → null (placeholder wins over zero)', () => {
    expect(computeImpactPrice(0, 400, 0)).toBeNull();
  });

  it('non-finite modules → null', () => {
    expect(computeImpactPrice(NaN, 400, 4)).toBeNull();
  });

  it('non-finite wattage → null', () => {
    expect(computeImpactPrice(10, Infinity, 4)).toBeNull();
  });

  it('negative costPerWatt → null (defensive; cost is never negative)', () => {
    expect(computeImpactPrice(10, 400, -1)).toBeNull();
  });
});

// ─── Formatters ─────────────────────────────────────────────────────────────

describe('formatModuleCount', () => {
  it('renders zero as "0"', () => {
    expect(formatModuleCount(0)).toBe('0');
  });

  it('renders small counts as plain digits', () => {
    expect(formatModuleCount(1)).toBe('1');
    expect(formatModuleCount(42)).toBe('42');
  });

  it('inserts thousands separators at 1,000 and above', () => {
    expect(formatModuleCount(1000)).toBe('1,000');
    expect(formatModuleCount(1234)).toBe('1,234');
    expect(formatModuleCount(1234567)).toBe('1,234,567');
  });

  it('floors fractional inputs (panels are integer-counted)', () => {
    expect(formatModuleCount(1.9)).toBe('1');
  });

  it('non-finite or negative → "0" (defensive)', () => {
    expect(formatModuleCount(NaN)).toBe('0');
    expect(formatModuleCount(-5)).toBe('0');
  });
});

describe('formatSystemSizeLabel', () => {
  it('zero kW → "0 kW"', () => {
    expect(formatSystemSizeLabel(0)).toBe('0 kW');
  });

  it('fractional kW renders with 1 decimal place', () => {
    expect(formatSystemSizeLabel(0.4)).toBe('0.4 kW');
    expect(formatSystemSizeLabel(10.5)).toBe('10.5 kW');
  });

  it('large kW with thousands separators', () => {
    expect(formatSystemSizeLabel(412.8)).toBe('412.8 kW');
    expect(formatSystemSizeLabel(1234.5)).toBe('1,234.5 kW');
  });

  it('non-finite or negative → "0 kW" (defensive)', () => {
    expect(formatSystemSizeLabel(NaN)).toBe('0 kW');
    expect(formatSystemSizeLabel(-1)).toBe('0 kW');
  });
});

describe('formatImpactPriceLabel', () => {
  it('null → "$ —" (Aurora placeholder for empty designs)', () => {
    expect(formatImpactPriceLabel(null)).toBe('$ —');
  });

  it('explicit zero → "$ 0" (real zero, not the placeholder)', () => {
    // Once a Design exists with 0 modules, show the literal $ 0.
    expect(formatImpactPriceLabel(0)).toBe('$ 0');
  });

  it('whole-dollar prices with thousands separators', () => {
    expect(formatImpactPriceLabel(16000)).toBe('$ 16,000');
    expect(formatImpactPriceLabel(1234567)).toBe('$ 1,234,567');
  });

  it('non-finite or negative → "$ —" (defensive)', () => {
    expect(formatImpactPriceLabel(NaN)).toBe('$ —');
    expect(formatImpactPriceLabel(-1)).toBe('$ —');
  });
});

// ─── Hook ───────────────────────────────────────────────────────────────────

describe('useDesignTotals hook', () => {
  it('returns zero state for an empty input', () => {
    const v = useDesignTotals({});
    expect(v.modulesLabel).toBe('0');
    expect(v.systemSizeLabel).toBe('0 kW');
    expect(v.impactPriceLabel).toBe('$ —');
    expect(v.systemSizeKw).toBe(0);
    expect(v.impactPriceUsd).toBeNull();
  });

  it('returns zero state for default empty object', () => {
    const v = useDesignTotals();
    expect(v.modulesLabel).toBe('0');
    expect(v.systemSizeLabel).toBe('0 kW');
    expect(v.impactPriceLabel).toBe('$ —');
  });

  it('computes 10 modules × 400W × $4/W → 1,234-style breakdown', () => {
    const v = useDesignTotals({ modules: 10, costPerWatt: 4 });
    expect(v.modulesLabel).toBe('10');
    expect(v.systemSizeLabel).toBe('4 kW');
    expect(v.impactPriceLabel).toBe('$ 16,000');
    expect(v.systemSizeKw).toBe(4);
    expect(v.impactPriceUsd).toBe(16000);
  });

  it('handles thousands of modules with separators', () => {
    const v = useDesignTotals({ modules: 1234, moduleWattage: 400, costPerWatt: 3.5 });
    expect(v.modulesLabel).toBe('1,234');
    // 1234 × 400 = 493,600W = 493.6 kW
    expect(v.systemSizeLabel).toBe('493.6 kW');
    // 1234 × 400 × 3.5 = 1,727,600
    expect(v.impactPriceLabel).toBe('$ 1,727,600');
  });

  it('zero modules always renders "$ —" regardless of costPerWatt', () => {
    // Even with a $5/W design in place, zero panels = no price yet.
    const v = useDesignTotals({ modules: 0, costPerWatt: 5 });
    expect(v.impactPriceLabel).toBe('$ —');
    expect(v.impactPriceUsd).toBeNull();
  });

  it('custom wattage flows through to system size', () => {
    // 10 × 440 = 4,400W = 4.4 kW
    const v = useDesignTotals({ modules: 10, moduleWattage: 440 });
    expect(v.systemSizeLabel).toBe('4.4 kW');
  });
});

// ─── Component smoke test (Aurora frame 0147 parity) ────────────────────────

describe('<StatusPanel> — Aurora frame 0147 parity', () => {
  it('renders the three Aurora labels verbatim', () => {
    render(<StatusPanel modules={0} />);
    // Aurora label text is preserved character-for-character.
    expect(screen.getByText('Modules:')).toBeTruthy();
    expect(screen.getByText('System Size (STC):')).toBeTruthy();
    expect(screen.getByText('Impact Price:')).toBeTruthy();
  });

  it('renders the empty-state values for 0 modules', () => {
    render(<StatusPanel modules={0} />);
    expect(screen.getByTestId('status-modules').textContent).toBe('0');
    expect(screen.getByTestId('status-system-size').textContent).toBe('0 kW');
    expect(screen.getByTestId('status-impact-price').textContent).toBe('$ —');
  });

  it('renders live values for 25 modules × 400W (no $/W yet)', () => {
    render(<StatusPanel modules={25} />);
    expect(screen.getByTestId('status-modules').textContent).toBe('25');
    expect(screen.getByTestId('status-system-size').textContent).toBe('10 kW');
    // No costPerWatt → still "$ —" placeholder.
    expect(screen.getByTestId('status-impact-price').textContent).toBe('$ —');
  });

  it('renders live values including impact price when costPerWatt is provided', () => {
    render(<StatusPanel modules={10} costPerWatt={4} />);
    expect(screen.getByTestId('status-modules').textContent).toBe('10');
    expect(screen.getByTestId('status-system-size').textContent).toBe('4 kW');
    expect(screen.getByTestId('status-impact-price').textContent).toBe('$ 16,000');
  });

  it('renders thousands separators for large module counts', () => {
    render(<StatusPanel modules={1234} moduleWattage={400} costPerWatt={3.5} />);
    expect(screen.getByTestId('status-modules').textContent).toBe('1,234');
    expect(screen.getByTestId('status-system-size').textContent).toBe('493.6 kW');
    expect(screen.getByTestId('status-impact-price').textContent).toBe('$ 1,727,600');
  });

  it('renders nothing when visible={false}', () => {
    // Aurora hides the panel in Site Model mode; the visible flag
    // lets the parent (SolarEngine3D) gate on isDesignPhase.
    const { container } = render(<StatusPanel modules={42} visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('exposes a stable testid root for E2E selectors', () => {
    // The data-testid is the contract for the design-panel agent's
    // E2E selectors and any future screenshot-diff harness.
    const { container } = render(<StatusPanel modules={0} />);
    const root = container.querySelector('[data-testid="status-panel"]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('role')).toBe('status');
    expect(root?.getAttribute('aria-live')).toBe('polite');
  });
});

// ─── Type-shape sanity (compile-time guarantees, runtime smoke) ────────────

describe('DesignTotals input shape', () => {
  it('accepts the minimal { modules } input', () => {
    const input: DesignTotals = { modules: 5 };
    const v = useDesignTotals(input);
    expect(v.modulesLabel).toBe('5');
  });

  it('accepts the full { modules, moduleWattage, costPerWatt } input', () => {
    const input: DesignTotals = { modules: 5, moduleWattage: 440, costPerWatt: 4.5 };
    const v = useDesignTotals(input);
    expect(v.modulesLabel).toBe('5');
    // 5 × 440 = 2,200W = 2.2 kW
    expect(v.systemSizeLabel).toBe('2.2 kW');
    // 5 × 440 × 4.5 = 9,900
    expect(v.impactPriceLabel).toBe('$ 9,900');
  });
});
