/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 "RAY NEEDS TO BE ABLE TO BUILD AND INSPECT THIS TOPOLOGY WITHOUT EDITING JSON."
//
// And, in the same breath: "Do not reduce this back into one 'Main Panel Amps' field."
//
// So this holds the panel to the shape of the model. Two MSPs render as two MSPs. Each backup
// domain carries its own engineering conclusion. The four disconnect roles are four rows. And an
// indeterminate result prints the SPECIFIC input that would settle it — a badge that says only
// "not evaluated" is the same dead end as a green one.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { ServiceTopologyPanel } from '@/components/engineering/ServiceTopologyPanel';
import { buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';

afterEach(cleanup);

const rayJob = (over = {}) => buildTesla400ATwoGateway({
  availableFaultCurrentA: 10_000, gatewaySccrA: 10_000,
  calculatedServiceDemandA: 310, branchDemandA: [160, 150],
  storageConnection: 'gateway-panelboard',
  ...over,
}).topology;

describe('🚨 the service panel shows the service, not a main-panel number', () => {
  it('there is no "Main Panel Amps" field anywhere on it', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    expect(screen.queryByLabelText(/main panel amps/i)).toBeNull();
    // What there IS: an aggregate service, and branches under it.
    expect((screen.getByTestId('service-rated-amps') as HTMLInputElement).value).toBe('400');
    expect(screen.getByTestId('branch-branch-a')).toBeTruthy();
    expect(screen.getByTestId('branch-branch-b')).toBeTruthy();
  });

  it('🚨 two MSPs render as two MSPs, each with its own bus and main', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    const p1 = screen.getByTestId('panel-msp-1');
    const p2 = screen.getByTestId('panel-msp-2');
    expect(within(p1).getByText('MSP #1')).toBeTruthy();
    expect(within(p2).getByText('MSP #2')).toBeTruthy();
    expect((within(p1).getByLabelText(/MSP #1 busbar rating/i) as HTMLInputElement).value).toBe('200');
    expect((within(p2).getByLabelText(/MSP #2 main breaker/i) as HTMLInputElement).value).toBe('200');
  });

  it('🚨 each backup domain is its own block with its own engineering conclusion', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    for (const id of ['domain-a', 'domain-b']) {
      const d = screen.getByTestId(`domain-${id}`);
      expect(within(d).getAllByText(/Backup Gateway 3/).length).toBeGreaterThan(0);
      // Its own status badge — domain A's answer is not domain B's.
      expect(within(d).getAllByText(/PASS|FAIL|NOT EVALUATED/).length).toBeGreaterThan(0);
    }
    // And the two domains name different panels.
    expect(within(screen.getByTestId('domain-domain-a')).getByText(/msp-1/)).toBeTruthy();
    expect(within(screen.getByTestId('domain-domain-b')).getByText(/msp-2/)).toBeTruthy();
  });

  it('🚨 an Expansion is shown as DC with no AC output and no breaker', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    const d = screen.getByTestId('domain-domain-a');
    expect(within(d).getByText(/DC expansion/)).toBeTruthy();
    expect(within(d).getByText(/no AC output, no breaker/)).toBeTruthy();
    // And the site total keeps power and energy apart.
    expect(screen.getAllByText(/54\.0 kWh/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/96 A AC/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2 inverting, 2 expansion/)).toBeTruthy();
  });

  it('the four disconnect roles are four separate rows', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    expect(within(screen.getByTestId('role-service-disconnect'))
      .getByText(/400 A service disconnect/)).toBeTruthy();
    expect(within(screen.getByTestId('role-der-isolation-disconnect'))
      .getByText(/Utility DER isolation disconnect/)).toBeTruthy();
    // The two roles nothing holds say so rather than being hidden.
    expect(within(screen.getByTestId('role-gateway-isolation')).getByText('none')).toBeTruthy();
    expect(within(screen.getByTestId('role-ess-disconnect')).getByText('none')).toBeTruthy();
  });

  it('the bonding point is stated, derived from the service arrangement', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    expect(screen.getAllByText(/single service disconnect/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/bonding screw removed/i).length).toBeGreaterThan(0);
  });

  it('🚨 the equipment list is the one the BOM and pricing consume', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    expect(screen.getByTestId('qty-tesla-backup-gateway-3').textContent).toContain('2 ×');
    expect(screen.getByTestId('qty-tesla-powerwall-3').textContent).toContain('2 ×');
    expect(screen.getByTestId('qty-tesla-powerwall-3-expansion').textContent).toContain('2 ×');
  });
});

