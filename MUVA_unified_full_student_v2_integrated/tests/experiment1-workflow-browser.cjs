const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

const output = process.env.MUVA_AUDIT_OUTPUT || '/tmp/muva-experiment1-audit';
mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const report = [];
  try {
    for (const mode of ['mock', 'api']) {
      const context = await browser.newContext({ viewport: { width: 2048, height: 1152 } });
      const page = await context.newPage();
      const errors = [];
      const failures = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400 && response.url().includes('/api/')) failures.push(`${response.status()} ${response.url()}`);
      });
      const base = mode === 'mock' ? process.env.MUVA_MOCK_URL || 'http://127.0.0.1:5181' : process.env.MUVA_API_URL || 'http://127.0.0.1:5173';
      const screenshot = async (name) => page.screenshot({ path: join(output, `${mode}-${name}.png`), fullPage: true });
      const waitForState = async (predicate, argument, options = {}) => {
        const deadline = Date.now() + (options.timeout || 30000);
        while (Date.now() < deadline) {
          if (await page.evaluate(predicate, argument)) return;
          await page.waitForTimeout(100);
        }
        throw new Error(`Store predicate timed out: ${predicate}`);
      };
      const next = () => page.getByRole('button', { name: /^下一步|^进入基础飞行训练/ });
      const waitStep = (step) => waitForState(async (expected) => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().experiment.currentStep === expected, step);
      const waitTask = (index) => waitForState(async (expected) => (await import('/src/stores/trainingStore.ts')).useTrainingStore.getState().activeTaskIndex >= expected, index, { timeout: 60000 });
      await page.goto(`${base}/login`);
      await page.evaluate((username) => {
        localStorage.clear();
        sessionStorage.setItem('muva-mock-user', 'signed-in');
        sessionStorage.setItem('muva-user-role', 'student');
        sessionStorage.setItem('muva-username', username);
        sessionStorage.setItem('muva-display-name', '流程验收');
        sessionStorage.setItem('muva-auth-token', 'mock-token-student');
      }, `audit-${mode}-${Date.now()}`);
      await page.goto(`${base}/experiments/basic-flight`);
      await page.getByRole('button', { name: '开始新实验', exact: true }).click();
      await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().selectedDrone?.id === 'iris-quadrotor-01');
      assert.equal(await page.evaluate(async () => (await import('/src/services/serviceRegistry.ts')).services.dataSource), mode);
      assert.equal(await next().isDisabled(), true);
      await screenshot('01-cognition');
      const model = await page.evaluate(async () => {
        const { parts, questions } = await import('/src/domain/assessment/model.ts');
        return { parts, questions };
      });
      for (const part of model.parts) await page.getByRole('button', { name: new RegExp(`${part.name}$`) }).click();
      assert.equal(await next().isDisabled(), true);
      for (const [index, question] of model.questions.entries()) await page.locator('select').nth(index).selectOption(question.answer);
      assert.equal(await next().isDisabled(), true);
      await page.getByRole('button', { name: '提交自测', exact: true }).click();
      await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().assessment?.sectionQuizzes.length === 1);
      assert.equal(await next().isDisabled(), false);
      await next().click();
      await waitStep(2);
      await page.evaluate(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().updateFlightParameter('takeoffAltitude', 200));
      assert.equal(await next().isDisabled(), true);
      await page.evaluate(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().updateFlightParameter('takeoffAltitude', 10));
      await screenshot('02-parameters');
      await next().click();
      await waitStep(3);
      assert.equal(await next().isDisabled(), true);
      for (const [sceneId, sceneName] of [['campus', '校园训练场'], ['city', '城市训练场'], ['mountain', '山地训练场'], ['airport', '机场训练场']]) {
        await page.getByRole('radio', { name: new RegExp(sceneName) }).click();
        await page.mouse.move(20, 20);
        assert.equal(await page.locator('[data-scene-id]').getAttribute('data-scene-id'), sceneId);
        assert.match(await page.locator('[data-scene-id] img').getAttribute('src'), new RegExp(`${sceneId}-satellite.jpg$`));
        await screenshot(`03-scene-${sceneId}`);
      }
      await page.getByRole('radio', { name: /城市训练场/ }).click();
      await next().click();
      await waitStep(4);
      await screenshot('04-environment-before');
      await page.getByRole('button', { name: /创建.*初始化实验|创建实验并启动仿真环境/ }).click();
      await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().simulationStarted, undefined, { timeout: 30000 });
      await screenshot('04-environment-ready');
      await next().click();
      await waitStep(5);
      await page.getByRole('button', { name: '开始健康检查', exact: true }).click();
      await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().configuration.sensors.some((sensor) => sensor.status === 'CHECKING'));
      await screenshot('05-sensors-checking');
      await waitForState(async () => !(await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().isCheckingSensors);
      const sensorStatus = await page.evaluate(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().systemCheckStatus);
      assert.equal(sensorStatus, 'PASSED');
      assert.equal(await next().isDisabled(), true);
      for (const [questionId, answerId] of [['gps', 0], ['ekf', 1], ['heartbeat', 2]]) await page.locator(`input[name="diagnosis-${questionId}"]`).nth(answerId).check();
      await page.getByRole('button', { name: '提交自测 · 查看解析', exact: true }).click();
      await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().assessment?.sectionQuizzes.length === 2);
      await screenshot('05-diagnostics-complete');
      await next().click();
      await waitStep(6);
      await page.getByRole('button', { name: '执行全部检查', exact: true }).click();
      await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().preflightChecklist.some((item) => item.status === 'CHECKING'));
      await screenshot('06-preflight-checking');
      await waitForState(async () => !(await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().isCheckingPreflight);
      assert.equal(await next().isDisabled(), false);
      await screenshot('06-preflight-complete');
      await next().click();
      await waitStep(7);
      const map = page.getByLabel('无人机实时地图与飞行轨迹');
      await map.locator('.maplibregl-canvas').waitFor();
      await page.waitForTimeout(1500);
      assert.equal(await map.locator('img').count(), 0);
      assert.match(await map.getAttribute('data-scene-id'), /city/);
      assert.equal(await page.getByRole('button', { name: '重试在线底图', exact: true }).count(), 0);
      const buttons = ['ARM', 'DISARM', 'TAKEOFF', 'LAND', 'RTL'];
      for (const size of [{ width: 2048, height: 1152 }, { width: 1600, height: 1000 }]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(200);
        for (const label of buttons) {
          const button = page.getByRole('button', { name: new RegExp(`^${label}`) });
          const bounds = await button.boundingBox();
          const panel = await button.evaluate((element) => {
            const rectangle = element.closest('section').getBoundingClientRect();
            return { top: rectangle.top, bottom: rectangle.bottom };
          });
          assert.ok(bounds.height >= 16 && bounds.y >= panel.top && bounds.y + bounds.height <= panel.bottom + 1, `${mode} ${label} clipped at ${size.width}`);
        }
        await screenshot(`07-flight-${size.width}`);
      }
      assert.equal(await page.getByRole('button', { name: /^TAKEOFF/ }).isDisabled(), true);
      if (mode === 'mock') {
        await page.getByRole('button', { name: /^ARM/ }).click();
        await waitTask(1);
        await page.getByRole('button', { name: /^TAKEOFF/ }).click();
        await waitTask(3);
        await page.getByRole('button', { name: '上升', exact: true }).click();
        await waitTask(4);
        await page.getByRole('button', { name: '下降', exact: true }).click();
        await waitForState(async () => (await import('/src/stores/flightStore.ts')).useFlightStore.getState().status.position.altitude <= 10.1);
        await page.getByRole('button', { name: '下降', exact: true }).click();
        await waitTask(5);
        await page.getByRole('button', { name: '前进', exact: true }).click();
        await waitForState(async () => (await import('/src/stores/flightStore.ts')).useFlightStore.getState().status.north >= 9.9);
        await page.getByRole('button', { name: '前进', exact: true }).click();
        await waitTask(6);
        for (let index = 0; index < 3; index += 1) {
          await page.getByRole('button', { name: '右移', exact: true }).click();
          await waitForState(async (east) => (await import('/src/stores/flightStore.ts')).useFlightStore.getState().status.east >= east, (index + 1) * 5 - 0.1);
        }
        await waitTask(7);
        for (let index = 0; index < 6; index += 1) {
          await page.getByRole('button', { name: '右转', exact: true }).click();
          await page.waitForTimeout(450);
        }
        await waitTask(8);
        await screenshot('07-training-complete-before-rtl');
        await page.getByRole('button', { name: /^RTL/ }).click();
        await waitTask(9);
        await page.getByRole('button', { name: /^LAND/ }).click();
        await page.getByRole('button', { name: '确认降落', exact: true }).click();
        await waitStep(8);
        await screenshot('08-result-before-exam');
        await page.getByRole('button', { name: '开始理论考核', exact: true }).click();
        const examQuestions = await page.evaluate(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().assessment.exam.questionSnapshot);
        for (const [index, question] of examQuestions.entries()) {
          await page.getByRole('button', { name: `第 ${index + 1} 题`, exact: true }).click();
          for (const optionId of question.correctAnswer) {
            const optionIndex = question.options.findIndex((option) => option.id === optionId);
            await page.locator(`input[name="${question.id}"]`).nth(optionIndex).check();
            await page.waitForTimeout(100);
          }
        }
        await page.getByRole('button', { name: '正式交卷', exact: true }).click();
        await page.getByRole('button', { name: '确认交卷', exact: true }).click();
        await waitForState(async () => (await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().assessment.exam.status === 'SUBMITTED');
        await screenshot('08-exam-submitted');
        await page.getByRole('tab', { name: /成绩与实验复盘/ }).click();
        await page.getByRole('button', { name: /结算/ }).click();
        await waitForState(async () => Boolean((await import('/src/stores/experimentStore.ts')).useExperimentStore.getState().assessment.finalizedAt));
        await screenshot('08-final-report');
      } else {
        await page.reload();
        await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
        await waitStep(4);
        await screenshot('04-refresh-requires-recheck');
      }
      assert.deepEqual(errors, [], `${mode} browser exceptions`);
      assert.deepEqual(failures, [], `${mode} backend errors`);
      report.push({ mode, passed: true, coverage: mode === 'mock' ? 'steps 1–8 with simulated flight and final exam' : 'steps 1–7 with real API/telemetry, no flight commands; refresh returns to step 4' });
      await context.close();
    }
    writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
