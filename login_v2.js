const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  
  await page.fill('input[name="email"]', 'raymond.obrian@yahoo.com');
  await page.fill('input[name="password"]', 'M0neymoves!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  console.log('Current URL:', page.url());
  await browser.close();
})();
