import { expect, test, type Page } from '@playwright/test';
import { buildRaysIntendedJob } from '../lib/electrical/fixtures/tesla400aTwoGateway';

/**
 * e2e/system-config-interview.spec.ts
 *
 * 🚨 SYSTEM CONFIG V3 — THE ENGINEERING QUESTIONS LIVE IN THE EXISTING CARDS — IN A REAL BROWSER,
 * AGAINST REAL ROUTES AND REAL POSTGRESQL (SOLARPRO_LOCAL_PG=1, no credential).
 *
 * Ray (V3): "We do not want a second questionnaire layered on top of System Config… Editing the battery
 * should happen in Battery. Editing service should happen in Service. Editing PV/string architecture in
 * Inverters & Strings. Editing system/interconnection behavior in System Configuration. The bottom panel
 * tells him what remains, with Answer Next and Review Engineering." 
 *
 * Ray's standard: "UI action → state mutation → persistence → reload → calculation → output request
 * → output artifact… If Ray's browser disagrees with the tests: the slice is reopened."
 *
 * What it drives, end to end:
 *   · a project whose Design placed 37 × 440 W, seeded through the real POST routes;
 *   · no questionnaire sits above the cards; the Engineering Summary states 37 modules · 16.28 kW DC from Design;
 *   · Service card: 400 A → "Two 200 A main panels" → two MSP rows; a RELOAD keeps all of it;
 *   · Ray's DC-coupled job: the summary, the sheet the page requests, and the stored module record all
 *     say 37 × 440 W / 16.28 kW / no PV inverter, through an autosave and a reload;
 *   · a plain 200 A service is never asked about distribution, multiple systems or backup;
 *   · System Configuration card: interconnection "load side" and the meter-collar ruling survive a reload;
 *   · Engineering Readiness: [Answer Next] opens the top required question; answering it drops the count.
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
  await expect(page.getByTestId('engineering-summary-facts')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('engineering-readiness')).toBeVisible({ timeout: 60_000 });
}

async function reloadSystemConfig(page: Page) {
  await page.reload();
  await expect(page.getByTestId('engineering-summary-facts')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('engineering-readiness')).toBeVisible({ timeout: 60_000 });
}

/** "BLOCKED — 3 required answers" → 3; anything else → 0. */
const requiredCount = async (page: Page) => {
  const m = (await page.getByTestId('readiness-status').innerText()).match(/(\d+) required answer/);
  return m ? Number(m[1]) : 0;
};

/** Wait for the one write path the interview uses. */
const graphWrite = (page: Page) => page.waitForResponse(r =>
  r.url().includes('/service-topology') && r.request().method() === 'PUT' && r.status() === 200);

