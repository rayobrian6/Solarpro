/** @vitest-environment jsdom */

/**
 * tests/dashboardCtasDoWhatTheySay.component.test.tsx
 *
 * TWO DASHBOARD BUTTONS THAT REPORTED DOING SOMETHING AND DID NOTHING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * C2 — THE CTA THAT OPENED A MODAL AND NAVIGATED AWAY IN THE SAME CLICK
 * ─────────────────────────────────────────────────────────────────────────────
 * The three headline cards on the dashboard — "Resolve Now" on the pulsing red
 * Critical Actions card, "Follow Up", "Advance" — each pick the most stale
 * project of a status and set a `DealDecisionModal` for it into state. Each is
 * also a `next/link`. `CommandCard`'s `onCtaClick` was typed `() => void`, so
 * the handler could not name the click event and could not call
 * `preventDefault()` on it: React set the state, the Link navigated, and the
 * modal was discarded on the same tick. Clicking the dashboard's most prominent
 * CTA just landed the user on `/projects?status=proposal`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * C3 — THE INSPECTION COMMAND THAT SCHEDULED NOTHING, FOREVER
 * ─────────────────────────────────────────────────────────────────────────────
 * `generateActions.ts` rule 5 creates "Schedule inspection for <client>" once the
 * install date has passed. Pressing Execute ran `handleCompleteCommand` — the
 * command went to 'completed', the toast said "Action completed ✓", and no
 * inspection existed anywhere: no `project_schedule` row, no stage change, no
 * activity entry. The next generation pass recreated the card, so the same
 * non-action could be "completed" indefinitely.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE RENDERS
 * ─────────────────────────────────────────────────────────────────────────────
 * Both are claims about what a click DOES. A source scan can say
 * `preventDefault` appears somewhere in a 1900-line file; only a render can say
 * that clicking *this* control prevents *its* navigation and that *this* modal
 * is on screen afterwards. So the real page is mounted and the real
 * `DealDecisionModal` and `ScheduleInspectionModal` are used.
 *
 * 🚨 HOW NAVIGATION IS MEASURED, STATED PLAINLY. jsdom cannot perform a Next
 * App Router navigation, and a real `next/link` needs an app-router context this
 * harness has no way to supply. So `next/link` is replaced by an `<a>` that
 * records a navigation UNLESS the click was default-prevented — which is exactly
 * the mechanism the defect turned on, and exactly what the real Link does with a
 * prevented click. What is measured is therefore `preventDefault`, not a URL
 * change, and the file says so rather than implying more.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

// ── Identities ──────────────────────────────────────────────────────────────

const STALE_PROPOSAL = '11111111-1111-4111-8111-111111111111';
const STALE_DESIGN   = '22222222-2222-4222-8222-222222222222';
const INSPECTION_CMD = '33333333-3333-4333-8333-333333333333';
const INSPECTION_PROJ = '44444444-4444-4444-8444-444444444444';

// ── Navigations the page attempts ───────────────────────────────────────────

/** Every href a Link click would have followed, in order. */
const navigations: string[] = [];

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, onClick, ...rest }: any) =>
    React.createElement(
      'a',
      {
        href: typeof href === 'string' ? href : '#',
        ...rest,
        onClick: (e: React.MouseEvent) => {
          onClick?.(e);
          // 🚨 THE WHOLE MEASUREMENT. A real next/link that receives a
          // default-prevented click does not navigate. This records the
          // navigation only when the handler did NOT prevent it.
          if (!e.defaultPrevented) navigations.push(String(href));
        },
      },
      children,
    ),
}));

const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}));

// `CrewCalendar` is loaded with next/dynamic({ ssr: false }); it is irrelevant here.
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function Stub() { return null; },
}));

vi.mock('@/components/ui/AppShell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'shell' }, children),
}));

vi.mock('@/contexts/UserContext', () => ({
  useUser: () => ({ user: { id: 'u1', name: 'Ray O', email: 'r@e.st', role: 'installer' } }),
  isAdminRole: () => false,
}));

vi.mock('@/components/onboarding/BillUploadModal', () => ({
  __esModule: true, default: () => null,
}));

// ── The store the page reads ────────────────────────────────────────────────
//
// 🚨 THE DEAL DECISION MODAL IS NOT MOCKED. The assertion is that it is on
// screen, so a stub would make the test pass against the defect.

const project = (over: Record<string, unknown>) => ({
  id: 'x', name: 'Project', systemType: 'roof', status: 'lead',
  createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
  updatedAt: new Date(Date.now() - 20 * 86400000).toISOString(),
  client: { name: 'Braidon Pilla' }, notes: '',
  ...over,
});

const PROJECTS = [
  project({ id: STALE_PROPOSAL, name: 'Melvin Drive', status: 'proposal' }),
  project({
    id: STALE_DESIGN, name: 'Stowell Road', status: 'design',
    layout: { systemSizeKw: 8.4, totalPanels: 21 },
  }),
];

