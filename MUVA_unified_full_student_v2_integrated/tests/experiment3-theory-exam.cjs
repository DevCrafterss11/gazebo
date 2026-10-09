const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const baseUrl = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5180';
const output = process.env.MUVA_TEST_OUTPUT || '/tmp/experiment3-theory-exam';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.setItem('muva-mock-user', 'signed-in'); sessionStorage.setItem('muva-user-role', 'student');
    sessionStorage.setItem('muva-username', 'student01'); sessionStorage.setItem('muva-display-name', '张三'); sessionStorage.setItem('muva-auth-token', 'mock-token-student');
  });
  await page.goto(`${baseUrl}/experiments/mission`);
  await page.getByRole('heading', { name: '实验三：四旋翼无人机系统认知与综合飞行考核', exact: true }).waitFor();
  const seed = async scenario => {
    await page.evaluate(async scenario => {
      const moduleUrl = name => performance.getEntriesByType('resource').filter(item => item.name.includes(name)).at(-1).name;
      const { useAssessmentStore, taskPoints } = await import(moduleUrl('/src/stores/assessmentStore.ts'));
      const { createRun, parts, questions, diagnosticQuestions } = await import(moduleUrl('/src/domain/assessment/model.ts'));
      const { scoreRun } = await import(moduleUrl('/src/domain/assessment/ScoringEngine.ts'));
      const { beginTheoryExam } = await import(moduleUrl('/src/domain/assessment/ExamEngine.ts'));
      useAssessmentStore.getState().newRun();
      const run = createRun();
      Object.assign(run, { step: 7, status: 'TRAINING', selectedSceneId: 'city', sceneConfirmed: true, configurationConfirmed: true, parameterAnswer: '高度决定起飞及悬停目标', diagnosticSubmitted: true, faultCasePassed: true, safetyPassed: true, preflightConfirmed: true, learnedParts: parts.map(part => part.id), quizSubmitted: true, quizAnswers: Object.fromEntries(questions.map(question => [question.id, question.answer])), diagnosticAnswers: Object.fromEntries(diagnosticQuestions.map(question => [question.id, question.answer])), anomalySubmitted: true, anomalyAnswer: '暂停任务并评估返航', anomalyChoice: '先确认故障并保持安全飞行高度', reviewTask: 'hover', review: '根据本次轨迹和高度误差复盘悬停、定位与安全返航。' });
      run.configuration.trainingMode = scenario === 'guided' ? 'guided' : 'exam';
      run.taskResults = run.taskResults.map(task => ({ ...task, status: 'PASSED', attempts: 1, metrics: { altitudeError: task.taskId === 'hover' ? 0.4 : 0.2, positionError: 0.6, speed: 0.2, yawError: 1 } }));
      run.taskScores = { ...taskPoints };
      run.evidence = [{ id: 'sensor-fixture', runId: run.runId, timestamp: Date.now(), type: 'DIAGNOSTIC', message: 'GPS 异常已完成定位复检' }];
      run.trajectory = [{ timestamp: Date.now(), x: 0, y: 10, z: 0, roll: 0, pitch: 0, yaw: 0, vx: 0, vy: 0, vz: 0, taskId: 'hover', battery: 90 }, { timestamp: Date.now() + 1000, x: 0.2, y: 10.4, z: 0.1, roll: 0, pitch: 0, yaw: 0, vx: 0.2, vy: 0.1, vz: 0.1, taskId: 'hover', battery: 89 }];
      run.telemetrySummary = { samples: 2, maxAltitude: 10.4, maxSpeed: 0.3, track: [{ north: 0, east: 0, altitude: 10, timestamp: Date.now() }] };
      if (scenario === 'incomplete') { run.status = 'INTERRUPTED'; run.taskResults[2].status = 'FAILED'; run.taskResults[2].reason = '未达到悬停稳定性'; }
      if (scenario === 'aborted') run.status = 'ABORTED';
      if (scenario === 'serious') run.evidence.push({ id: 'serious-fixture', runId: run.runId, timestamp: Date.now(), type: 'SAFETY', message: '已核实的学生危险操作', responsibility: 'student', severity: 'serious', ruleId: 'critical-safety-v1' });
      if (scenario === 'system') run.systemFailure = true;
      if (scenario === 'timeout') run.theoryExam = beginTheoryExam(run, Date.now() - 1201000);
      run.scoreBreakdown = scoreRun(run);
      localStorage.setItem('muva-assessment-active-v2', JSON.stringify(run));
      useAssessmentStore.setState({ run, error: '' });
    }, scenario);
    await page.reload();
    await page.getByRole('tab', { name: '01 理论考卷', exact: true }).click();
  };
  const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem('muva-assessment-active-v2')));
  const answer = async (count = 10) => {
    const run = await snapshot();
    for (const [index, question] of run.theoryExam.questionSnapshot.slice(0, count).entries()) {
      await page.getByRole('button', { name: `第 ${index + 1} 题`, exact: true }).click();
      for (const option of question.correctAnswers) await page.getByRole(question.type === 'multiple' ? 'checkbox' : 'radio', { name: new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).check();
    }
  };
  const submit = async () => {
    await page.getByRole('button', { name: '提交理论考卷', exact: true }).click();
    await page.getByRole('dialog', { name: '确认交卷' }).waitFor();
    await page.getByRole('button', { name: '确认提交考卷', exact: true }).click();
    await page.getByRole('heading', { name: /理论考卷|理论考核/ }).first().waitFor();
  };
  const save = async () => {
    await page.getByRole('tab', { name: '04 实验报告', exact: true }).click();
    await page.getByRole('button', { name: '结算并保存综合报告', exact: true }).click();
    await page.getByRole('button', { name: '综合报告已保存', exact: true }).waitFor();
    return snapshot();
  };

  await seed('complete');
  assert.equal(await page.getByRole('navigation', { name: '实验三步骤' }).getByRole('button').count(), 8);
  await page.getByRole('tab', { name: '02 综合成绩', exact: true }).click();
  await page.getByRole('heading', { name: /综合成绩待结算/ }).waitFor();
  await page.getByRole('tab', { name: '01 理论考卷', exact: true }).click();
  await page.getByRole('button', { name: '开始理论考核', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '查看教学解析', exact: true }).count(), 0);
  assert.equal(await page.getByText(/标准答案：/).count(), 0);
  assert.equal(await page.getByRole('button', { name: /上一步/ }).isDisabled(), true);
  await answer(3);
  const beforeReload = await snapshot();
  await page.screenshot({ path: `${output}/formal-exam.png`, fullPage: true });
  await page.reload();
  const afterReload = await snapshot();
  assert.deepEqual(afterReload.theoryExam.answers, beforeReload.theoryExam.answers);
  assert.equal(afterReload.theoryExam.startedAt, beforeReload.theoryExam.startedAt);
  assert.equal(afterReload.theoryExam.currentQuestionIndex, 2);
  assert.equal(afterReload.practiceScore, beforeReload.practiceScore);
  await page.getByRole('button', { name: '提交理论考卷', exact: true }).click();
  await page.getByRole('button', { name: '继续答题', exact: true }).click();
  assert.equal((await snapshot()).theoryExam.status, 'IN_PROGRESS');
  await answer(); await submit();
  const firstSubmission = await snapshot();
  assert.equal(firstSubmission.theoryScore, 100);
  assert.equal(firstSubmission.overallScore, 100);
  await page.evaluate(async () => {
    const resource = performance.getEntriesByType('resource').filter(item => item.name.includes('/src/stores/assessmentStore.ts')).at(-1);
    const { useAssessmentStore } = await import(resource.name); useAssessmentStore.getState().submitExam();
  });
  assert.equal((await snapshot()).theoryExam.submittedAt, firstSubmission.theoryExam.submittedAt);
  await page.getByRole('tab', { name: '03 实验复盘', exact: true }).click();
  assert.equal(await page.locator('[data-scene-id="city"] canvas').count(), 1);
  const saved = await save();
  assert.equal(saved.assessmentReport.overallStatus, 'PASSED');
  assert.equal(saved.theoryExam.questionSnapshot.length, 10);
  await page.screenshot({ path: `${output}/combined-report.png`, fullPage: true });
  await page.goto(`${baseUrl}/records/assessment/${saved.runId}`);
  assert.equal(await page.getByRole('heading', { name: '实验三 · 综合考核报告', exact: true }).count(), 1);
  assert.ok(await page.getByText(/标准答案：/).count() >= 10);
  await page.goto(`${baseUrl}/experiments/mission`);
  assert.equal((await snapshot()).overallScore, 100);
  console.log('Complete exam, formal answer hiding, autosave, reload, duplicate submission, same-session report: PASS');

  for (const scenario of ['incomplete', 'aborted', 'theory-fail', 'serious', 'system']) {
    await seed(scenario); await page.getByRole('button', { name: '开始理论考核', exact: true }).click();
    await answer(scenario === 'theory-fail' ? 4 : 10); await submit();
    const result = await save();
    assert.equal(result.assessmentReport.overallStatus, scenario === 'system' ? 'INVALID' : 'FAILED');
    assert.equal(result.theoryScore, scenario === 'theory-fail' ? 20 : 100);
    assert.equal(result.assessmentReport.seriousSafetyViolation, scenario === 'serious');
    assert.ok(result.overallScore > 60);
    console.log(`${scenario}: PASS (actual scores retained; cannot incorrectly pass)`);
  }
  await seed('timeout');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('muva-assessment-active-v2')).theoryExam.status === 'SUBMITTED');
  const timed = await snapshot();
  assert.equal(timed.theoryScore, 0); assert.equal(timed.theoryExam.submissionReason, 'timeout');
  await page.reload(); assert.equal((await snapshot()).theoryExam.submittedAt, timed.theoryExam.submittedAt);
  console.log('Expired exam auto-submission and refresh recovery: PASS');
  await seed('guided'); await page.getByRole('button', { name: '开始理论考核', exact: true }).click(); await answer(1);
  await page.getByRole('button', { name: '查看教学解析', exact: true }).click();
  assert.equal(await page.getByText(/标准答案：/).count(), 1);
  for (const width of [1280, 2048]) {
    await page.setViewportSize({ width, height: 1152 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `${output}/exam-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${output}/result.json`, JSON.stringify({ status: 'PASS', errors }, null, 2));
  console.log('Guided explanation and responsive page: PASS');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
