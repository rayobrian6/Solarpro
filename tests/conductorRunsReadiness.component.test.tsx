/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// Ray: "If any required input is missing → NOT EVALUATED… Then Engineering Readiness tells the user
// exactly what is missing." The readiness panel lists each missing fact ONCE, with how many runs
// wait on it, and keeps what only voltage drop waits on apart.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConductorRunsReadiness } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { engineerServiceRuns, runEnvironmentFrom } from '@/lib/electrical/electricalRuns';

afterEach(cleanup);

describe('Engineering Readiness — conductors & raceway', () => {
  it('Ray\'s job: 6 of 12 runs engineered; the one missing manufacturer fact is listed once', () => {
    const runs = engineerServiceRuns(buildRaysIntendedJob().topology, runEnvironmentFrom({ state: 'IL', racewayType: 'EMT' }));
    render(<ConductorRunsReadiness runs={runs} />);
    const box = screen.getByTestId('readiness-conductors');
    expect(box.getAttribute('data-engineered')).toBe('6');
    expect(box.getAttribute('data-not-evaluated')).toBe('6');
    expect(box.textContent).toContain('6 of 12 runs engineered');
    const needs = screen.getAllByTestId('readiness-conductor-need');
    expect(needs).toHaveLength(1);
    expect(needs[0].textContent).toContain('Tesla Powerwall 3 — whether its AC terminals take a neutral');
    expect(needs[0].textContent).toContain('6 runs');
    expect(screen.getByTestId('readiness-conductor-vd').textContent).toContain('the one-way run length');
  });

  it('no project location: every run waits on it, and readiness says exactly that', () => {
    const runs = engineerServiceRuns(buildRaysIntendedJob().topology, runEnvironmentFrom({ racewayType: 'EMT' }));
    render(<ConductorRunsReadiness runs={runs} />);
    expect(screen.getByTestId('readiness-conductors').textContent).toContain('0 of 12 runs engineered');
    const ambient = screen.getAllByTestId('readiness-conductor-need').find(n => n.getAttribute('data-key') === 'ambient');
    expect(ambient?.textContent).toContain('the project location (state) is not established');
    expect(ambient?.textContent).toContain('12 runs');
  });
});
