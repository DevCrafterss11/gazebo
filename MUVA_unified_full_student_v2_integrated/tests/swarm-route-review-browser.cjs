const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const output = process.env.MUVA_SCREENSHOT_DIR || '/tmp/muva-swarm-route-review';
    mkdirSync(output, { recursive: true });
    const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5181';
    await page.goto(`${base}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', 'student');
      sessionStorage.setItem('muva-username', 'swarm-route-review');
      sessionStorage.setItem('muva-auth-token', 'mock-token-student');
    });
    await page.goto(`${base}/experiments/swarm`);
    await page.getByRole('button', { name: /开始新实验/ }).click();
    await page.getByRole('button', { name: /确认配置并进入下一步/ }).click();
    await page.getByRole('button', { name: '初始化机群', exact: true }).click();
    await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource');
      const { useSwarmStore } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/stores/swarmStore.ts').name);
      const { swarmFrame } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/domain/swarmGeometry.ts').name);
      const store = useSwarmStore.getState();
      store.updateConfig({ altitude: 20, speed: 10, spacing: 10 });
      store.initialize();
      const { toGeo } = swarmFrame(useSwarmStore.getState().run.config.sceneOrigin);
      store.setArea([[-185, 0], [-90, -10], [-64, -110], [-175, -110]].map(toGeo));
      store.setHome(toGeo([-37.8, -30.5]));
      store.addNoFlyZone([[-26, -86], [0, -86], [0, -108], [-26, -108]].map(toGeo));
    });
    await page.getByRole('button', { name: '确认规划并进入下一步', exact: true }).click();
    await page.getByRole('button', { name: '生成航线', exact: true }).click();
    const direct = await page.evaluate(() => {
      const run = JSON.parse(localStorage.getItem('muva-swarm-draft-v1'));
      return run.missions.map(mission => ({ id: mission.droneId, entry: mission.entryPath.length, returning: mission.returnPath.length,
        scanning: mission.coverageSegments.length, waypoints: mission.waypoints.length }));
    });
    assert.equal(direct.length, 3);
    direct.forEach(mission => {
      assert.equal(mission.entry, 2);
      assert.equal(mission.returning, 2);
      assert.equal(mission.waypoints, mission.scanning * 2);
    });
    await page.getByRole('button', { name: '检查航线', exact: true }).click();
    await page.locator('[data-delivery-status="CHECKED"]').waitFor();
    const map = page.getByLabel('机群区域规划交互地图', { exact: true });
    assert.ok(await map.getByLabel('全部编号', { exact: true }).isChecked());
    for (const droneId of ['UAV-01', 'UAV-02', 'UAV-03']) {
      assert.ok(await map.locator(`[data-waypoint-drone="${droneId}"]`).count() > 2, '默认显示每条航线的编号');
    }
    await map.getByLabel('全部编号', { exact: true }).uncheck();
    assert.equal(await map.locator('[data-waypoint-drone="UAV-02"]').count(), 0);
    await map.getByLabel('全部编号', { exact: true }).check();
    await map.getByRole('button', { name: '仅所选航线', exact: true }).click();
    assert.equal(await map.locator('[data-waypoint-drone="UAV-02"]').count(), 0);
    await map.getByRole('button', { name: '全部完整航线', exact: true }).click();
    await map.getByRole('button', { name: '回到任务区域', exact: true }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${output}/clear-direct-transfers.png`, fullPage: true });

    await page.getByRole('navigation', { name: '实验步骤' }).getByRole('button', { name: /区域规划/ }).click();
    await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource');
      const { useSwarmStore } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/stores/swarmStore.ts').name);
      const { swarmFrame } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/domain/swarmGeometry.ts').name);
      const { toGeo } = swarmFrame(useSwarmStore.getState().run.config.sceneOrigin);
      useSwarmStore.getState().addNoFlyZone([[-72, -80], [-56, -80], [-56, -66], [-72, -66]].map(toGeo));
    });
    await page.getByRole('button', { name: '确认规划并进入下一步', exact: true }).click();
    await page.getByRole('button', { name: '生成航线', exact: true }).click();
    const detoured = await page.evaluate(() => JSON.parse(localStorage.getItem('muva-swarm-draft-v1')).missions);
    assert.equal(detoured.length, 3);
    assert.ok(detoured.some(mission => mission.entryPath.length > 2 || mission.returnPath.length > 2));
    await page.getByRole('button', { name: '检查航线', exact: true }).click();
    await page.locator('[data-delivery-status="CHECKED"]').waitFor();
    await page.getByRole('button', { name: '下发航线', exact: true }).click();
    await page.locator('[data-delivery-status="UPLOADED"]').waitFor();
    const uploaded = await page.evaluate(() => JSON.parse(localStorage.getItem('muva-swarm-draft-v1')));
    assert.equal(uploaded.delivery.receipts.length, 3);
    assert.ok(uploaded.delivery.receipts.every(receipt => receipt.status === 'ACCEPTED'));
    assert.equal(uploaded.snapshot.elapsed, 0);
    assert.equal(uploaded.snapshot.status, 'PLANNED');
    await page.screenshot({ path: `${output}/blocked-safe-detours.png`, fullPage: true });

    await page.getByRole('navigation', { name: '实验步骤' }).getByRole('button', { name: /区域规划/ }).click();
    await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource');
      const { useSwarmStore } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/stores/swarmStore.ts').name);
      const { swarmFrame } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/domain/swarmGeometry.ts').name);
      const store = useSwarmStore.getState();
      const { toGeo } = swarmFrame(store.run.config.sceneOrigin);
      const angle = Math.PI / 6;
      store.clearPlanning();
      store.initialize();
      store.setArea([[-185, 0], [-90, -10], [-64, -110], [-175, -110]].map(([east, north]) =>
        toGeo([east * Math.cos(angle) - north * Math.sin(angle), east * Math.sin(angle) + north * Math.cos(angle)])));
      store.setHome(toGeo([-37.8, -30.5]));
    });
    await page.getByRole('button', { name: '确认规划并进入下一步', exact: true }).click();
    await page.getByRole('button', { name: '生成航线', exact: true }).click();
    const rotated = await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource');
      const { useSwarmStore } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/stores/swarmStore.ts').name);
      const { minimumCoverageRectangle } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/domain/swarmCoverage.ts').name);
      const { swarmFrame } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/domain/swarmGeometry.ts').name);
      const { run, error } = useSwarmStore.getState();
      const rectangle = minimumCoverageRectangle(run.area, run.config.sceneOrigin);
      const { toLocal } = swarmFrame(run.config.sceneOrigin);
      return { error, count: run.missions.length, angle: rectangle.angle, area: rectangle.area,
        aligned: run.missions.every(mission => mission.coverageSegments.every(([first, second]) =>
          Math.abs(rectangle.align(toLocal(first))[1] - rectangle.align(toLocal(second))[1]) < .001)) };
    });
    assert.equal(rotated.error, null);
    assert.equal(rotated.count, 3);
    assert.equal(rotated.aligned, true);
    assert.ok(Math.abs(rotated.angle - Math.PI / 6) < .001);
    assert.ok(Math.abs(rotated.area - 13310) < .01);
    await page.getByRole('button', { name: '检查航线', exact: true }).click();
    await page.locator('[data-delivery-status="CHECKED"]').waitFor();
    await map.getByRole('button', { name: '回到任务区域', exact: true }).click();
    await page.waitForTimeout(800);
    for (const droneId of ['UAV-01', 'UAV-02', 'UAV-03']) assert.ok(await map.locator(`[data-waypoint-drone="${droneId}"]`).count() > 2);
    await page.screenshot({ path: `${output}/rotated-minimum-rectangle.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: minimum rectangle snake coverage, rotated footprint, default numbering for all 3 UAVs, direct entry/return, safe detours and complete-path upload receipts');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
