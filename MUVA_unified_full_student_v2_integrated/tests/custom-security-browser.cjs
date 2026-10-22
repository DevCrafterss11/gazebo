const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5181';
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 2048, height: 1152 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/login`);
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.setItem('muva-mock-user', 'signed-in');
        sessionStorage.setItem('muva-user-role', 'student');
        sessionStorage.setItem('muva-username', 'student01');
        sessionStorage.setItem('muva-display-name', '张三');
        sessionStorage.setItem('muva-auth-token', 'mock-token-student');
      });
      await page.goto(`${base}/experiments/custom-security`);
      await page.getByRole('combobox', { name: '运行模式' }).selectOption('assessment');
      for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('button', { name: '冻结配置并开始运行', exact: true }).click();
      await page.waitForFunction(async () => (await import('/src/stores/customSecurityStore.ts')).useCustomSecurityStore.getState().run?.status === 'completed', { timeout: 30000 });
      await page.getByRole('button', { name: '结算并打开报告', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.match(await dialog.textContent(), /\/100/);
      const downloadPromise = page.waitForEvent('download');
      await dialog.getByRole('button', { name: '导出 JSON', exact: true }).click();
      assert.match((await downloadPromise).suggestedFilename(), /^custom-security-.*\.json$/);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await page.getByRole('button', { name: '成绩 / 报告', exact: true }).click();
      await dialog.waitFor();
      assert.deepEqual(errors, []);
      console.log(`Custom security browser flow passed: ${viewport.width}x${viewport.height}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
