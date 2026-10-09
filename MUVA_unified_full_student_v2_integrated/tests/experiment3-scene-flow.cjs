const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

const baseUrl = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5180';
const output = process.env.MUVA_TEST_OUTPUT || '/tmp/experiment3-scene-flow';
const sceneNames = { campus: '校园训练场', city: '城市训练场', mountain: '山地训练场', airport: '机场训练场' };
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(baseUrl)) externalRequests.push(request.url());
  });
  await page.goto(`${baseUrl}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.setItem('muva-mock-user', 'signed-in');
    sessionStorage.setItem('muva-user-role', 'student');
    sessionStorage.setItem('muva-username', 'student01');
    sessionStorage.setItem('muva-display-name', '张三');
    sessionStorage.setItem('muva-auth-token', 'mock-token-student');
  });
  await page.goto(`${baseUrl}/experiments/mission`);
  await page.getByRole('heading', { name: '实验三：四旋翼无人机系统认知与综合飞行考核', exact: true }).waitFor();
  const next = () => page.getByRole('button', { name: /完成本阶段，进入下一步/ }).click();
  const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem('muva-assessment-active-v2')));
  const renderer = () => page.evaluate(async () => {
    const resource = performance.getEntriesByType('resource').find(item => item.name.includes('/@react-three_fiber.js'));
    const { _roots } = await import(resource.name);
    const canvas = document.querySelector('main canvas');
    const state = _roots.get(canvas).store.getState();
    const iris = state.scene.getObjectByName('experiment3-iris');
    let meshes = 0;
    iris.traverse(object => { if (object.isMesh) meshes += 1; });
    return { uuid: iris.uuid, body: iris.children[0].uuid, meshes, camera: state.camera.position.toArray(), alpha: state.gl.getClearAlpha(), grid: state.scene.children.some(object => object.type === 'GridHelper') };
  });
  const verifyMap = async id => {
    const viewport = page.locator(`[data-scene-id="${id}"]`);
    await viewport.waitFor();
    const map = viewport.getByRole('img', { name: `${sceneNames[id]}卫星地图`, exact: true });
    assert.equal(await map.getAttribute('src'), `/experiment3/scenes/${id}-satellite.jpg`);
    await map.evaluate(image => image.decode());
    assert.equal(await map.evaluate(image => image.naturalWidth), 1024);
    await page.waitForTimeout(200);
    const model = await renderer();
    assert.ok(model.meshes > 40);
    assert.equal(model.alpha, 0);
    assert.equal(model.grid, false);
    return model;
  };
  const select = async id => {
    await page.getByRole('radio', { name: sceneNames[id], exact: true }).click();
    assert.equal(await page.locator('[role="radio"][aria-checked="true"]').count(), 1);
    assert.equal((await snapshot()).selectedSceneId, id);
    assert.equal('scene' in await snapshot(), false);
    return verifyMap(id);
  };
  const confirm = async id => {
    await page.getByRole('button', { name: '确认当前场景', exact: true }).click();
    await next();
    await page.getByRole('heading', { name: '启动前配置确认', exact: true }).waitFor();
    assert.equal((await snapshot()).selectedSceneId, id);
    assert.equal(await page.getByRole('radio').count(), 0);
    assert.equal(await page.locator('select').count(), 1);
    const confirmation = page.locator('section').filter({ has: page.getByRole('heading', { name: '启动前配置确认', exact: true }) });
    assert.match(await confirmation.innerText(), new RegExp(sceneNames[id]));
    assert.match(await confirmation.innerText(), /Iris 四旋翼/);
    await verifyMap(id);
    await page.screenshot({ path: `${output}/${id}-confirmation.png`, fullPage: true });
  };
  for (const name of ['机架', '电机', '螺旋桨', '飞控', 'GPS', 'IMU', '电池', '通信模块']) {
    await page.getByRole('button', { name: new RegExp(`${name}$`) }).first().click();
  }
  await page.getByRole('button', { name: '开始知识自测', exact: true }).click();
  for (const [question, answer] of [['哪一部件将控制指令', '飞控与电调'], ['四旋翼改变航向角', '反向旋转电机扭矩差'], ['EKF 的主要用途', '融合传感器估计姿态和位置']]) {
    await page.locator('label').filter({ hasText: question }).locator('select').selectOption(answer);
  }
  await page.getByRole('button', { name: '提交自测', exact: true }).click();
  await next();
  await page.locator('label').filter({ hasText: '理解题：高度参数' }).locator('select').selectOption('高度决定起飞及悬停目标');
  await page.getByRole('button', { name: '验证并确认参数', exact: true }).click();
  await next();
  assert.equal(await page.getByRole('radio').count(), 4);
  assert.equal(await page.locator('[role="radio"][aria-checked="true"]').count(), 0);
  await select('campus');
  await confirm('campus');
  console.log('Test A: PASS');
  await page.getByRole('button', { name: '返回场景选择', exact: true }).click();
  await select('city');
  await confirm('city');
  console.log('Test B: PASS');
  await page.getByRole('button', { name: '返回场景选择', exact: true }).click();
  await select('campus');
  await confirm('campus');
  await page.getByRole('button', { name: /上一步/ }).click();
  await select('mountain');
  await confirm('mountain');
  console.log('Test C: PASS');
  await page.getByRole('button', { name: '返回场景选择', exact: true }).click();
  const original = await select('campus');
  const canvas = await page.locator('main canvas').elementHandle();
  for (const id of ['city', 'mountain', 'airport', 'campus']) {
    const current = await select(id);
    assert.equal(current.uuid, original.uuid);
    assert.equal(current.body, original.body);
    assert.equal(current.meshes, original.meshes);
    assert.equal(await canvas.evaluate(element => element === document.querySelector('main canvas')), true);
  }
  const bounds = await page.locator('main canvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 110, bounds.y + bounds.height / 2 + 35, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.notDeepEqual((await renderer()).camera, original.camera);
  const rotated = (await renderer()).camera;
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
  assert.notDeepEqual((await renderer()).camera, rotated);
  await select('mountain');
  await confirm('mountain');
  console.log('Test D: PASS (same WebGL canvas and Iris objects; rotation/zoom retained)');
  await page.reload();
  await verifyMap('mountain');
  assert.equal((await snapshot()).selectedSceneId, 'mountain');
  await page.getByRole('button', { name: '返回场景选择', exact: true }).click();
  await page.getByRole('button', { name: /上一步/ }).click();
  await page.getByRole('button', { name: '验证并确认参数', exact: true }).click();
  await next();
  assert.equal((await snapshot()).selectedSceneId, 'mountain');
  await confirm('mountain');
  await page.getByRole('button', { name: '启动 / 重试', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('muva-assessment-active-v2')).environment === 'READY');
  await verifyMap('mountain');
  await next();
  await verifyMap('mountain');
  for (const step of [5, 6, 7]) {
    await page.evaluate(async step => {
      const resource = performance.getEntriesByType('resource').find(item => item.name.includes('/src/stores/assessmentStore.ts'));
      const { useAssessmentStore } = await import(resource.name);
      useAssessmentStore.setState(state => ({ run: { ...state.run, step } }));
    }, step);
    if (step === 7) await page.getByRole('tab', { name: '03 实验复盘', exact: true }).click();
    await verifyMap('mountain');
  }
  console.log('Refresh, parameter reconfirmation, startup and subsequent view consistency: PASS');
  for (const width of [1280, 2048]) {
    await page.setViewportSize({ width, height: 1152 });
    await page.getByRole('button', { name: /训练场景选择/ }).click();
    await page.screenshot({ path: `${output}/scene-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  fs.writeFileSync(`${output}/result.json`, JSON.stringify({ tests: ['A', 'B', 'C', 'D'], errors, externalRequests, status: 'PASS' }, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
