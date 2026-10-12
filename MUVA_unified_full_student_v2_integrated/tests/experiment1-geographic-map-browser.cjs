const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  const output = process.env.MUVA_SCREENSHOT_DIR || '/tmp/muva-geographic-map';
  mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    const tiles = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().includes('services.arcgisonline.com') && response.url().includes('/tile/')) tiles.push({ url: response.url(), status: response.status() });
    });
    const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5181';
    await page.goto(`${base}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', 'student');
      sessionStorage.setItem('muva-username', 'geographic-map-test');
      sessionStorage.setItem('muva-auth-token', 'mock-token-student');
    });
    await page.goto(`${base}/experiments/basic-flight`);
    await page.getByRole('button', { name: '开始新实验', exact: true }).click();
    await page.evaluate(async () => {
      const { useExperimentStore } = await import('/src/stores/experimentStore.ts');
      await useExperimentStore.getState().initialize();
      const { parts, questions } = await import('/src/domain/assessment/model.ts');
      const store = useExperimentStore.getState();
      parts.forEach(part => store.learnPart(part.id));
      await store.saveSectionQuiz({ quizId: 'system-cognition', title: '认知自测', step: 1,
        questions: questions.map(question => ({ id: question.id, correctAnswer: question.answer, explanation: question.explanation })),
        answers: Object.fromEntries(questions.map(question => [question.id, question.answer])),
      });
    });
    for (const sceneId of ['campus', 'city', 'mountain', 'airport']) {
      const firstTile = tiles.length;
      const home = await page.evaluate(async sceneId => {
        const { useExperimentStore } = await import('/src/stores/experimentStore.ts');
        const state = useExperimentStore.getState();
        const scene = state.scenes.find(item => item.id === sceneId);
        const drone = state.droneModels.find(item => item.id === 'iris-quadrotor-01');
        const home = { latitude: scene.latitude, longitude: scene.longitude, altitude: scene.altitude };
        useExperimentStore.setState({ selectedScene: scene, selectedSceneId: scene.id, selectedDrone: drone, selectedDroneId: drone.id,
          session: null, sessionId: null, simulationStarted: false, flightMapView: null, completedSteps: [1, 2, 3],
          configuration: { ...state.configuration, selectedSceneId: scene.id, selectedDroneId: drone.id, homePosition: home },
          experiment: { ...state.experiment, currentStep: 4 },
        });
        await useExperimentStore.getState().startSimulation();
        const started = useExperimentStore.getState();
        if (!started.simulationStarted) throw new Error(started.validationMessage);
        useExperimentStore.setState({ completedSteps: [1, 2, 3, 4, 5, 6], experiment: { ...started.experiment, currentStep: 7 } });
        return home;
      }, sceneId);
      const map = page.getByLabel('无人机实时地图与飞行轨迹');
      await page.waitForFunction(() => document.querySelector('[data-basemap-status="ready"]'), null, { timeout: 30000 });
      assert.equal(await map.locator('img').count(), 0);
      assert.match(await map.getAttribute('data-scene-id'), new RegExp(sceneId));
      const canvas = await map.locator('.maplibregl-canvas').boundingBox();
      const marker = await map.locator('[title="场景 Home · 步骤3所选起飞点"]').boundingBox();
      assert.ok(Math.abs(marker.x + marker.width / 2 - canvas.x - canvas.width / 2) < 2, `${sceneId} longitude center`);
      assert.ok(Math.abs(marker.y + marker.height / 2 - canvas.y - canvas.height / 2) < 2, `${sceneId} latitude center`);
      assert.ok(tiles.slice(firstTile).some(tile => tile.status === 200), `${sceneId} real geographic tiles`);
      const actualHome = { latitude: 34.125159, longitude: 108.828965, altitude: 412 };
      await page.evaluate(async home => {
        const { mockDroneSimulator } = await import('/src/services/mock/MockDroneSimulator.ts');
        const { useTelemetryStore } = await import('/src/stores/telemetryStore.ts');
        useTelemetryStore.getState().disconnect();
        useTelemetryStore.getState().clear();
        mockDroneSimulator.initialize(home);
        useTelemetryStore.getState().connect();
        await useTelemetryStore.getState().refreshMap();
      }, actualHome);
      await page.waitForTimeout(400);
      const rawPosition = await page.evaluate(async () => (await import('/src/stores/flightStore.ts')).useFlightStore.getState().status.position);
      assert.ok(Math.abs(rawPosition.latitude - actualHome.latitude) < 0.000001);
      const drone = await map.getByRole('img', { name: '无人机实时位置', exact: true }).boundingBox();
      assert.ok(Math.abs(drone.x + drone.width / 2 - canvas.x - canvas.width / 2) < 2, `${sceneId} drone at scene HOME`);
      assert.ok(Math.abs(drone.y + drone.height / 2 - canvas.y - canvas.height / 2) < 2, `${sceneId} drone at scene HOME`);
      for (const label of ['定位无人机', '定位配置 HOME', '显示完整飞行轨迹', '刷新场景定位']) {
        const button = page.getByRole('button', { name: label, exact: true });
        if (await button.count() === 0) continue;
        await button.click();
        await page.waitForTimeout(800);
        const center = await page.evaluate(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().flightMapView?.center);
        if (center) {
          assert.ok(Math.abs(center.latitude - home.latitude) < 0.000001, `${sceneId} ${label} does not jump to SITL HOME`);
          assert.ok(Math.abs(center.longitude - home.longitude) < 0.000001, `${sceneId} ${label} does not jump to SITL HOME`);
        }
      }
      assert.deepEqual(await page.evaluate(async () => (await import('/src/stores/flightStore.ts')).useFlightStore.getState().status.position), rawPosition);
      await page.evaluate(async () => (await import('/src/stores/routePlannerStore.ts')).useRoutePlannerStore.getState().open(10));
      await map.locator('.maplibregl-canvas').click({ position: { x: canvas.width / 2 + 60, y: canvas.height / 2 } });
      const waypoint = await page.evaluate(async () => (await import('/src/stores/routePlannerStore.ts')).useRoutePlannerStore.getState().waypoints[0]);
      assert.ok(waypoint && Math.abs(waypoint.latitude - actualHome.latitude) < 0.001 && Math.abs(waypoint.longitude - actualHome.longitude) < 0.001,
        `${sceneId} clicked waypoint is converted to actual SITL coordinates`);
      await page.evaluate(async () => (await import('/src/stores/routePlannerStore.ts')).useRoutePlannerStore.getState().cancel());
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${output}/${sceneId}.png` });
      console.log(`PASS ${sceneId}: real tiles, no scene photograph, center ${home.latitude}, ${home.longitude}`);
    }
    assert.deepEqual(errors, []);
    console.log(`Screenshots: ${output}. Mock runtime and teaching-step fixtures; real online map tiles; no API flight commands.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
