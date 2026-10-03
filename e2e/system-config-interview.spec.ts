import { expect, test, type Page } from '@playwright/test';
import { buildRaysIntendedJob } from '../lib/electrical/fixtures/tesla400aTwoGateway';

/**
 * e2e/system-config-interview.spec.ts
 *
 * 🚨 SYSTEM CONFIG AS THE INSTALLER'S INTERVIEW — IN A REAL BROWSER, AGAINST REAL ROUTES AND REAL
 * POSTGRESQL (SOLARPRO_LOCAL_PG=1, no credential).
 *
 * Ray's standard: "UI action → state mutation → persistence → reload → calculation → output request
 * → output artifact… If Ray's browser disagrees with the tests: the slice is reopened."
 *
 * What it drives, end to end:
 *   · a project whose Design placed 37 × 440 W, seeded through the real POST routes;
 *   · the PV Design card and the Engineering Summary state 37 modules · 16.28 kW DC from Design;
 *   · "What is the existing service rating?" → 400 A → "How is the 400 A service distributed?" appears
 *     → "Two 200 A main panels" → two panel cards; a RELOAD keeps all of it;
 *   · Ray's DC-coupled job: the summary, the sheet the page requests, and the stored module record all
 *     say 37 × 440 W / 16.28 kW / no PV inverter, through an autosave and a reload;
 *   · a plain 200 A service is never asked about distribution, multiple systems or backup;
 *   · "Where does the system connect to the service?" → "Breaker in the panel (load side)" survives a
 *     reload, read back from the store, not from React state.
 *
 * Skips, loudly, without SOLARPRO_LOCAL_PG — it never pretends to pass against nothing.
 */

const LOCAL_PG = process.env.SOLARPRO_LOCAL_PG === '1';

