const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Ensure admin sessionStorage (client-side) so AdminPage renders
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('admin_auth', 'admin_session_dummy');
        sessionStorage.setItem('admin_welcome', 'Administrator');
      } catch (e) {
        // ignore
      }
    });

    const url = process.env.BASE_URL || 'http://localhost:3002/admin';
    console.log('Opening', url);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'screenshot-admin.png', fullPage: true });
    console.log('Saved screenshot-admin.png');
    await browser.close();
  } catch (err) {
    console.error('Screenshot failed:', err);
    process.exit(1);
  }
})();
