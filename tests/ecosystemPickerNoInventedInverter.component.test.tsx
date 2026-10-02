/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PICKER MAY SUGGEST. IT MAY NOT DECIDE.
//
// Ray's live project: he changed the ecosystem to Tesla to clear a stale Enphase display, and
// SolarPro drew a STRING INVERTER sheet with a "Tesla Solar Inverter 5.7kW" he never selected.
//
// The chain, traced and executed end to end:
//
//   EcosystemPicker auto-selects `kit.stringInverters[0]` with NO click  →  tesla-solar-inverter-3p8k
//     → app/engineering/page.tsx types it 'string' and writes config.inverters[0]
//     → lib/system/sizingEngine.ts "upsizes" it to 2 x 5.7 kW = 11.40 kW
//     → autosaved into engineering_config
//     → lib/electrical/projectModel.ts derives `ac-coupled-inverter` FROM AN INVERTER NOBODY CHOSE
//     → the renderer draws a string-inverter chain across a four-Powerwall job
//
// The picker file already states the rule, for the Envoy: "a default recorded by an apply would read
// as the installer's decision on every sheet". The inverter broke the rule its own neighbour
// documents.
//
// Ray: "Suggestions are allowed. Persisted equipment requires explicit user selection… A suggestion
// must never masquerade as an installer decision."
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import EcosystemPicker, { type EcosystemApplyPayload } from '@/components/engineering/EcosystemPicker';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function openTesla(pvCoupledToStorage: boolean) {
  const applied: EcosystemApplyPayload[] = [];
  const view = render(
    <EcosystemPicker onApply={p => applied.push(p)} pvCoupledToStorage={pvCoupledToStorage} />,
  );
  fireEvent.click(view.getByText('Tesla'));
  return { view, applied };
}

/** Click whatever this brand's apply control is. */
function apply(view: ReturnType<typeof render>) {
  const btn = Array.from(view.container.querySelectorAll('button'))
    .find(b => /apply/i.test(b.textContent ?? ''));
  expect(btn, 'no Apply control rendered').toBeTruthy();
  fireEvent.click(btn as HTMLButtonElement);
}

describe('🚨 a DC-coupled project gets no inverter by default', () => {
  it('applying the Tesla ecosystem carries NO inverterId', () => {
    const { view, applied } = openTesla(true);
    apply(view);
    expect(applied.length, 'the apply did not fire').toBe(1);
    expect(applied[0].selections.inverterId,
      'the picker selected an inverter nobody chose').toBeUndefined();
  });

  it('🚨 and specifically not the 3.8 kW row that started the live failure', () => {
    const { view, applied } = openTesla(true);
    apply(view);
    expect(JSON.stringify(applied[0].selections)).not.toContain('tesla-solar-inverter');
  });

  it('the inverters are still LISTED — this removes the default, not the choice', () => {
    // A legitimately AC-coupled Tesla install is real (Ray: "Do not assume Tesla storage always
    // eliminates Enphase"), so the equipment must remain selectable.
    const { view } = openTesla(true);
    expect(view.container.textContent ?? '').toMatch(/inverter/i);
  });
});

describe('every other project is unchanged', () => {
  it('🚨 without DC-coupled storage the picker defaults an inverter exactly as before', () => {
    // The guard must be narrow. If this went empty too, the fix would have silently removed a
    // working default from every brand and every conventional PV job.
    const { view, applied } = openTesla(false);
    apply(view);
    expect(applied[0].selections.inverterId,
      'the fix removed the default from conventional projects too').toBeTruthy();
  });

  it('the prop is optional, so a host that does not pass it behaves as before', () => {
    const applied: EcosystemApplyPayload[] = [];
    const view = render(<EcosystemPicker onApply={p => applied.push(p)} />);
    fireEvent.click(view.getByText('Tesla'));
    apply(view);
    expect(applied[0].selections.inverterId).toBeTruthy();
  });
});
