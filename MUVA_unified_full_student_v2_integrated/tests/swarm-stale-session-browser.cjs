const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const base = process.env.MUVA_TEST_URL || 'http://127.0.0.1:5174';
  const health = await fetch(process.env.MUVA_SWARM_HEALTH_URL || 'http://127.0.0.1:8002/api/swarm/health').then(response => response.json());
  assert.equal(health.sessionId, null, '仅允许在后端没有活动机群时测试失效会话');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`${base}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.setItem('muva-mock-user', 'signed-in');
      sessionStorage.setItem('muva-user-role', 'student');
      sessionStorage.setItem('muva-username', 'swarm-stale-session-test');
      sessionStorage.setItem('muva-auth-token', 'mock-token-student');
      localStorage.setItem('muva-swarm-draft-v1', JSON.stringify({
        id: 'stale-session-test', createdAt: new Date().toISOString(),
        config: { count: 2, altitude: 30, speed: 7, spacing: 12, safety: 8, sceneId: 'campus-training',
          simulationMode: 'sitl', worldFrame: 'ENU', sceneOrigin: [116.3268, 40.0098] },
        area: null, missions: [], confirmed: false, checks: [], step: 1, result: null,
        planning: { noFlyZones: [], savedAt: null },
        snapshot: { status: 'HOLDING', drones: [{ droneId: 'UAV-01', state: 'HOLDING', armed: true }],
          elapsed: 0, coverage: 0, events: [], runtime: { sessionId: 'expired-session', mode: 'sitl',
            label: 'ArduPilot SITL · 无 Gazebo', connected: false } },
      }));
    });
    await page.goto(`${base}/experiments/swarm`);
    await page.getByRole('button', { name: '重新开始实验', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('muva-swarm-draft-v1')).id !== 'stale-session-test');
    const saved = await page.evaluate(() => ({ run: JSON.parse(localStorage.getItem('muva-swarm-draft-v1')),
      drafts: JSON.parse(localStorage.getItem('muva-swarm-saved-drafts-v1') || '[]') }));
    assert.equal(saved.run.step, 1);
    assert.equal(saved.run.snapshot, null);
    assert.ok(saved.drafts.some(draft => draft.id === 'stale-session-test'));
    assert.equal((await fetch(process.env.MUVA_SWARM_HEALTH_URL || 'http://127.0.0.1:8002/api/swarm/health').then(response => response.json())).sessionId, null);
    console.log('失效会话可安全重新开始，旧进度已归档且没有启动飞控');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
