/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// THE ENVOY ROW OF THE ECOSYSTEM PICKER — WHAT AN APPLY ACTUALLY CARRIES.
//
// Ray, 2026-09-25: "whatever Envoy I want". The picker used to auto-select the
// bare IQ Gateway and emit it as `gatewayId`, which nothing downstream reads;
// the page's banner then counted it as configured. The row now offers WHICH IQ
// Combiner (IQ Gateway built in) and emits a storable `combinerId` — and only
// when the installer picked one, because an apply that recorded a default would
// stamp it `project-selected` on every sheet.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import EcosystemPicker, { type EcosystemApplyPayload } from '@/components/engineering/EcosystemPicker';
import { listCombiners } from '@/lib/equipment/integratedBos';

const FIVE_C = 'enphase-iq-combiner-5c';
const SIX_C = 'enphase-iq-combiner-6c';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function openEnphase(currentCombinerId: string | null = null) {
  const applied: EcosystemApplyPayload[] = [];
  const view = render(
    <EcosystemPicker onApply={p => applied.push(p)} currentCombinerId={currentCombinerId} />,
  );
  fireEvent.click(view.getByText('Enphase'));
  return { view, applied };
}

const envoySelect = (container: HTMLElement) => {
  const s = Array.from(container.querySelectorAll('select'))
    .find(el => Array.from(el.options).some(o => o.value === FIVE_C));
  expect(s, 'no Envoy / IQ Combiner select rendered').toBeTruthy();
  return s as HTMLSelectElement;
};

describe('EcosystemPicker — the Envoy pick', () => {
  it('🚨 an apply with no Envoy picked carries NO combiner — never a default', () => {
    const { view, applied } = openEnphase();
    fireEvent.click(view.getByText(/Apply Enphase System/));
    expect(applied).toHaveLength(1);
    expect(applied[0].selections.combinerId).toBeUndefined();
    // The retired field is gone, so nothing can count it as configured.
    expect('gatewayId' in applied[0].selections).toBe(false);
  });

  it('the picked IQ Combiner is what the apply carries', () => {
    const { view, applied } = openEnphase();
    fireEvent.change(envoySelect(view.container), { target: { value: FIVE_C } });
    fireEvent.click(view.getByText(/Apply Enphase System/));
    expect(applied[0].selections.combinerId).toBe(FIVE_C);
  });

  it('offers exactly the storable Enphase combiners — not the bare IQ Gateway', () => {
    const { view } = openEnphase();
    const offered = Array.from(envoySelect(view.container).options).map(o => o.value).filter(Boolean);
    expect(offered.sort()).toEqual(listCombiners('enphase').map(d => d.id).sort());
    expect(offered).not.toContain('enphase-iq-gateway');
  });

  it("the empty option NAMES the project's current answer, so keeping it is visible", () => {
    const { view } = openEnphase(SIX_C);
    const first = envoySelect(view.container).options[0];
    expect(first.value).toBe('');
    expect(first.textContent).toMatch(/keep Enphase IQ Combiner 6C/);
  });

  it("a brand change drops the pick — one brand's combiner never rides into another's apply", () => {
    const { view, applied } = openEnphase();
    fireEvent.change(envoySelect(view.container), { target: { value: FIVE_C } });
    fireEvent.click(view.getByText('Enphase'));   // collapse
    fireEvent.click(view.getByText('Enphase'));   // reopen
    fireEvent.click(view.getByText(/Apply Enphase System/));
    expect(applied[0].selections.combinerId).toBeUndefined();
  });

  it('🚨 a host that does not record the pick is offered NO Envoy select, and gets no combinerId', () => {
    // No `currentCombinerId` ⇔ the host has not declared that it records the
    // pick (the engineering page before its onApply writes the combiner
    // selection). Offering the select there would hand it a pick to drop — and
    // its banner would count the dropped pick as "configured".
    const applied: EcosystemApplyPayload[] = [];
    const view = render(<EcosystemPicker onApply={p => applied.push(p)} />);
    fireEvent.click(view.getByText('Enphase'));
    const offersCombiner = () =>
      Array.from(view.container.querySelectorAll('option')).some(o => o.value === FIVE_C);
    expect(offersCombiner()).toBe(false);
    expect(view.queryByText(/Your pick becomes/)).toBeNull();
    fireEvent.click(view.getByText(/Apply Enphase System/));
    expect(applied[0].selections.combinerId).toBeUndefined();
    // …and the Kit Builder is gated by the same declaration.
    fireEvent.click(view.getByText('Customize individually'));
    expect(offersCombiner()).toBe(false);
  });

  it('the expert Kit Builder carries the same pick', () => {
    const { view, applied } = openEnphase();
    fireEvent.click(view.getByText('Customize individually'));
    fireEvent.change(envoySelect(view.container), { target: { value: SIX_C } });
    fireEvent.click(view.getByText(/Apply Enphase Ecosystem/));
    expect(applied[0].selections.combinerId).toBe(SIX_C);
  });
});
