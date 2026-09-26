/** @vitest-environment jsdom */

/**
 * tests/distributorPricesAdminPage.component.test.tsx
 *
 * THE ONLY UI FOR THE TOP-PRIORITY BOM PRICE AUTHORITY CRASHED ON LOAD.
 *
 * `/admin/distributor-prices` is the only screen that can write
 * `distributor_prices` — the table that outranks the static catalog for every
 * BOM dollar figure, the $/W KPI and the BOM Cost tile. Three separate breaks,
 * all on the wire between this page and its route:
 *
 *   1. The route sends `categoryFallbacks` (a Record); the page read
 *      `data.fallbacks` (an array). The stats block runs
 *      `data.fallbacks.length` unconditionally, so the whole screen died with
 *      "Cannot read properties of undefined (reading 'length')" the moment the
 *      fetch resolved.
 *   2. Catalog rows and the "Avg Catalog Cost" stat read `unitCost`, which the
 *      route never emitted — every one of those cells was `$NaN`.
 *   3. The Add/Edit modal POSTed camelCase to a snake_case parser, and the trash
 *      button sent `?id=` to a handler that read a JSON body. Both always failed.
 *
 * These tests RENDER THE REAL PAGE and click its real buttons, then hand what it
 * actually put on the wire to the REAL route handlers in the same process. No
 * source strings are matched anywhere in this file.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { NextResponse, type NextRequest } from 'next/server';
import { ToastProvider } from '@/components/ui/Toast';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OVERRIDE_ROW_ID = '33333333-3333-4333-8333-333333333333';

/** Rows the fake `sql` returns for the GET override query, and a write log. */
const dbState: { overrideRows: Record<string, unknown>[]; writes: string[] } = {
  overrideRows: [],
  writes: [],
};

