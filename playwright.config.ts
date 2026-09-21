import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  use: {
    baseURL,
    // 🚨 THE DEV BYPASS NEEDS A HEADER, NOT JUST AN ENV VAR.
    // `getDevSessionUser` AND-gates `DEV_AUTH_BYPASS=true` with an explicit
    // `X-Dev-Auth: bypass` header, deliberately, so a signed-in user is never
    // silently replaced by the dev user. Without it every /api/projects call
    // 401s and the page redirects to /auth/login mid-spec — which is what left
    // a dead component's `window.__solarE2E` on the page for specs to read.
    extraHTTPHeaders: { 'X-Dev-Auth': 'bypass' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: 'chromium-software-webgl',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--disable-dev-shm-usage',
            '--no-sandbox',
          ],
        },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 npm run dev -- -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
