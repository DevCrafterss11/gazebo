const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  if (process.env.MUVA_RUN_SWARM_SITL_E2E !== '1') throw new Error('Set MUVA_RUN_SWARM_SITL_E2E=1; this test arms only the isolated experiment2 native SITL');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  const output = '/tmp/muva-swarm-sitl-e2e';
  mkdirSync(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(120_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => { if (response.url().includes('/api/swarm/') && response.status() >= 400) console.error(response.status(), await response.text()); });
  page.on('dialog', dialog => dialog.accept());
  const state = () => page.evaluate(async () => {
    const module = performance.getEntriesByType('resource').find(resource => new URL(resource.name).pathname === '/src/stores/swarmStore.ts');
    const { useSwarmStore } = await import(module.name);
    const current = useSwarmStore.getState();
    return { run: current.run, error: current.error, busy: current.busy };
  });
  const wait = async (predicate, label, timeout = 180_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const current = await state();
      if (current.error || current.run?.snapshot?.status === 'FAILED') throw new Error(`${label}: ${current.error || JSON.stringify(current.run.snapshot)}`);
      if (predicate(current)) return current;
      await page.waitForTimeout(500);
    }
    throw new Error(`Timed out ${label}: ${JSON.stringify(await state())}`);
  };
  try {
    const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5174';
    await page.goto(`${base}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', 'student');
      sessionStorage.setItem('muva-username', 'swarm-sitl-test');
      sessionStorage.setItem('muva-auth-token', 'mock-token-student');
    });
    await page.goto(`${base}/experiments/swarm`);
    await page.getByRole('button', { name: /开始新实验/ }).click();
    await page.evaluate(async () => {
      const module = performance.getEntriesByType('resource').find(resource => new URL(resource.name).pathname === '/src/stores/swarmStore.ts');
      const { useSwarmStore } = await import(module.name);
      useSwarmStore.getState().updateConfig({ count: 2, altitude: 10, speed: 7, spacing: 12, safety: 8 });
    });
    await page.getByRole('button', { name: '初始化机群', exact: true }).click();
    const initialized = await wait(current => !current.busy && current.run.snapshot?.drones.length === 2, 'actual flight controllers initialize');
    assert.equal(initialized.run.config.simulationMode, 'sitl');
    assert.deepEqual(initialized.run.snapshot.drones.map(drone => drone.sysId), [21, 22]);
    assert.ok(initialized.run.snapshot.drones.every(drone => drone.connected && !drone.armed && drone.gpsFixType >= 3));
    const isolated = await page.evaluate(async () => {
      const module = performance.getEntriesByType('resource').find(resource => new URL(resource.name).pathname === '/src/services/serviceRegistry.ts');
      const { services } = await import(module.name);
      return { basicFlight: services.dataSource, swarm: services.swarm.mode };
    });
    assert.deepEqual(isolated, { basicFlight: 'mock', swarm: 'sitl' });
    await page.screenshot({ path: `${output}/configured-flight-controllers.png`, fullPage: true });
    await page.getByRole('button', { name: /确认配置并进入下一步/ }).click();
    await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource');
      const { useSwarmStore } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/stores/swarmStore.ts').name);
      const { swarmFrame } = await import(resources.find(resource => new URL(resource.name).pathname === '/src/domain/swarmGeometry.ts').name);
      const store = useSwarmStore.getState();
      const { toGeo } = swarmFrame(store.run.config.sceneOrigin);
      store.setArea([[-65, -20], [-15, -20], [-15, 20], [-65, 20]].map(toGeo));
      store.setHome(toGeo([-48, -52]));
    });
    await page.getByRole('button', { name: '确认规划并进入下一步', exact: true }).click();
    await page.getByRole('button', { name: '生成航线', exact: true }).click();
    await page.getByRole('button', { name: '检查航线', exact: true }).click();
    await page.locator('[data-delivery-status="CHECKED"]').waitFor();
    await page.getByRole('button', { name: '下发航线', exact: true }).click();
    await wait(current => !current.busy && current.run.delivery?.status === 'UPLOADED', 'MAVLink mission upload');
    const delivered = await state();
    assert.equal(delivered.run.delivery.receipts.length, 2);
    assert.ok(delivered.run.delivery.receipts.every(receipt => receipt.message.includes('MISSION_ACK')));
    assert.equal(delivered.run.snapshot.elapsed, 0);
    await page.screenshot({ path: `${output}/uploaded-readback-missions.png`, fullPage: true });
    await page.getByRole('button', { name: '确认航线并进入下一步', exact: true }).click();
    await page.getByRole('button', { name: '执行自动检查', exact: true }).click();
    await wait(current => !current.busy && current.run.snapshot.status === 'READY', 'preflight ready');
    await page.getByRole('button', { name: /进入飞行控制/ }).click();
    await page.getByRole('button', { name: /集群起飞/ }).click();
    await wait(current => current.run.snapshot.status === 'HOLDING', 'actual armed takeoff');
    const airborne = await state();
    assert.ok(airborne.run.snapshot.drones.every(drone => drone.armed && drone.altitude >= 9.5));
    await page.getByRole('button', { name: /开始任务/ }).click();
    await wait(current => current.run.snapshot.coverage > 0 && current.run.snapshot.status === 'RUNNING', 'actual scanning');
    await page.getByRole('button', { name: /暂停任务/ }).click();
    await wait(current => current.run.snapshot.status === 'PAUSED', 'pause actual flight');
    await page.waitForTimeout(2000);
    const paused = await state();
    await page.screenshot({ path: `${output}/actual-flight-paused.png`, fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
    const restored = await wait(current => !current.busy && current.run.snapshot?.runtime?.connected && current.run.snapshot.status === 'PAUSED', 'reconnect live backend state');
    assert.equal(restored.run.snapshot.runtime.sessionId, paused.run.snapshot.runtime.sessionId);
    assert.ok(restored.run.snapshot.elapsed >= paused.run.snapshot.elapsed);
    await page.getByRole('button', { name: /继续任务/ }).click();
    const completed = await wait(current => !!current.run.result, 'scan, safe return and actual landing', 240_000);
    assert.equal(completed.run.result.status, 'COMPLETED');
    assert.equal(completed.run.result.coverage, 100);
    assert.ok(completed.run.snapshot.drones.every(drone => !drone.armed && drone.state === 'LANDED' && drone.altitude < .8 && drone.trajectory.length > 10));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/completed-actual-sitl.png`, fullPage: true });
    writeFileSync(`${output}/result.json`, JSON.stringify({ isolated, run: completed.run, errors }, null, 2));
    console.log('PASS isolated native SITL: configure2, parameters/telemetry, verified mission upload, takeoff, coverage, pause/reconnect/resume, return/land, actual result');
  } finally {
    try { writeFileSync(`${output}/last-state.json`, JSON.stringify(await state(), null, 2)); } catch {}
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
