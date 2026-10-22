const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5181';
  try {
    for (const viewport of [{ width: 2048, height: 1152 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/login`);
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.setItem('muva-mock-user', 'signed-in');
        sessionStorage.setItem('muva-user-role', 'student');
        sessionStorage.setItem('muva-username', 'student01');
        sessionStorage.setItem('muva-display-name', '张三');
        sessionStorage.setItem('muva-auth-token', 'mock-token-student');
      });
      await page.goto(`${base}/experiments/security`);
      await page.getByRole('button', { name: '创建独立运行', exact: true }).click();
      await page.getByRole('button', { name: '开始正常遥测对照', exact: true }).click();
      await page.waitForFunction(async () => (await import('/src/stores/securityExperimentStore.ts')).useSecurityExperimentStore.getState().run?.telemetry !== null);
      await page.getByRole('button', { name: '进入观察阶段', exact: true }).click();
      await page.waitForFunction(async () => (await import('/src/stores/securityExperimentStore.ts')).useSecurityExperimentStore.getState().run?.evidence.length > 0);
      await page.getByRole('combobox', { name: '学生判断', exact: true }).selectOption('replay');
      await page.getByRole('checkbox').first().check();
      await page.getByRole('button', { name: '提交判断与证据', exact: true }).click();
      await page.getByRole('button', { name: '隔离异常数据', exact: true }).click();
      await page.getByRole('button', { name: '停止注入并恢复订阅', exact: true }).click();
      const reflection = page.getByPlaceholder('记录判断依据、处置过程和仍不确定的指标……');
      await reflection.fill('对比序列号和采集时间发现重放数据，隔离异常数据并验证连续新鲜遥测恢复。');
      assert.equal(await reflection.evaluate(element => {
        const container = element.closest('main');
        const bounds = container.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return container.clientHeight <= window.innerHeight && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      }), true, 'Reflection must be reachable inside the bounded scroll container');
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await page.getByRole('button', { name: '验证恢复状态', exact: true }).click();
        if (await page.getByRole('button', { name: '结束实验并结算', exact: true }).count()) break;
        await page.waitForTimeout(1000);
      }
      await page.getByRole('button', { name: '结束实验并结算', exact: true }).click();
      const report = page.getByRole('region', { name: '实验成绩报告', exact: true });
      await report.waitFor();
      const assertReportVisible = async () => {
        assert.equal(await report.evaluate(element => {
          const container = element.closest('main');
          const bounds = container.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          return rect.top >= bounds.top && rect.bottom <= bounds.bottom && document.activeElement === element;
        }), true, `Report must automatically be visible and focused at ${viewport.width}x${viewport.height}`);
      };
      await assertReportVisible();
      assert.match(await report.textContent(), /100\/100/);
      await report.getByRole('button', { name: '导出 JSON 报告', exact: true }).waitFor();
      const downloadPromise = page.waitForEvent('download');
      await report.getByRole('button', { name: '导出 JSON 报告', exact: true }).click();
      assert.match((await downloadPromise).suggestedFilename(), /^security-.*\.json$/);
      await page.getByRole('button', { name: '查看成绩 · 100 分', exact: true }).click();
      await assertReportVisible();
      if (process.env.MUVA_SCREENSHOT_DIR) {
        await page.screenshot({ path: `${process.env.MUVA_SCREENSHOT_DIR}/security-report-${viewport.width}x${viewport.height}.png` });
      }
      await page.getByRole('button', { name: '开始下一次运行', exact: true }).click();
      await page.getByRole('button', { name: '创建独立运行', exact: true }).click();
      await page.getByRole('button', { name: '中止并保存', exact: true }).click();
      await report.waitFor();
      await assertReportVisible();
      assert.deepEqual(errors, []);
      console.log(`Security report layout, completion, export, shortcut and abort passed: ${viewport.width}x${viewport.height}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
