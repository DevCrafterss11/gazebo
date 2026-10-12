const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  try {
    const tilePage = await browser.newPage({ viewport: { width: 256, height: 256 } });
    await tilePage.setContent('<html style="background:#203343"></html>');
    const tile = await tilePage.screenshot();
    await tilePage.close();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let failTiles = false;
    await page.route('https://services.arcgisonline.com/**/tile/**', route => failTiles ? route.abort() : route.fulfill({ contentType: 'image/png', body: tile }));
    const waitForState = async (predicate) => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (await page.evaluate(predicate)) return;
        await page.waitForTimeout(100);
      }
      throw new Error('Store condition timed out');
    };
    const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5181';
    await page.goto(`${base}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', 'student');
      sessionStorage.setItem('muva-username', 'student01');
      sessionStorage.setItem('muva-display-name', '张三');
      sessionStorage.setItem('muva-auth-token', 'mock-token-student');
    });
    await page.goto(`${base}/experiments/basic-flight`);
    await page.getByRole('button', { name: '开始新实验', exact: true }).click();
    await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().droneModels.length > 0);
    assert.equal(await page.evaluate(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().experiment.currentStep), 1);
    const configuredHome = await page.evaluate(async () => {
      const { useExperimentStore } = await import('/src/stores/experimentStore.ts');
      await useExperimentStore.getState().initialize();
      const { parts, questions } = await import('/src/domain/assessment/model.ts');
      const store = useExperimentStore.getState();
      parts.forEach(part => store.learnPart(part.id));
      await store.saveSectionQuiz({ quizId: 'system-cognition', title: '认知自测', step: 1,
        questions: questions.map(question => ({ id: question.id, correctAnswer: question.answer, explanation: question.explanation })),
        answers: Object.fromEntries(questions.map(question => [question.id, question.answer])),
      });
      const state = useExperimentStore.getState();
      const scene = state.scenes.find(item => item.id === 'city');
      const drone = state.droneModels.find(item => item.id === 'iris-quadrotor-01');
      const home = { latitude: scene.latitude + 0.001, longitude: scene.longitude - 0.001, altitude: scene.altitude };
      useExperimentStore.setState({ selectedScene: scene, selectedSceneId: scene.id, selectedDrone: drone, selectedDroneId: drone.id, completedSteps: [1, 2, 3], configuration: { ...state.configuration, selectedSceneId: scene.id, selectedDroneId: drone.id, homePosition: home }, experiment: { ...state.experiment, currentStep: 4 } });
      await useExperimentStore.getState().startSimulation();
      const started = useExperimentStore.getState();
      if (!started.simulationStarted) throw new Error(started.validationMessage);
      useExperimentStore.setState({ completedSteps: [1, 2, 3, 4, 5, 6], experiment: { ...started.experiment, currentStep: 7 } });
      await useExperimentStore.getState().saveProgress();
      return home;
    });
    const map = page.getByLabel('无人机实时地图与飞行轨迹');
    await map.locator('.maplibregl-canvas').waitFor();
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => document.querySelector('[data-basemap-status="ready"]'));
    assert.equal(await map.locator('img').count(), 0);
    assert.equal(await page.getByRole('button', { name: '重试在线底图', exact: true }).count(), 0);
    const mapBounds = await map.locator('.maplibregl-canvas').boundingBox();
    const homeBounds = await map.locator('[title="场景 Home · 步骤3所选起飞点"]').boundingBox();
    assert.ok(Math.abs(homeBounds.x + homeBounds.width / 2 - mapBounds.x - mapBounds.width / 2) < 2);
    assert.ok(Math.abs(homeBounds.y + homeBounds.height / 2 - mapBounds.y - mapBounds.height / 2) < 2);
    assert.equal(await map.locator('[class*="sceneInfo"]').count(), 0);
    assert.equal(await map.getByRole('img', { name: '无人机实时位置', exact: true }).locator('circle').count(), 4);
    assert.equal(await map.getByRole('button', { name: '无人机在视野外，点击定位', exact: true }).count(), 0);
    const actualHome = { latitude: 34.125159, longitude: 108.828965, altitude: 412 };
    await page.evaluate(async home => {
      const { mockDroneSimulator } = await import('/src/services/mock/MockDroneSimulator.ts');
      const { useTelemetryStore } = await import('/src/stores/telemetryStore.ts');
      useTelemetryStore.getState().disconnect();
      mockDroneSimulator.initialize(home);
      useTelemetryStore.getState().connect();
      await useTelemetryStore.getState().refreshMap();
    }, actualHome);
    const offscreenVehicle = map.getByRole('button', { name: '无人机在视野外，点击定位', exact: true });
    await page.waitForTimeout(400);
    assert.equal(await offscreenVehicle.count(), 0);
    const projectedDrone = await map.getByRole('img', { name: '无人机实时位置', exact: true }).boundingBox();
    assert.ok(Math.abs(projectedDrone.x + projectedDrone.width / 2 - mapBounds.x - mapBounds.width / 2) < 2);
    assert.ok(Math.abs(projectedDrone.y + projectedDrone.height / 2 - mapBounds.y - mapBounds.height / 2) < 2);
    const actualPosition = await page.evaluate(async () => (await import('/src/stores/flightStore.ts')).useFlightStore.getState().status.position);
    await page.getByRole('button', { name: '定位无人机', exact: true }).click();
    await page.waitForFunction(home => {
      const view = JSON.parse(localStorage.getItem('muva-experiment-1')).flightMapView;
      return Math.abs(view.center.latitude - home.latitude) < 0.000001 && Math.abs(view.center.longitude - home.longitude) < 0.000001;
    }, configuredHome);
    assert.deepEqual(await page.evaluate(async () => (await import('/src/stores/flightStore.ts')).useFlightStore.getState().status.position), actualPosition);
    await page.evaluate(async home => {
      const { mockDroneSimulator } = await import('/src/services/mock/MockDroneSimulator.ts');
      const { useTelemetryStore } = await import('/src/stores/telemetryStore.ts');
      useTelemetryStore.getState().disconnect();
      mockDroneSimulator.initialize(home);
      useTelemetryStore.getState().connect();
      await useTelemetryStore.getState().refreshMap();
    }, configuredHome);
    await page.getByRole('button', { name: '定位配置 HOME', exact: true }).click();
    await page.waitForFunction(home => {
      const view = JSON.parse(localStorage.getItem('muva-experiment-1')).flightMapView;
      return Math.abs(view.center.latitude - home.latitude) < 0.000001 && Math.abs(view.center.longitude - home.longitude) < 0.000001;
    }, configuredHome);
    const positionBeforeMismatch = await page.evaluate(async () => {
      const { useTelemetryStore } = await import('/src/stores/telemetryStore.ts');
      const { useFlightStore } = await import('/src/stores/flightStore.ts');
      const currentHome = useTelemetryStore.getState().mapHome;
      useTelemetryStore.setState({ mapHome: { ...currentHome, latitude: currentHome.latitude + 0.0001 } });
      return useFlightStore.getState().status.position;
    });
    assert.match(await map.getByRole('button', { name: '刷新场景定位', exact: true }).getAttribute('title'), /所选 HOME 为原点/);
    assert.equal(await map.locator('[title="步骤3配置的起飞点"]').evaluate(element => element.hidden), true);
    assert.deepEqual(await page.evaluate(async () => (await import('/src/stores/flightStore.ts')).useFlightStore.getState().status.position), positionBeforeMismatch);
    await page.evaluate(async () => {
      const store = (await import('/src/stores/telemetryStore.ts')).useTelemetryStore.getState();
      await store.refreshMap();
      store.disconnect();
    });
    assert.match(await map.getByRole('button', { name: '刷新场景定位', exact: true }).getAttribute('title'), /等待有效遥测/);
    assert.equal(await offscreenVehicle.count(), 0);
    assert.equal(await page.getByRole('button', { name: '定位无人机', exact: true }).isDisabled(), true);
    assert.equal(await map.locator('[title^="无人机"]').evaluate(element => element.hidden), true);
    await page.evaluate(async () => (await import('/src/stores/telemetryStore.ts')).useTelemetryStore.getState().connect());
    await page.waitForFunction(() => !document.querySelector('[aria-label="定位无人机"]').disabled);
    await page.getByRole('button', { name: '放大地图', exact: true }).click();
    await page.waitForTimeout(700);
    await page.mouse.move(mapBounds.x + mapBounds.width / 2, mapBounds.y + mapBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(mapBounds.x + mapBounds.width / 2 + 90, mapBounds.y + mapBounds.height / 2 + 45, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const camera = await page.evaluate(() => JSON.parse(localStorage.getItem('muva-experiment-1')).flightMapView);
    assert.ok(camera && camera.zoom > 18);
    assert.notEqual(camera.center.longitude, configuredHome.longitude);
    const navigate = path => page.evaluate(path => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
    await navigate('/experiments');
    await page.waitForTimeout(300);
    await navigate('/experiments/basic-flight');
    await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
    await map.locator('.maplibregl-canvas').waitFor();
    await page.waitForTimeout(900);
    const returned = await page.evaluate(async () => {
      const state = (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState();
      return { step: state.experiment.currentStep, view: state.flightMapView, sessionId: state.sessionId };
    });
    assert.equal(returned.step, 7);
    assert.ok(Math.abs(returned.view.zoom - camera.zoom) < 0.001);
    await page.reload();
    await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
    await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().experiment.currentStep === 4);
    const restoredBeforeStartup = await page.evaluate(async () => {
      const state = (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState();
      return { step: state.experiment.currentStep, view: state.flightMapView, sessionId: state.sessionId, simulationStarted: state.simulationStarted };
    });
    assert.equal(restoredBeforeStartup.step, 4);
    assert.equal(restoredBeforeStartup.sessionId, returned.sessionId);
    assert.equal(restoredBeforeStartup.simulationStarted, false);
    const resumeMap = async () => page.evaluate(async () => {
      const { useExperimentStore } = await import('/src/stores/experimentStore.ts');
      await useExperimentStore.getState().startSimulation();
      const state = useExperimentStore.getState();
      useExperimentStore.setState({ experiment: { ...state.experiment, currentStep: 7 } });
    });
    await resumeMap();
    await map.locator('.maplibregl-canvas').waitFor();
    await page.waitForTimeout(900);
    const restored = await page.evaluate(async () => {
      const state = (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState();
      return { step: state.experiment.currentStep, view: state.flightMapView, sessionId: state.sessionId, simulationStarted: state.simulationStarted };
    });
    assert.equal(restored.step, 7);
    assert.equal(restored.sessionId, returned.sessionId);
    assert.ok(Math.abs(restored.view.zoom - camera.zoom) < 0.001);
    assert.equal(restored.simulationStarted, true);
    await page.getByRole('button', { name: '定位配置 HOME', exact: true }).click();
    await page.waitForFunction(home => {
      const view = JSON.parse(localStorage.getItem('muva-experiment-1')).flightMapView;
      return Math.abs(view.center.latitude - home.latitude) < 0.000001 && Math.abs(view.center.longitude - home.longitude) < 0.000001;
    }, configuredHome);
    const relocated = await page.evaluate(() => JSON.parse(localStorage.getItem('muva-experiment-1')).flightMapView);
    assert.ok(Math.abs(relocated.center.latitude - configuredHome.latitude) < 0.000001);
    assert.ok(Math.abs(relocated.center.longitude - configuredHome.longitude) < 0.000001);
    failTiles = true;
    await page.reload();
    await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
    await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().experiment.currentStep === 4);
    await resumeMap();
    await page.getByRole('button', { name: '重试在线底图', exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await map.locator('img').count(), 0);
    assert.match(await map.innerText(), /不是地理底图/);
    failTiles = false;
    await page.getByRole('button', { name: '重试在线底图', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => document.querySelector('[data-basemap-status="ready"]'));
    assert.equal(await page.getByRole('button', { name: '重试在线底图', exact: true }).count(), 0);
    await page.evaluate(async () => {
      const { useExperimentStore } = await import('/src/stores/experimentStore.ts');
      const state = useExperimentStore.getState();
      useExperimentStore.setState({ experiment: { ...state.experiment, currentStep: 8 } });
    });
    await page.getByRole('button', { name: '重新开始实验一', exact: true }).click();
    await page.getByRole('button', { name: '确认重置', exact: true }).click();
    await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().experiment.currentStep === 1);
    const restarted = await page.evaluate(async () => {
      const state = (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState();
      const telemetry = (await import('/src/stores/telemetryStore.ts')).useTelemetryStore.getState();
      return { session: state.sessionId, view: state.flightMapView, track: telemetry.flightPath };
    });
    assert.equal(restarted.session, null);
    assert.equal(restarted.view, null);
    assert.deepEqual(restarted.track, []);
    assert.deepEqual(errors, []);
    console.log('PASS: first visit step1; edited city HOME center; actual campus HOME mapped to selected HOME without raw telemetry changes; no phantom vehicle on disconnect; pan/zoom persistence; route return; refresh; HOME locate; tile fallback/retry; existing step8 confirmed restart; no pageerrors. Teaching steps were injected as a targeted map fixture; live tile availability not tested.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