vi.mock('@/store/appStore', () => {
  const state = {
    projects: PROJECTS,
    clients: [{ id: 'c1', name: 'Braidon Pilla' }],
    projectsState: 'loaded',
    clientsState: 'loaded',
    loadProjects: vi.fn(async () => {}),
    loadClients: vi.fn(async () => {}),
  };
  return { useAppStore: (sel: (s: unknown) => unknown) => sel(state) };
});

// ── The network ─────────────────────────────────────────────────────────────

interface Call { url: string; method: string; body: any }
let calls: Call[] = [];

const INSPECTION_COMMAND = {
  id: INSPECTION_CMD,
  project_id: INSPECTION_PROJ,
  user_id: 'u1',
  title: 'Schedule inspection for Braidon Pilla',
  description: 'Installation date has passed. Schedule final inspection.',
  type: 'inspection',
  priority: 'high',
  status: 'pending',
  due_date: null,
  created_at: new Date().toISOString(),
  auto_generated: true,
  project_name: 'Melvin Drive',
  client_name: 'Braidon Pilla',
};

function installFetch(overrides: Record<string, () => unknown> = {}) {
  calls = [];
  global.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    let body: any = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = init?.body; }
    calls.push({ url, method, body });

    for (const [pattern, fn] of Object.entries(overrides)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(fn()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (url.includes('/api/commands?')) {
      return new Response(JSON.stringify({ commands: [INSPECTION_COMMAND] }), { status: 200 });
    }
    if (url.includes('/api/schedule')) {
      return new Response(JSON.stringify({ schedule: [], item: { id: 's1' } }), { status: 201 });
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
  }) as never;
}

async function renderDashboard() {
  const Page = (await import('@/app/dashboard/page')).default;
  const out = render(React.createElement(Page));
  // The commands fetch resolves on mount; wait for the list to land.
  await waitFor(() => expect(calls.some(c => c.url.includes('/api/commands?'))).toBe(true));
  return out;
}

/** The three headline CommandCards live behind the Focus/Full View toggle. */
async function showFullView() {
  fireEvent.click(await screen.findByText('Full View'));
  await screen.findByText('Action Priority');
}