describe('🚨 NOT EVALUATED names what would settle it', () => {
  it('a job with no fault current says exactly that, and what it needs', () => {
    render(<ServiceTopologyPanel topology={rayJob({ availableFaultCurrentA: null })} />);
    const box = screen.getByTestId('topology-required-inputs');
    expect(within(box).getByText(/NOT EVALUATED — INPUT REQUIRED/)).toBeTruthy();
    expect(within(box).getByText('service.availableFaultCurrentA')).toBeTruthy();
    // And the input that would fix it is on screen, marked required rather than defaulted to 0.
    const fc = screen.getByTestId('service-fault-current') as HTMLInputElement;
    expect(fc.value).toBe('');
    expect(fc.placeholder).toBe('REQUIRED');
  });

  it('a check that could not run prints its REQUIRES beside it', () => {
    render(<ServiceTopologyPanel topology={rayJob({ branchDemandA: [null, null] })} />);
    const b = screen.getByTestId('branch-branch-a');
    expect(within(b).getAllByText(/NOT EVAL/).length).toBeGreaterThan(0);
    expect(within(b).getByText(/REQUIRES: calculatedDemandA/)).toBeTruthy();
  });

  it('the multi-gateway manufacturer document is named on screen', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    expect(screen.getAllByText(/MANUFACTURER DOCUMENT REQUIRED/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Multiple Backup Gateways on a Single Site/).length)
      .toBeGreaterThan(0);
  });

  it('a fully resolved job shows no input-required block', () => {
    // Ὢ8 "FULLY RESOLVED" INCLUDES WHERE THE STORAGE LANDS. With the breakers in the gateway's
    // own panelboard the busbar check is legitimately NOT_EVALUATED — the governing limit is the
    // manufacturer's and SolarPro does not hold it — so this case puts them on a panel busbar
    // that can take them. The first version of this test forgot, and the panel was right.
    const t = rayJob({ storageConnection: 'backed-up-panel-busbar' });
    t.interconnection.multiGatewayMeteringDoc = {
      title: 'Multiple Backup Gateways on a Single Site — Application Note',
      source: 'archived', present: true, governs: ['metering'],
    };
    for (const d of t.domains) d.backedUpDemandA = 100;
    for (const dev of t.devices) dev.sccrA = 22_000;
    for (const p of t.panels) { p.sccrA = 22_000; p.busbarRatingA = 225; p.mainBreakerA = 150; }
    render(<ServiceTopologyPanel topology={t} />);
    expect(screen.queryByTestId('topology-required-inputs')).toBeNull();
  });
});

describe('🚨 it can be edited without editing JSON', () => {
  it('changing the storage point of connection changes the engineering', () => {
    let next: ReturnType<typeof rayJob> | null = null;
    render(<ServiceTopologyPanel topology={rayJob()} onChange={t => { next = t; }} />);
    fireEvent.change(screen.getByTestId('domain-domain-a-connection'),
      { target: { value: 'backed-up-panel-busbar' } });
    expect(next).toBeTruthy();
    expect(next!.domains[0].storageConnection).toBe('backed-up-panel-busbar');
    // And only that domain moved — the edit is scoped, not global.
    expect(next!.domains[1].storageConnection).toBe('gateway-panelboard');
  });

  it('typing a fault current resolves it for the whole chain', () => {
    let next: ReturnType<typeof rayJob> | null = null;
    render(<ServiceTopologyPanel topology={rayJob({ availableFaultCurrentA: null })}
                                 onChange={t => { next = t; }} />);
    fireEvent.change(screen.getByTestId('service-fault-current'), { target: { value: '10000' } });
    expect(next!.service.availableFaultCurrentA).toBe(10_000);
  });

  it('without onChange it is read-only inspection', () => {
    render(<ServiceTopologyPanel topology={rayJob()} />);
    expect((screen.getByTestId('service-rated-amps') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByTestId('domain-domain-a-connection') as HTMLSelectElement).disabled).toBe(true);
  });

  it('no topology is said plainly, not rendered as an empty service', () => {
    render(<ServiceTopologyPanel topology={null} />);
    expect(screen.getByText(/No service topology on this project yet/)).toBeTruthy();
    expect(screen.queryByTestId('service-rated-amps')).toBeNull();
  });
});