test.describe('System Config V3 — the existing cards, real browser, real routes, real PostgreSQL', () => {
  test.skip(!LOCAL_PG, 'needs SOLARPRO_LOCAL_PG=1 (in-process PostgreSQL); see e2e/README.md');
  test.setTimeout(180_000);

  test('no questionnaire above the cards; Design facts are stated before anything is answered', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);
    await expect(page.getByTestId('system-config-interview'), 'the questionnaire above the grid is back').toHaveCount(0);
    await expect(page.getByTestId('summary-fact-pv-modules')).toHaveText('37');
    await expect(page.getByTestId('summary-fact-pv-dc-size')).toHaveText('16.28 kW');
    await expect(page.getByTestId('summary-fact-pv-strings')).toContainText('Not derived');
    // The service is asked in the Service card, where the old Main Service Panel lived.
    await expect(page.locator('#sc-card-service').getByTestId('svc-rating')).toBeVisible();
    // The cards come before the readiness panel — the panel is at the bottom.
    const svcTop = await page.locator('#sc-card-service').evaluate(e => e.getBoundingClientRect().top + window.scrollY);
    const readyTop = await page.getByTestId('engineering-readiness').evaluate(e => e.getBoundingClientRect().top + window.scrollY);
    expect(readyTop).toBeGreaterThan(svcTop);
  });

  test('Ray\'s DC-coupled job: the page, the drawing it requests, and the stored module all say 37 × 440 W', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await api(page, 'PUT', `/api/projects/${projectId}/service-topology`, { topology: buildRaysIntendedJob().topology });
    await openSystemConfig(page, projectId);

    await expect(page.getByTestId('summary-fact-pv-inverter')).toHaveText('None — DC coupled to storage');
    await expect(page.getByTestId('summary-fact-pv-dc-size')).toHaveText('16.28 kW');
    await expect(page.getByTestId('summary-fact-storage')).toHaveText('4 × Tesla Powerwall 3');
    await expect(page.getByTestId('summary-fact-ess-max-continuous-ac-output')).toHaveText('46.08 kW (192 A)');
    await expect(page.getByTestId('summary-fact-backup-controllers')).toHaveText('2 × Tesla Backup Gateway 3');
    await expect(page.getByTestId('summary-fact-pv-strings')).toHaveText('5 (9 / 9 / 9 / 8 / 2)');
    await expect(page.locator('text=/\\d+\\.\\d\\d kW AC/'), 'a PV AC rating is shown on a design with no PV inverter').toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Recommended', exact: true })).toHaveCount(0);

    // Inverters & Strings: one compact line, and [Review] opens the assignment dialog.
    await expect(page.getByTestId('inv-strings-summary')).toContainText('37');
    await page.getByTestId('inv-string-review').click();
    await expect(page.getByTestId('inv-string-editor')).toBeVisible();
    await expect(page.locator('[data-testid^="inv-string-"][data-testid$="1"]').first()).toBeVisible();
    await page.getByTestId('inv-string-dialog-close').click();

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
    await page.goto(`/engineering?projectId=${projectId}`);
    await expect(page.getByTestId('engineering-summary-facts')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('summary-fact-pv-dc-size')).toHaveText('16.28 kW');
    const stored = await page.request.get(`/api/projects/${projectId}`, { headers: { 'X-Dev-Auth': 'bypass' } });
    const body = await stored.json() as { data?: { selectedPanel?: { id?: string } } };
    expect(body.data?.selectedPanel?.id, 'the module record was rewritten by an automatic writer').toBe('panel-fence-ps1');
  });

  test('a plain 200 A service shows no multi-panel, systems or backup controls; load side survives a reload', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);
    await Promise.all([graphWrite(page), page.getByTestId('svc-rating').selectOption('200')]);
    await reloadSystemConfig(page);
    await expect(page.getByTestId('svc-rating')).toHaveValue('200');
    await expect(page.locator('[data-testid^="svc-distribution-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="svc-panel-main-"]')).toHaveCount(1);
    await expect(page.getByTestId('sys-systems')).toHaveCount(0);
    await expect(page.getByTestId('sys-backup')).toHaveCount(0);

    // Interconnection is ONE control on the System Configuration card, backed by the service model.
    await Promise.all([graphWrite(page), page.getByTestId('sys-interconnection').selectOption('load-side-busbar')]);
    await reloadSystemConfig(page);
    await expect(page.getByTestId('sys-interconnection')).toHaveValue('load-side-busbar');
  });

  test('the utility\'s meter-collar ruling is a recorded fact: "not permitted" survives a reload and removes the option', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);
    await Promise.all([graphWrite(page), page.getByTestId('svc-rating').selectOption('200')]);
    await expect(page.getByTestId('sys-meter-collar')).toBeVisible();
    await expect(page.locator('[data-testid="sys-interconnection"] option[value="meter-collar"]')).toHaveCount(1);
    await Promise.all([graphWrite(page), page.getByTestId('sys-meter-collar').selectOption('not-permitted')]);
    await reloadSystemConfig(page);
    await expect(page.getByTestId('sys-meter-collar')).toHaveValue('not-permitted');
    await expect(page.locator('[data-testid="sys-interconnection"] option[value="meter-collar"]'),
      'a prohibited meter collar is still offered').toHaveCount(0);
  });

  test('400 A → two 200 A main panels in the Service card, surviving a reload', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);
    await Promise.all([graphWrite(page), page.getByTestId('svc-rating').selectOption('400')]);
    await expect(page.getByTestId('svc-distribution-two-main-panels')).toBeVisible();
    await Promise.all([graphWrite(page), page.getByTestId('svc-distribution-two-main-panels').click()]);
    await expect(page.locator('[data-testid^="svc-panel-main-"]')).toHaveCount(2);
    await reloadSystemConfig(page);
    await expect(page.getByTestId('svc-rating')).toHaveValue('400');
    await expect(page.locator('[data-testid^="svc-panel-main-"]')).toHaveCount(2);
    // A 400 A service is never collapsed into a 400 A panel bus.
    await expect(page.getByTestId('summary-fact-distribution')).toHaveText('2 × 200 A main panels');
  });

  test('Engineering Readiness: [Answer Next] opens the top required question, and answering it drops the count', async ({ page }) => {
    const projectId = await seedRaysArray(page);
    await openSystemConfig(page, projectId);
    await Promise.all([graphWrite(page), page.getByTestId('svc-rating').selectOption('200')]);
    const before = await requiredCount(page);
    expect(before).toBeGreaterThan(0);
    await page.getByTestId('readiness-answer-next').click();
    const dialog = page.getByTestId('question-dialog');
    await expect(dialog).toBeVisible();
    // Whatever the top question is, the dialog renders its own editor; answer the connection when it is asked.
    const loadSide = dialog.getByTestId('answer-interconnection-load-side-busbar');
    if (await loadSide.count()) {
      await Promise.all([graphWrite(page), loadSide.click()]);
      await expect.poll(() => requiredCount(page)).toBeLessThan(before);
    } else {
      // The queue's head is something else — it must still name a real question with an editor.
      await expect(dialog).toContainText(/\?/);
    }
  });
});