vi.mock('@/lib/adminAuth', () => ({
  requireAdminApi: vi.fn(async () => ({ id: ADMIN_ID, email: 'admin@test', role: 'admin' })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/adminActivityLog', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/db-neon', () => ({
  // A recording stand-in, not PostgreSQL: this file is about the WIRE between the
  // page and the route. The same handlers are exercised against a real PostgreSQL
  // built from migration 015 in tests/distributorPriceOverridesAreWritable.test.ts.
  getDbReady: vi.fn(async () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (/^SELECT/i.test(text) && /FROM distributor_prices/i.test(text)) return dbState.overrideRows;
    dbState.writes.push(text);
    if (/^UPDATE/i.test(text)) {
      return dbState.overrideRows.length
        ? [{ ...dbState.overrideRows[0], unit_cost: values.find(v => typeof v === 'number') ?? 0 }]
        : [];
    }
    if (/^INSERT/i.test(text)) {
      return [{
        id: OVERRIDE_ROW_ID, user_id: null, part_number: 'X', category: 'battery',
        label: null, unit_cost: 1, source: 'Internal', price_date: null, notes: null,
        active: true, created_at: null, updated_at: null,
      }];
    }
    return [];
  }),
  isValidUUID: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: (tag: string, err: unknown) =>
    NextResponse.json({ success: false, error: `${tag} ${(err as Error)?.message}` }, { status: 500 }),
}));

const { GET, POST, DELETE } = await import('@/app/api/admin/distributor-prices/route');
const DistributorPricesPage = (await import('@/app/admin/distributor-prices/page')).default;

const ENDPOINT = 'http://localhost/api/admin/distributor-prices';

function nextReq(url: string, body?: unknown): NextRequest {
  return {
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return body;
    },
  } as unknown as NextRequest;
}

/** Every fetch the page made, in order. */
let sent: { url: string; init?: RequestInit }[] = [];

/**
 * Serves the page's GET from the REAL route handler, so the payload under test
 * is the one production sends — not a hand-written copy that can drift.
 */
function installFetchServedByTheRealRoute() {
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), init });
    if (!init?.method || init.method === 'GET') {
      const res = await GET(nextReq(ENDPOINT));
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

const renderPage = () => render(<ToastProvider><DistributorPricesPage /></ToastProvider>);

beforeEach(() => {
  dbState.overrideRows = [];
  dbState.writes = [];
  installFetchServedByTheRealRoute();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ─────────────────────────────────────────────────────────────────────────────

/** Each section tab is the only BUTTON carrying its label. */
const tab = (label: RegExp) => screen.getByRole('button', { name: label });

/** Waits for the fetch to have resolved and the page to have rendered its body. */
async function waitForLoaded() {
  // The crash happened AFTER the fetch resolved, so waiting for the loaded
  // state — not merely for a mount — is what makes these discriminating.
  await waitFor(() => expect(screen.queryByText(/Loading pricing data/i)).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Avg Catalog Cost')).toBeInTheDocument());
}

describe('🚨 the page survives its own route response', () => {
  it('renders the stats block instead of throwing on `fallbacks.length`', async () => {
    renderPage();
    await waitForLoaded();

    // `Avg Catalog Cost` only exists inside the `stats ? …` block, which is the
    // expression that threw. Reaching it at all is the assertion.
    expect(tab(/Category Fallbacks/i)).toBeInTheDocument();
    // No error banner: a broken response surfaces as one, not silently.
    expect(screen.queryByText(/^HTTP \d+$/)).not.toBeInTheDocument();
  });

  it('the Category Fallbacks tab lists every fallback the route sent', async () => {
    renderPage();
    await waitForLoaded();
    fireEvent.click(tab(/Category Fallbacks/i));

    // One `fallback` badge per rendered row. Zero rows would mean the
    // normalisation silently read the wrong key and produced [].
    await waitFor(() => expect(screen.getAllByText('fallback').length).toBeGreaterThan(10));
    expect(screen.queryByText(/\$NaN/)).not.toBeInTheDocument();

    // And the numbers are the route's, not placeholders.
    const batteryRow = screen.getByText('battery').parentElement!;
    const cost = Number((within(batteryRow).getByText(/^\$/).textContent ?? '').replace(/[$,]/g, ''));
    expect(cost).toBeGreaterThan(0);
  });

  it('Avg Catalog Cost is a real dollar amount, not $NaN', async () => {
    renderPage();
    await waitForLoaded();

    const card = screen.getByText('Avg Catalog Cost').parentElement!;
    const text = card.querySelector('.tabular-nums')!.textContent ?? '';
    // It was `$NaN`: the mean of a `unitCost` the route never emitted.
    expect(text).not.toMatch(/NaN/);
    expect(Number(text.replace(/[$,]/g, ''))).toBeGreaterThan(0);
  });

  it('no catalog row renders $NaN when a category is expanded', async () => {
    renderPage();
    await waitForLoaded();
    fireEvent.click(tab(/Static Catalog/i));

    // solar_panel is the sharpest case: the route sends `netPrice: null` for
    // panels (their catalog net is $/W, not $/panel), so the per-unit dollar
    // figure exists ONLY in the resolved `unitCost`. That cell used to be $NaN
    // and there is no other column it could be copied from.
    await waitFor(() => expect(screen.getByText('solar_panel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('solar_panel'));
    await waitFor(() => expect(screen.getByText('Q.PEAK DUO BLK ML-G10+400')).toBeInTheDocument());

    expect(screen.queryByText(/\$NaN/)).not.toBeInTheDocument();
    const row = screen.getByText('Q.PEAK DUO BLK ML-G10+400').parentElement!;
    // Net column: the em dash the route sends for panels.
    expect(within(row).getByText('—')).toBeInTheDocument();
    // Unit Cost column (the emerald cell) — 0.34 $/W × 400 W.
    expect(row.querySelector('.text-emerald-400')!.textContent).toBe('$136.00');
  });
});

describe('🚨 what the page PUTS ON THE WIRE is what the route parses', () => {
  async function openModalAndSave() {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Add Override/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Add Override/i }));

    await waitFor(() => expect(screen.getByText('New Price Override')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/REC400AA/), { target: { value: 'PW3-US' } });
    fireEvent.change(screen.getByPlaceholderText(/panel, inverter, racking/), { target: { value: 'battery' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7100' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Override/i }));

    await waitFor(() => expect(sent.some(s => s.init?.method === 'POST')).toBe(true));
    return sent.find(s => s.init?.method === 'POST')!;
  }

  it('the POST body the modal sends is ACCEPTED by the real route handler', async () => {
    const call = await openModalAndSave();
    const body = JSON.parse(String(call.init!.body));

    // Straight from the page's own click handler into the shipped parser.
    const res = await POST(nextReq(ENDPOINT, body));
    const json = await res.json();
    // Was 400 "part_number is required" for every save this UI has ever made.
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('that body carries the values the admin typed', async () => {
    const call = await openModalAndSave();
    const body = JSON.parse(String(call.init!.body));
    expect(body).toMatchObject({ part_number: 'PW3-US', category: 'battery', unit_cost: 7100 });
    // No stale camelCase left behind alongside the snake_case keys.
    expect(body).not.toHaveProperty('partNumber');
    expect(body).not.toHaveProperty('unitCost');
  });

  it('the save reaches a WRITE — it does not stop at validation', async () => {
    const call = await openModalAndSave();
    await POST(nextReq(ENDPOINT, JSON.parse(String(call.init!.body))));
    expect(dbState.writes.some(w => /^UPDATE distributor_prices/i.test(w))).toBe(true);
    expect(dbState.writes.some(w => /^INSERT INTO distributor_prices/i.test(w))).toBe(true);
    // And never via an arbiter that does not exist.
    expect(dbState.writes.join(' ')).not.toMatch(/ON CONFLICT/i);
  });

  it('the trash button sends an id the real DELETE handler can find', async () => {
    dbState.overrideRows = [{
      id: OVERRIDE_ROW_ID, user_id: null, part_number: 'PW3-US', category: 'battery',
      label: 'Tesla Powerwall 3', unit_cost: 7100, source: 'CED', price_date: null,
      notes: null, active: true, created_at: null, updated_at: null,
    }];
    renderPage();
    await waitFor(() => expect(screen.getByText('PW3-US')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Delete'));
    await waitFor(() => expect(screen.getByText(/Delete override for PW3-US/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(sent.some(s => s.init?.method === 'DELETE')).toBe(true));
    const call = sent.find(s => s.init?.method === 'DELETE')!;

    // The page sends no body at all — which is why reading req.json() 400'd.
    expect(call.init!.body).toBeUndefined();
    expect(call.url).toMatch(new RegExp(`\\?id=${OVERRIDE_ROW_ID}$`));
    // The page's URL is relative, as any in-app fetch is; Next hands the handler
    // the absolute form.
    const res = await DELETE(nextReq(new URL(call.url, 'http://localhost').toString()));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
