/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE GUIDED FLOW CAN BUILD A SERVICE THAT IS NOT A HOUSE, AT ITS OWN VOLTAGE.
//
// The wizard offered three systems and computed the voltage with an inline
// `wye-480 → 480, wye-208 → 208, else 240`, so every system it did not name was built at 240 V.
// It now offers every `ServicePhase`, labelled from the one descriptor, takes the voltage from that
// descriptor, and asks for a voltage only for 'Other / custom', the one system that has none of its
// own. Companion to tests/threePhaseIsNotCoercedToResidential.test.ts, which covers the model.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ServiceTopologyWizard } from '@/components/engineering/ServiceTopologyWizard';
import {
  SERVICE_PHASES, servicePhaseInfo, type ServicePhase, type ServiceTopology,
} from '@/lib/electrical/serviceTopology';

afterEach(cleanup);

const next = () => fireEvent.click(screen.getByTestId('wizard-next'));

/** 800 A, the chosen system, one main panel, then straight through to "Create this service". */
function buildThroughWizard(phase: ServicePhase, customVoltage?: string): ServiceTopology {
  const onBuilt = vi.fn();
  render(<ServiceTopologyWizard onBuilt={onBuilt} />);
  fireEvent.click(screen.getByTestId('wizard-service-800'));
  fireEvent.change(screen.getByTestId('wizard-phase'), { target: { value: phase } });
  if (customVoltage !== undefined) {
    fireEvent.change(screen.getByTestId('wizard-custom-voltage'), { target: { value: customVoltage } });
  }
  next();
  fireEvent.click(within(screen.getByTestId('wizard-dist-one-main-panel')).getByRole('radio'));
  next(); next(); next(); next();
  fireEvent.click(screen.getByTestId('wizard-finish'));
  expect(onBuilt).toHaveBeenCalledTimes(1);
  return onBuilt.mock.calls[0][0] as ServiceTopology;
}

describe('🚨 the wizard builds every electrical system at its own voltage', () => {
  it('offers every system, in the descriptor\'s words', () => {
    render(<ServiceTopologyWizard onBuilt={() => {}} />);
    const options = within(screen.getByTestId('wizard-phase')).getAllByRole('option') as HTMLOptionElement[];
    expect(options.map(o => o.value)).toEqual([...SERVICE_PHASES]);
    expect(options.map(o => o.textContent)).toEqual(SERVICE_PHASES.map(p => servicePhaseInfo(p).label));
  });

  it.each([
    ['wye-480', 480], ['wye-208', 208], ['delta-240', 240], ['high-leg-delta-240', 240],
  ] as const)('%s → %i V', (phase, volts) => {
    const t = buildThroughWizard(phase);
    expect(t.service).toMatchObject({ phase, voltage: volts, ratedAmps: 800 });
  });

  it('🚨 "Other / custom" asks for the voltage, and will not proceed on a guessed one', () => {
    render(<ServiceTopologyWizard onBuilt={() => {}} />);
    fireEvent.change(screen.getByTestId('wizard-phase'), { target: { value: 'custom' } });
    const box = screen.getByTestId('wizard-custom-voltage') as HTMLInputElement;
    expect(box.value).toBe('');
    expect((screen.getByTestId('wizard-next') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: '600' } });
    expect((screen.getByTestId('wizard-next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('"Other / custom" is built at the voltage the operator typed', () => {
    expect(buildThroughWizard('custom', '600').service).toMatchObject({ phase: 'custom', voltage: 600 });
  });

  it('says plainly that a non-split-phase system is recorded, not calculated', () => {
    render(<ServiceTopologyWizard onBuilt={() => {}} />);
    expect(screen.queryByTestId('wizard-phase-not-supported')).toBeNull();
    expect(screen.queryByTestId('wizard-custom-voltage')).toBeNull();
    fireEvent.change(screen.getByTestId('wizard-phase'), { target: { value: 'wye-480' } });
    expect(screen.getByTestId('wizard-phase-not-supported').textContent).toMatch(/NOT EVALUATED/);
  });
});
