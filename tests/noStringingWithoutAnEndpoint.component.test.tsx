/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE INVERTERS & STRINGS CARD ON A FRESH JOB: modules known, strings PENDING (closure brief §2).
//
// The fresh 37-module project with no PV inverter and no storage read "String Inverter · 37 panels ·
// 16.28 kW DC · 2 strings (20/17 panels)". The card now states the array and that its stringing waits
// for equipment — never a partition, never a "String Inverter" with a blank model. (The page's fleet
// list renders no phantom row: an endpoint-less entry is dropped by the runtime guard and, for the one
// render before, shown as "PV inverter not chosen" — tests/noStringingWithoutAnEndpoint.test.ts.)
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { buildSystemConfigInterview, type InterviewEquipment } from '@/lib/electrical/systemConfigInterview';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology } from '@/lib/electrical/serviceTopology';
import { applyVia, type ItemEditorContext } from '@/components/engineering/systemConfig/ItemEditor';
import { InvertersStringsDecisions } from '@/components/engineering/systemConfig/cards/InvertersStringsCard';
import { FleetRowSummary } from '@/components/engineering/systemConfig/cards/FleetRowSummary';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const FRESH: InterviewEquipment = { pvInverter: { state: 'UNDECIDED' }, storage: null, gateway: null };
const NO_SELECTION = { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 };

function mountFresh(derivedStrings: number[] = []) {
  const interview = buildSystemConfigInterview({
    pvArray: pv37, topology: null, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: FRESH, evaluation: null, derivedStrings: derivedStrings.map(panelCount => ({ panelCount })),
  });
  const ctx: ItemEditorContext = {
    topology: null, pvArray: pv37, derivedStrings, equipment: NO_SELECTION, busy: false,
    apply: applyVia(async () => true),
  };
  return render(<div id="sc-card-inverters">
    <InvertersStringsDecisions {...ctx} interview={interview} coupling={null} pvInverterState="UNDECIDED" />
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE FLEET ROW ITSELF — the line that printed "String Inverter · 37 panels · 16.28 kW DC · 2 strings
// (20/17 panels)". Review finding: the tests above mount the card's decisions, which never drew that
// line. `FleetRowSummary` IS the page's row summary now (app/engineering/page.tsx renders every fleet
// row through it), so this renders the production row.
// ═══════════════════════════════════════════════════════════════════════════
describe('the Inverters & Strings fleet row on a fresh job', () => {
  const stored2017 = { inverterId: '', type: 'string', strings: [{ panelCount: 20 }, { panelCount: 17 }] };

  it('an entry with no PV inverter renders "PV inverter not chosen · 37 modules · Stringing pending" — no type, no 20/17', () => {
    const { container } = render(<FleetRowSummary inv={stored2017} manufacturer={null} model={null}
      panels={37} kwDc={16.28} designModuleCount={37} />);
    const row = screen.getByTestId('inv-fleet-row-pending');
    expect(row.textContent).toContain('PV inverter not chosen');
    expect(row.textContent).toContain('37 modules');
    expect(row.textContent).toContain('Stringing pending equipment selection');
    const text = container.textContent ?? '';
    expect(text).not.toContain('String Inverter');
    expect(text).not.toMatch(/20\s*\/\s*17/);
    expect(text).not.toMatch(/\d+ strings? \(/);
    expect(text).not.toContain('kW DC');
    expect(screen.queryByTestId('inv-fleet-row-summary')).toBeNull();
  });

  it('a micro entry with no device is the same pending state — not a model-less "Microinverter" row', () => {
    const { container } = render(<FleetRowSummary inv={{ inverterId: '', type: 'micro', strings: [{ panelCount: 37 }] }}
      panels={37} kwDc={16.28} designModuleCount={37} micro={{ devices: 37, branches: 3 }} />);
    expect(screen.getByTestId('inv-fleet-row-pending')).toBeTruthy();
    expect(container.textContent ?? '').not.toContain('Microinverter');
  });

  it('control: a chosen inverter renders its row as before', () => {
    render(<FleetRowSummary inv={{ inverterId: 'fronius-primo-8.2', type: 'string', strings: [{ panelCount: 10 }, { panelCount: 10 }] }}
      manufacturer="Fronius" model="Primo 8.2-1" panels={20} kwDc={8.8} designModuleCount={37} />);
    const row = screen.getByTestId('inv-fleet-row-summary');
    expect(row.textContent).toContain('Fronius Primo 8.2-1');
    expect(row.textContent).toMatch(/String Inverter ·\s*20 panels ·\s*8\.80 kW DC/);
    expect(row.textContent).toContain('2 strings (10/str)');
    expect(screen.queryByTestId('inv-fleet-row-pending')).toBeNull();
  });
});

describe('a fresh project — Design modules, no PV inverter, no storage', () => {
  it('states 37 modules and "Stringing pending equipment selection", with no partition and no phantom inverter', () => {
    const { container } = mountFresh();
    const pending = screen.getByTestId('inv-stringing-pending');
    expect(pending.textContent).toContain('37 modules');
    expect(pending.textContent).toContain('Stringing pending equipment selection');
    expect(pending.getAttribute('data-state')).toBe('pending');
    expect(screen.getByTestId('inv-pv-inverter').textContent).toContain('Not chosen');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/20\s*\/\s*17/);
    expect(text).not.toContain('String Inverter');
    expect(text).not.toMatch(/\d+ strings? \(/);
    // No DC-coupled strings block either — nothing is coupled to anything yet.
    expect(screen.queryByTestId('inv-strings-summary')).toBeNull();
  });

  it('even a partition handed in by a stale caller is not displayed while nothing is chosen', () => {
    const { container } = mountFresh([20, 17]);
    expect(screen.getByTestId('inv-stringing-pending').textContent).toContain('Stringing pending equipment selection');
    expect(container.textContent ?? '').not.toMatch(/20\s*\/\s*17/);
  });

  it('control: on Ray\'s DC-coupled job the engineered strings ARE shown, and nothing is "pending"', () => {
    const t = { ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const };
    const eq: InterviewEquipment = {
      pvInverter: { state: 'NONE' },
      storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
      gateway: { label: 'Tesla Gateway 3', count: 2 },
    };
    const strings = [9, 9, 9, 8, 2];
    const interview = buildSystemConfigInterview({
      pvArray: pv37, topology: t, coupling: 'dc-coupled-storage', couplingIsDecision: true, architectureConflict: false,
      equipment: eq, evaluation: evaluateServiceTopology(t), derivedStrings: strings.map(panelCount => ({ panelCount })),
    });
    render(<InvertersStringsDecisions topology={t} pvArray={pv37} derivedStrings={strings} busy={false}
      equipment={{ gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', storageLabel: 'Tesla Powerwall 3', totalUnits: 4 }}
      apply={applyVia(async () => true)} interview={interview} coupling="dc-coupled-storage" pvInverterState="NONE" />);
    expect(screen.getByTestId('inv-strings-count').textContent).toBe('5 strings (9/9/9/8/2)');
    expect(screen.queryByTestId('inv-stringing-pending')).toBeNull();
  });
});