beforeEach(() => {
  navigations.length = 0;
  routerPush.mockClear();
  installFetch();
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// C2
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 C2: a headline CTA that opens the decision modal does not also navigate', () => {
  it('"Resolve Now" opens the modal and prevents its own navigation', async () => {
    await renderDashboard();
    await showFullView();

    fireEvent.click(screen.getByText('Resolve Now'));

    // The modal is really on screen — the real DealDecisionModal, named by its
    // own header, showing a stage it can actually act on.
    const heading = await screen.findByText('Update Stage');
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(/^Currently:/)).toBeInTheDocument();
    // 🚨 AND ITS PRIMARY OPTION IS ENABLED. `openDecisionModal` used to hand the
    // modal the LEGACY status ('proposal'), which is not in PROJECT_PIPELINE, so
    // "Move to next stage" was greyed out and Confirm would have posted a stage
    // update-status rejects with 400. A modal that is merely visible is not a
    // repair.
    const nextOption = screen.getByText('Move to next stage').closest('button')!;
    expect(nextOption, 'the modal opened with its primary option disabled')
      .not.toBeDisabled();
    expect(screen.getByText('Contract Signed')).toBeInTheDocument();

    // And nothing navigated. BEFORE THE REPAIR this array held
    // '/projects?status=proposal' and the modal was thrown away on the same tick.
    expect(navigations,
      'the CTA navigated away, discarding the modal it had just opened')
      .toEqual([]);
  });

  it('"Follow Up" and "Advance" behave the same way', async () => {
    await renderDashboard();
    await showFullView();

    for (const cta of ['Follow Up', 'Advance']) {
      fireEvent.click(screen.getByText(cta));
      expect(await screen.findByText('Update Stage'),
        `${cta} did not open the decision modal`).toBeInTheDocument();
      expect(navigations, `${cta} navigated away`).toEqual([]);
      // Dismiss before the next one.
      fireEvent.click(screen.getByLabelText ? screen.getAllByText('Cancel')[0] : screen.getAllByText('Cancel')[0]);
      await waitFor(() => expect(screen.queryByText('Update Stage')).toBeNull());
    }
  });

  it('the modal it opens is for THIS project and targets the live stage route', async () => {
    // Proves the modal is wired, not merely visible: confirming it posts the
    // selected project to the one route every stage surface calls.
    await renderDashboard();
    await showFullView();
    fireEvent.click(screen.getByText('Resolve Now'));
    await screen.findByText('Update Stage');

    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(
      calls.some(c => c.url.includes('/api/projects/update-status') && c.method === 'POST'),
    ).toBe(true));
    const post = calls.find(c => c.url.includes('/api/projects/update-status'))!;
    expect(post.body.projectId).toBe(STALE_PROPOSAL);
    // 🚨 A REAL PIPELINE STAGE, not the legacy status the modal used to be given.
    // `update-status` rejects anything outside PROJECT_PIPELINE with a 400.
    expect(post.body.status).toBe('contract_signed');
  });

  it('🚨 and with NO target project it still navigates — the href is the fallback, not dead weight', async () => {
    // The other half of the contract. `preventDefault` is conditional on having
    // something to open; a repair that prevented unconditionally would turn a
    // working link into a dead button on an empty pipeline.
    vi.resetModules();
    vi.doMock('@/store/appStore', () => {
      const state = {
        projects: [], clients: [], projectsState: 'loaded', clientsState: 'loaded',
        loadProjects: vi.fn(async () => {}), loadClients: vi.fn(async () => {}),
      };
      return { useAppStore: (sel: (s: unknown) => unknown) => sel(state) };
    });
    const Page = (await import('@/app/dashboard/page')).default;
    render(React.createElement(Page));
    fireEvent.click(await screen.findByText('Full View'));
    await screen.findByText('Action Priority');

    fireEvent.click(screen.getByText('Resolve Now'));
    await waitFor(() => expect(navigations).toEqual(['/projects?status=proposal']));
    expect(screen.queryByText('Update Stage')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C3
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 C3: Execute on an inspection command books an inspection', () => {
  it('opens a booking surface instead of silently completing the command', async () => {
    await renderDashboard();
    expect(await screen.findByText('Schedule inspection for Braidon Pilla')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Execute/));

    // BEFORE THE REPAIR: no modal, a 'complete' PATCH, and "Action completed ✓".
    expect(await screen.findByLabelText('Inspection date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Book Inspection/ })).toBeInTheDocument();
    expect(calls.some(c => c.url.includes(`/api/commands/${INSPECTION_CMD}`)),
      'the command was marked done before anything was booked')
      .toBe(false);
  });

  it('files a real project_schedule row of type inspection, and moves the stage', async () => {
    await renderDashboard();
    fireEvent.click(screen.getByText(/Execute/));
    await screen.findByLabelText('Inspection date');

    fireEvent.change(screen.getByLabelText('Inspection date'), { target: { value: '2026-11-04' } });
    fireEvent.click(screen.getByRole('button', { name: /Book Inspection/ }));

    await waitFor(() => expect(
      calls.some(c => c.url.includes('/api/schedule') && c.method === 'POST'),
    ).toBe(true));

    const booked = calls.find(c => c.url.includes('/api/schedule') && c.method === 'POST')!;
    expect(booked.body).toMatchObject({
      project_id: INSPECTION_PROJ,
      type: 'inspection',
      date: '2026-11-04',
    });

    const staged = calls.find(c => c.url.includes('/api/projects/update-status'));
    expect(staged, 'the pipeline stage was not moved to inspection').toBeDefined();
    expect(staged!.body).toMatchObject({ projectId: INSPECTION_PROJ, status: 'inspection' });

    // Only NOW is the command done.
    await waitFor(() => expect(
      calls.some(c => c.url.includes(`/api/commands/${INSPECTION_CMD}`) && c.method === 'PATCH'),
    ).toBe(true));
    expect(await screen.findByText('Inspection booked ✓')).toBeInTheDocument();
  });

  it('🚨 the booking is written BEFORE the command is completed, and a failed booking completes nothing', async () => {
    // The precise inversion of the defect: the old path reported success for an
    // absent side effect. If the schedule row cannot be written, the command must
    // stay pending and the user must be told.
    installFetch({
      '/api/schedule': () => ({ error: 'project_schedule does not exist' }),
    });
    // The override above must 500, not 200 — rebuild the stub for this one case.
    global.fetch = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      let body: any = null;
      try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = init?.body; }
      calls.push({ url, method, body });
      if (url.includes('/api/schedule') && method === 'POST') {
        return new Response(JSON.stringify({ error: 'no such table: project_schedule' }), { status: 500 });
      }
      if (url.includes('/api/commands?')) {
        return new Response(JSON.stringify({ commands: [INSPECTION_COMMAND] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: {}, schedule: [] }), { status: 200 });
    }) as never;

    await renderDashboard();
    fireEvent.click(screen.getByText(/Execute/));
    await screen.findByLabelText('Inspection date');
    fireEvent.click(screen.getByRole('button', { name: /Book Inspection/ }));

    expect(await screen.findByText(/no such table: project_schedule/)).toBeInTheDocument();
    expect(calls.some(c => c.url.includes(`/api/commands/${INSPECTION_CMD}`) && c.method === 'PATCH'),
      'the command was completed even though nothing was booked')
      .toBe(false);
    expect(screen.queryByText('Inspection booked ✓')).toBeNull();
  });
});
