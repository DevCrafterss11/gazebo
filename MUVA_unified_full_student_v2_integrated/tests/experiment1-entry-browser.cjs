const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5181';
    const state = () => page.evaluate(async () => {
      const resource = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/stores/experimentStore.ts');
      const { useExperimentStore } = await import(resource.name);
      const current = useExperimentStore.getState();
      return { active: current.isExperimentActive, step: current.experiment.currentStep, progressId: current.progressId,
        learningProgress: current.learningProgress, completedSteps: current.completedSteps, sessionId: current.sessionId };
    });
    const waitForActive = () => page.waitForFunction(async () => {
      const resource = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/stores/experimentStore.ts');
      return (await import(resource.name)).useExperimentStore.getState().isExperimentActive;
    });

    await page.goto(`${base}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', 'student');
      sessionStorage.setItem('muva-username', 'experiment1-entry-test');
      sessionStorage.setItem('muva-auth-token', 'mock-token-student');
    });
    await page.goto(`${base}/experiments/basic-flight`);
    await page.getByRole('button', { name: '开始新实验', exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: '实验步骤' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '继续上次进度', exact: true }).count(), 0);
    await page.getByRole('button', { name: '开始新实验', exact: true }).click();
    await waitForActive();
    await page.waitForFunction(async () => {
      const resource = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/stores/experimentStore.ts');
      return (await import(resource.name)).useExperimentStore.getState().selectedDrone?.id === 'iris-quadrotor-01';
    });
    assert.equal((await state()).step, 1);

    const saved = await page.evaluate(async () => {
      const resource = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/stores/experimentStore.ts');
      const { useExperimentStore } = await import(resource.name);
      const { parts, questions } = await import('/src/domain/assessment/model.ts');
      const store = useExperimentStore.getState();
      parts.forEach(part => store.learnPart(part.id));
      await store.saveSectionQuiz({ quizId: 'system-cognition', title: '系统组成认知自测', step: 1,
        questions: questions.map(question => ({ id: question.id, correctAnswer: question.answer, explanation: question.explanation })),
        answers: Object.fromEntries(questions.map(question => [question.id, question.answer])),
      });
      store.saveQuizDraft('flight-diagnostics', 'gps', 'draft-answer');
      store.selectScene('city');
      useExperimentStore.setState({ experiment: { ...useExperimentStore.getState().experiment, currentStep: 3 }, completedSteps: [1, 2] });
      await store.saveProgress();
      localStorage.setItem('muva-experiment-records', '[{"id":"previous-record"}]');
      return JSON.parse(localStorage.getItem('muva-experiment-1'));
    });

    await page.reload();
    await page.getByRole('button', { name: '继续上次进度', exact: true }).waitFor();
    assert.equal((await state()).active, false);
    assert.equal((await state()).step, 1);
    assert.deepEqual((await state()).learningProgress.learnedPartIds, []);
    assert.equal(await page.getByRole('navigation', { name: '实验步骤' }).count(), 0);
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('muva-experiment-1'))), saved);
    await page.screenshot({ path: '/tmp/muva-experiment1-entry.png' });

    await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
    await waitForActive();
    const restored = await state();
    assert.equal(restored.step, 3);
    assert.equal(restored.progressId, saved.progressId);
    assert.deepEqual(restored.learningProgress, saved.learningProgress);
    assert.deepEqual(restored.completedSteps, [1, 2]);

    await page.evaluate(async () => {
      const resource = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/app/router.tsx');
      return (await import(resource.name)).router.navigate('/experiments');
    });
    await page.evaluate(async () => {
      const resource = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/app/router.tsx');
      return (await import(resource.name)).router.navigate('/experiments/basic-flight');
    });
    await page.getByRole('button', { name: '继续上次进度', exact: true }).waitFor();
    assert.equal((await state()).active, false);
    await page.getByRole('button', { name: '继续上次进度', exact: true }).click();
    await waitForActive();
    assert.equal((await state()).step, 3);
    assert.equal((await state()).progressId, saved.progressId);

    await page.reload();
    await page.getByRole('button', { name: '重新开始实验', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('muva-experiment-1'))), saved);
    assert.equal((await state()).active, false);
    await page.getByRole('button', { name: '重新开始实验', exact: true }).click();
    await page.getByRole('button', { name: '确认重新开始', exact: true }).click();
    await waitForActive();
    const restarted = await state();
    assert.equal(restarted.step, 1);
    assert.notEqual(restarted.progressId, saved.progressId);
    assert.deepEqual(restarted.learningProgress, { learnedPartIds: [], quizAnswers: {} });
    assert.deepEqual(restarted.completedSteps, []);
    assert.equal(restarted.sessionId, null);
    assert.equal(await page.evaluate(() => localStorage.getItem('muva-experiment-records')), '[{"id":"previous-record"}]');
    assert.deepEqual(errors, []);
    console.log('PASS: first entry, refresh choice, resume, route return, cancel and confirmed restart preserve the correct progress and records');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