async function api(page: Page, method: 'POST' | 'PUT', url: string, data: unknown) {
  const res = await page.request.fetch(url, { method, data, headers: { 'X-Dev-Auth': 'bypass' } });
  const body = await res.json().catch(() => ({}));
  expect(res.ok(), `${method} ${url} → ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toBe(true);
  return body as Record<string, any>;
}

async function seedRaysArray(page: Page): Promise<string> {
  const created = await api(page, 'POST', '/api/projects', {
    name: `System Config interview ${Date.now()}`, address: 'Peoria, IL', systemType: 'fence',
  });
  const projectId = String(created.data?.id ?? created.project?.id ?? created.id);
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
  const panels = Array.from({ length: 37 }, (_, i) => ({
    id: `pnl-${i}`, lat: 40.6936, lng: -89.589 + i * 0.00001, x: i * 10, y: 0,
    tilt: 90, azimuth: 180, wattage: 440, bifacialGain: 0, row: 0, col: i, systemType: 'fence',
  }));
  await api(page, 'POST', `/api/projects/${projectId}/layout`, { panels, systemType: 'fence' });
  await api(page, 'POST', `/api/projects/${projectId}/equipment`, {
    selectedPanel: { id: 'panel-fence-ps1', manufacturer: 'Philadelphia Solar', model: 'Nexus PS-MNB108(HCBF)-440W', wattage: 440 },
  });
  return projectId;
}

async function openSystemConfig(page: Page, projectId: string) {
  await page.goto(`/engineering?projectId=${projectId}`);
  await expect(page.getByTestId('system-config-interview')).toBeVisible({ timeout: 60_000 });
}

/** Wait for the one write path the interview uses. */
const graphWrite = (page: Page) => page.waitForResponse(r =>
  r.url().includes('/service-topology') && r.request().method() === 'PUT' && r.status() === 200);

test.describe('System Config interview — real browser, real routes, real PostgreSQL', () => {
  test.skip(!LOCAL_PG, 'needs SOLARPRO_LOCAL_PG=1 (in-process PostgreSQL); see e2e/README.md');
  test.setTimeout(180_000);

  test('Design facts are stated from Design, before anything is answered', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);
    await expect(page.getByTestId('interview-summary-design')).toContainText('37 modules · 440 W · 16.28 kW DC');
    await expect(page.getByTestId('summary-fact-pv-modules')).toHaveText('37');
    await expect(page.getByTestId('summary-fact-pv-dc-size')).toHaveText('16.28 kW');
    // Nothing is chosen for the strings to land on, so no partition is stated as engineered.
    await expect(page.getByTestId('summary-fact-pv-strings')).toContainText('Not derived');
    // The first open question is the service — the array is not asked for, it is known.
    await expect(page.getByTestId('interview-item-service.rating')).toHaveAttribute('data-state', 'needs-answer');
  });

  test('Ray\'s DC-coupled job: the page, the drawing it requests, and the stored module all say 37 × 440 W', async ({ page }) => {
    // The defect this exists for was found HERE, not by a unit test: on this exact job the page's
    // panel-compatibility auto-heal swapped Design's 440 W module for a 620 W one (judged against a
    // migration-default "enphase" brand on a job with no PV inverter), the autosave wrote it over the
    // project's module record, and the sheet the page requested drew 37 × 620 W, 22.94 kW DC, as a
    // microinverter path, with the strings at 20 / 17.
    const projectId = await seedRaysArray(page);
    await api(page, 'PUT', `/api/projects/${projectId}/service-topology`, { topology: buildRaysIntendedJob().topology });
    await openSystemConfig(page, projectId);

    await expect(page.getByTestId('summary-fact-pv-inverter')).toHaveText('None — DC coupled to storage');
    await expect(page.getByTestId('summary-fact-pv-architecture')).toHaveText('DC coupled to Tesla Powerwall 3');
    await expect(page.getByTestId('summary-fact-pv-dc-size')).toHaveText('16.28 kW');
    await expect(page.getByTestId('summary-fact-storage')).toHaveText('4 × Tesla Powerwall 3');
    await expect(page.getByTestId('summary-fact-ess-max-continuous-ac-output')).toHaveText('46.08 kW (192 A)');
    await expect(page.getByTestId('summary-fact-backup-controllers')).toHaveText('2 × Tesla Backup Gateway 3');
    // The page's strings are the sheet's strings: derived against the Powerwall 3 inputs.
    await expect(page.getByTestId('summary-fact-pv-strings')).toHaveText('5 (9 / 9 / 9 / 8 / 2)');
    // No PV inverter ⇒ no PV AC rating anywhere on the page (the header used to say "7.60 kW AC").
    await expect(page.locator('text=/\\d+\\.\\d\\d kW AC/'), 'a PV AC rating is shown on a design with no PV inverter').toHaveCount(0);
    // …and no "Recommended" inverter fleet to switch to (the sizing engine's Enphase proposal).
    await expect(page.getByRole('button', { name: 'Recommended', exact: true })).toHaveCount(0);

    // The drawing the page itself requests.
    const sld = page.waitForResponse(r => r.url().includes('/api/engineering/sld') && r.request().method() === 'POST',
      { timeout: 90_000 });
    await page.getByRole('button', { name: /Single-Line Diagram/ }).first().click();
    const res = await sld;
    expect(res.status()).toBe(200);
    const raw = await res.text();
    let svg = raw;
    try { svg = String(JSON.parse(raw).svg ?? raw); } catch { /* the route answered with the SVG itself */ }
    const text = svg.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    expect(text).toContain('37 × 440W');
    expect(text).toContain('37 MODULES · 16.28 kW DC');
    expect(text).toContain('NONE — DC COUPLED TO STORAGE');
    expect(text, 'a microinverter path was drawn on a job with no PV inverter').not.toMatch(/MICROINVERTERS/);
    expect(text).not.toMatch(/620W|22\.94 kW/);

    // …and after the page has autosaved and reloaded, the project's module record is still Design's.
    await page.reload();
    await expect(page.getByTestId('system-config-interview')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('interview-summary-design')).toContainText('37 modules · 440 W · 16.28 kW DC');
    const stored = await page.request.get(`/api/projects/${projectId}`, { headers: { 'X-Dev-Auth': 'bypass' } });
    const body = await stored.json() as { data?: { selectedPanel?: { id?: string } } };
    expect(body.data?.selectedPanel?.id, 'the module record was rewritten by an automatic writer').toBe('panel-fence-ps1');
  });

  test('a plain 200 A service is asked nothing about distribution, systems or backup', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);
    await Promise.all([graphWrite(page), page.getByTestId('answer-service-rating').selectOption('200')]);
    await page.reload();
    await expect(page.getByTestId('system-config-interview')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('interview-summary-service')).toContainText('200 A');
    await expect(page.getByTestId('interview-item-service.distribution')).toHaveCount(0);
    await expect(page.getByTestId('interview-item-behavior.systems')).toHaveCount(0);
    await expect(page.getByTestId('interview-item-behavior.backup')).toHaveCount(0);
    // The connection is still a question — never assumed to be a load-side breaker.
    await expect(page.getByTestId('interview-item-behavior.interconnection')).toHaveAttribute('data-state', 'needs-answer');
  });

  test('the utility\'s meter-collar ruling is a recorded fact: "not permitted" survives a reload and removes the option', async ({ page }) => {
    // Parity with the Service Topology tab (its "meter-collar interconnection is permitted" checkbox),
    // as a three-state utility fact: never assumed, and once refused never offered.
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);
    await Promise.all([graphWrite(page), page.getByTestId('answer-service-rating').selectOption('200')]);
    await expect(page.getByTestId('interview-item-behavior.utility.meter-collar')).toHaveAttribute('data-state', 'needs-verification');
    await expect(page.getByTestId('answer-interconnection-meter-collar')).toHaveCount(1);   // not established: offered, to verify

    await Promise.all([graphWrite(page), page.getByTestId('answer-utility-meter-collar').selectOption('not-permitted')]);
    await page.reload();
    await expect(page.getByTestId('system-config-interview')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('interview-answer-behavior.utility.meter-collar')).toHaveText('Not permitted');
    await expect(page.getByTestId('answer-interconnection-meter-collar'), 'a prohibited meter collar is still offered').toHaveCount(0);
  });

  test('400 A → two 200 A main panels → load-side breaker, each surviving a reload', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);

    await Promise.all([graphWrite(page), page.getByTestId('answer-service-rating').selectOption('400')]);
    await expect(page.getByTestId('interview-item-service.distribution')).toBeVisible();
    await Promise.all([graphWrite(page), page.getByTestId('answer-distribution-two-main-panels').click()]);
    await expect(page.locator('[data-testid^="interview-item-service.panel."]')).toHaveCount(2);

    await page.reload();
    await expect(page.getByTestId('system-config-interview')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('interview-summary-service')).toContainText('400 A');
    await expect(page.getByTestId('interview-summary-service')).toContainText('Two × 200 A main panels');
    // A 400 A service is never collapsed into a 400 A panel bus.
    await expect(page.getByTestId('summary-fact-distribution')).toHaveText('2 × 200 A main panels');

    await Promise.all([graphWrite(page), page.getByTestId('answer-interconnection-load-side-busbar').click()]);
    await page.reload();
    await expect(page.getByTestId('system-config-interview')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('interview-answer-behavior.interconnection')).toHaveText('Breaker in the panel (load side)');
  });
});
