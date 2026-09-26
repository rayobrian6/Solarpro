/**
 * @vitest-environment jsdom
 *
 * tests/adminHealthShowsOnlyMeasuredStatus.component.test.tsx
 *
 * THE SYSTEM HEALTH MONITOR INVENTED FOUR OF ITS SIX SERVICE STATUSES.
 *
 * `fetchHealth` emitted these on every successful /api/admin/health response:
 *
 *   { name: 'Auth Service',       status: 'ok', latencyMs: 12 }
 *   { name: 'File Storage',       status: 'ok', latencyMs: 25 }
 *   { name: 'Engineering Engine', status: 'ok', latencyMs: 45 }
 *   { name: 'Incentive Engine',   status: 'ok', latencyMs: 18 }
 *
 * Nothing probed any of them. The endpoint returns a DB latency, a DB size, row
 * counts and table sizes; that is the whole of what this page can observe. So an
 * admin opening /admin/health while file storage was unreachable, JWT
 * verification was misconfigured, or the engineering engine was throwing saw a
 * green banner reading "All Systems Operational", "6/6 services healthy", and
 * four Operational badges over green latency gauges.
 *
 * The four literals did not merely add noise, they SUPPRESSED the signal:
 * `overallStatus` is `some(error) ? … : some(warning) ? … : 'ok'` and the count is
 * `filter(ok).length / services.length`, so four permanent `ok`s held the page
 * green through a partial outage. The page actively hid the thing it exists to
 * show.
 *
 * WHY THIS IS A RENDER AND NOT A SOURCE SCAN. The defect is what an operator
 * READS, and the count and banner are computed at render time from the array. So
 * the page is mounted in jsdom with a stubbed fetch and the assertions are made
 * against the text on screen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import SystemHealthPage from '@/app/admin/health/page';

const HEALTHY_PAYLOAD = {
  success: true,
  dbLatencyMs: 42,
  dbSizeHuman: '128 MB',
  rowCounts: { users: 5, projects: 9, clients: 4, proposals: 2, layouts: 7, project_files: 31 },
  tableSizes: [{ table: 'projects', size: '1 MB', sizeBytes: 1048576 }],
};

function stubFetch(payload: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  })));
}

/** The four subsystems that used to be emitted as `ok` with an invented latency. */
const UNMEASURED = ['Auth Service', 'File Storage', 'Engineering Engine', 'Incentive Engine'];
/** The latencies those four claimed, in the order above. */
const INVENTED_LATENCIES = ['12ms', '25ms', '45ms', '18ms'];

beforeEach(() => { stubFetch(HEALTHY_PAYLOAD); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the four unprobed subsystems are never given a status', () => {
  it('each is labelled Not monitored, and none is labelled Operational', async () => {
    render(<SystemHealthPage />);
    await waitFor(() => expect(screen.getByText(/Last checked:/)).toBeTruthy());

    // All four are still SHOWN — an operator must know they exist and are
    // unknown, which is the difference between "nothing is wrong" and "nothing
    // is measured".
    for (const name of UNMEASURED) {
      expect(screen.getByText(name), `${name} card is missing entirely`).toBeTruthy();
    }

    // There are exactly four "Not monitored" badges, one per unprobed subsystem.
    expect(screen.getAllByText('Not monitored')).toHaveLength(UNMEASURED.length);

    // And only the two MEASURED subsystems can carry an Operational badge, so a
    // healthy response yields exactly two.
    expect(screen.getAllByText('Operational')).toHaveLength(2);
  });

  it('no invented latency reaches the screen', async () => {
    render(<SystemHealthPage />);
    await waitFor(() => expect(screen.getByText(/Last checked:/)).toBeTruthy());

    // 🚨 The literal gauge values. Each of these was rendered by LatencyBar under
    // a green "Operational" badge for a subsystem nothing had contacted.
    for (const ms of INVENTED_LATENCIES) {
      expect(screen.queryByText(ms), `invented latency ${ms} is still rendered`).toBeNull();
    }
    // The two real ones are present: 42ms DB, and the measured round-trip.
    expect(screen.getAllByText('42ms').length).toBeGreaterThan(0);
  });
});

describe('the counts and the banner are scoped to what is measured', () => {
  it('the healthy count is over the 2 measured subsystems, not all 6', async () => {
    render(<SystemHealthPage />);
    await waitFor(() => expect(screen.getByText(/Last checked:/)).toBeTruthy());

    expect(screen.getByText('2/2 monitored services healthy')).toBeTruthy();
    // 🚨 The claim the page used to make while four of the six were fiction.
    expect(screen.queryByText('6/6 services healthy')).toBeNull();
  });

  it('the banner does not claim ALL systems, and says how many are unmonitored', async () => {
    render(<SystemHealthPage />);
    await waitFor(() => expect(screen.getByText(/Last checked:/)).toBeTruthy());

    expect(screen.queryByText('All Systems Operational')).toBeNull();
    expect(screen.getByText('Monitored Systems Operational')).toBeTruthy();
    expect(screen.getByText(/4 subsystems not monitored/)).toBeTruthy();
  });
});

describe('the two measured subsystems can still turn the page red', () => {
  it('a slow DB batch degrades the banner and the count', async () => {
    // 600ms > the 500ms error threshold for the Neon batch.
    stubFetch({ ...HEALTHY_PAYLOAD, dbLatencyMs: 600 });
    render(<SystemHealthPage />);
    await waitFor(() => expect(screen.getByText(/Last checked:/)).toBeTruthy());

    expect(screen.getByText('Service Disruption Detected')).toBeTruthy();
    // 🚨 THE SUPPRESSION THIS FINDING IS ABOUT. With the four fabricated `ok`s in
    // the array this read "5/6 services healthy" — a comfortable-looking ratio
    // that understated a total loss of the only subsystem being measured. Over
    // the measured set it is 1/2.
    expect(screen.getByText('1/2 monitored services healthy')).toBeTruthy();
    expect(screen.queryByText('5/6 services healthy')).toBeNull();
  });

  it('a failed fetch marks the measured services down and nothing else', async () => {
    stubFetch({ success: false, error: 'boom' });
    render(<SystemHealthPage />);
    await waitFor(() => expect(screen.getByText(/Failed to fetch health data/)).toBeTruthy());

    expect(screen.getAllByText('Down')).toHaveLength(2);
    expect(screen.getAllByText('Not monitored')).toHaveLength(4);
    expect(screen.getByText('0/2 monitored services healthy')).toBeTruthy();
  });
});
