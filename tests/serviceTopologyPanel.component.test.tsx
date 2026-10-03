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
    // And the two domains name different panels — by the LABEL on the enclosure, not by the
    // internal id. "backs msp-1" is a key an electrician should never have to read.
    expect(screen.getByTestId('domain-domain-a').textContent).toContain('MSP #1');
    expect(screen.getByTestId('domain-domain-b').textContent).toContain('MSP #2');
    expect(screen.getByTestId('domain-domain-a').textContent).not.toMatch(/\bmsp-1\b/);
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
    // 🚨 IN WORDS. This line required the raw token `service.availableFaultCurrentA` on screen —
    // it was PINNING the defect, the same way the sheet's assertion pinned the printed field path
    // and the schedule's pinned `branch-a`. The token is still the key; it is not the label.
    expect(within(box).getByText('Available fault current at the service')).toBeTruthy();
    expect(within(box).queryByText('service.availableFaultCurrentA')).toBeNull();
    // And the input that would fix it is on screen, marked required rather than defaulted to 0.
    const fc = screen.getByTestId('service-fault-current') as HTMLInputElement;
    expect(fc.value).toBe('');
    expect(fc.placeholder).toBe('REQUIRED');
  });

  it('a check that could not run prints its REQUIRES beside it', () => {
    render(<ServiceTopologyPanel topology={rayJob({ branchDemandA: [null, null] })} />);
    const b = screen.getByTestId('branch-branch-a');
    expect(within(b).getAllByText(/NOT EVAL/).length).toBeGreaterThan(0);
    // 🚨 ONE TOKEN FOR THE WHOLE LOAD QUESTION. It used to be `calculatedDemandA` per branch plus
    // `calculatedServiceDemandA` plus `backedUpDemandA` per domain — five requests for one house.
    expect(within(b).getByText(/REQUIRES: loads.model/)).toBeTruthy();
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
    // And it now includes the DER interconnection arrangement — the decision the designer owes the
    // drawing. The same forgetting, one level up, and the model was right again.
    // And it now includes HOW THE PV IS COUPLED — the project-level answer that stops the
    // drawing and the sidebar each inferring one. The same forgetting, one level further out.
    const t = rayJob({
      storageConnection: 'backed-up-panel-busbar',
      derArrangement: 'independent-branch',
      solarCoupling: 'storage-only',
    });
    t.interconnection.multiGatewayMeteringDoc = {
      title: 'Multiple Backup Gateways on a Single Site — Application Note',
      source: 'archived', present: true, governs: ['metering'],
    };
    for (const d of t.domains) d.backedUpDemandA = 100;
    for (const dev of t.devices) dev.sccrA = 22_000;
    for (const p of t.panels) { p.sccrA = 22_000; p.busbarRatingA = 225; p.mainBreakerA = 150; }
    // And the part actually bought, and the utility's ruling on the isolation arrangement as
    // drawn. Same forgetting again, one level further out: a calculated minimum rating is not a
    // purchase and a proven traversal is not an approval.
    for (const dev of t.devices) dev.productId = 'eaton-dg224urk';
    t.interconnection.isolationArrangementAccepted = true;
    // And whether the service equipment is existing or new — not answered is not "new".
    t.service.existingOrNew = 'new';
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
