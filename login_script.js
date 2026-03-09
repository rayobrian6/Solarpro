const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://solarpro-v31.vercel.app/auth/login', { waitUntil: 'networkidle', timeout: 30000 });
  
  // Fill email using name attribute
  await page.fill('input[name="email"]', 'raymond.obrian@yahoo.com');
  await page.fill('input[name="password"]', 'M0neymoves!');
  
  await page.click('button[type="submit"]');
  
  await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
  
  console.log('Current URL:', page.url());
  console.log('Title:', await page.title());
  
  await browser.close();
})();
