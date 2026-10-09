import assert from 'node:assert/strict';
import { test } from 'node:test';
import './experiment3-exam.test';
import { TrainingRuleEngine } from '../src/domain/assessment/TrainingRuleEngine';
import { createRun, defaultConfig, parts, questions, scenes, tasks, type TaskResult } from '../src/domain/assessment/model';
import { EXPERIMENT3_SCENES, getExperiment3Scene, restoreExperiment3Scene } from '../src/domain/assessment/experiment3Scenes';
import { existsSync, readFileSync } from 'node:fs';

test('experiment 3 provides four selectable scenes with distinct local satellite maps', () => {
  assert.deepEqual(EXPERIMENT3_SCENES.map((scene) => scene.id), ['campus', 'city', 'mountain', 'airport']);
  assert.equal(new Set(EXPERIMENT3_SCENES.map((scene) => scene.mapImage)).size, 4);
  for (const scene of EXPERIMENT3_SCENES) {
    assert.equal(scene.available, true);
    assert.equal(getExperiment3Scene(scene.id), scene);
    assert.match(scene.mapImage, new RegExp(`/experiment3/scenes/${scene.id}-satellite\\.jpg$`));
    assert.equal(existsSync(`public${scene.previewImage}`), true);
    const image = readFileSync(`public${scene.mapImage}`);
    assert.equal(image.readUInt16BE(0), 0xffd8);
    assert.ok(image.length > 20000, 'satellite image must not be a blank placeholder');
    assert.ok(scene.name && scene.type && scene.description && scene.trainingGoal);
  }
});

test('experiment 3 has no implicit campus selection or duplicate scene field', () => {
  const run = createRun();
  assert.equal(run.selectedSceneId, null);
  assert.equal('scene' in run, false);
  assert.equal(getExperiment3Scene(null), undefined);
  assert.equal(getExperiment3Scene('unknown'), undefined);
});

test('experiment 3 restores the selected scene and migrates only its legacy scene field', () => {
  for (const scene of EXPERIMENT3_SCENES) {
    assert.equal(restoreExperiment3Scene({ selectedSceneId: scene.id }), scene.id);
    assert.equal(restoreExperiment3Scene({ scene: scene.id }), scene.id);
  }
  assert.equal(restoreExperiment3Scene({ scene: 'runway' }), 'airport');
  assert.equal(restoreExperiment3Scene({ selectedSceneId: 'city', scene: 'campus' }), 'city');
  assert.equal(restoreExperiment3Scene({ selectedSceneId: null, scene: 'campus' }), null);
  assert.equal(restoreExperiment3Scene({ selectedSceneId: 'unknown' }), null);
});
import { MockAssessmentRuntime } from '../src/services/mock/MockAssessmentRuntime';
import { scoreRun, totalScore } from '../src/domain/assessment/ScoringEngine';
import type { TelemetrySample } from '../src/types/telemetry';

const sample = (timestamp: number, overrides: Partial<TelemetrySample> = {}): TelemetrySample => ({
  timestamp, position: { latitude: 34, longitude: 108, altitude: 10 }, attitude: { roll: 0, pitch: 0, yaw: 0 }, speedMetersPerSecond: 0,
  batteryPercent: 90, gpsSatellites: 16, ekfStatus: { healthy: true, state: 'NORMAL' },
  mavlinkStatus: { connected: true, heartbeat: true, version: '2' }, armed: true, mode: 'GUIDED', north: 0, east: 0, ...overrides,
});
const running = (taskId: string): TaskResult => ({ taskId, status: 'RUNNING', attempts: 1 });

test('hover requires configured continuous duration, resets outside altitude, position and speed tolerance', () => {
  const now = Date.now(); const engine = new TrainingRuleEngine({ ...defaultConfig, hoverSeconds: 15 }); engine.start(sample(now)); engine.beginHover();
  assert.equal(engine.evaluate(running('hover'), sample(now), now).status, 'RUNNING');
  assert.equal(engine.evaluate(running('hover'), sample(now + 8000, { position: { latitude: 34, longitude: 108, altitude: 12 } }), now + 8000).status, 'RUNNING');
  assert.equal(engine.evaluate(running('hover'), sample(now + 14000, { east: 3 }), now + 14000).status, 'RUNNING');
  assert.equal(engine.evaluate(running('hover'), sample(now + 18000, { speedMetersPerSecond: 1 }), now + 18000).status, 'RUNNING');
  assert.equal(engine.evaluate(running('hover'), sample(now + 20000), now + 20000).status, 'RUNNING');
  assert.equal(engine.evaluate(running('hover'), sample(now + 35000), now + 35000).status, 'PASSED');
});
test('directional position goal rejects equal-distance movement in opposite direction', () => {
  const now = Date.now(); const engine = new TrainingRuleEngine(defaultConfig); engine.start(sample(now));
  assert.equal(engine.evaluate(running('forward'), sample(now + 100, { north: -5 }), now + 100).status, 'RUNNING');
  assert.equal(engine.evaluate(running('forward'), sample(now + 200, { east: 5 }), now + 200).status, 'RUNNING');
  assert.equal(engine.evaluate(running('forward'), sample(now + 300, { north: 5 }), now + 300).status, 'PASSED');
});
test('campus goal uses the same east/north coordinates as the scene marker', () => {
  const now = Date.now();
  const campus = scenes.find((scene) => scene.id === 'campus')!;
  const engine = new TrainingRuleEngine(defaultConfig, campus);
  engine.start(sample(now));
  assert.equal(engine.evaluate(running('target'), sample(now + 100, { north: 10, east: 0 }), now + 100).status, 'RUNNING');
  assert.equal(engine.evaluate(running('target'), sample(now + 200, { north: -campus.targetPosition.z, east: campus.targetPosition.x }), now + 200).status, 'RUNNING');
  assert.equal(engine.evaluate(running('target'), sample(now + 2300, { north: -campus.targetPosition.z, east: campus.targetPosition.x }), now + 2300).status, 'PASSED');
});
test('advanced difficulty tightens directional position tolerance', () => {
  const now = Date.now();
  const beginner = new TrainingRuleEngine(defaultConfig);
  const advanced = new TrainingRuleEngine({ ...defaultConfig, difficulty: 'advanced' });
  beginner.start(sample(now)); advanced.start(sample(now));
  const nearTarget = sample(now + 100, { north: 4 });
  assert.equal(beginner.evaluate(running('forward'), nearTarget, now + 100).status, 'PASSED');
  assert.equal(advanced.evaluate(running('forward'), nearTarget, now + 100).status, 'RUNNING');
});
test('stable time ignores paused duration and reports why a target is not met', () => {
  const now = Date.now();
  const engine = new TrainingRuleEngine({ ...defaultConfig, hoverSeconds: 3 });
  engine.start(sample(now)); engine.beginHover();
  const first = engine.evaluate(running('hover'), sample(now + 100), now + 100);
  assert.equal(first.stableSeconds, 0);
  engine.pause(now + 1100);
  assert.equal(engine.evaluate(first, sample(now + 9100), now + 9100).status, 'RUNNING');
  engine.resume(now + 10100);
  assert.equal(engine.evaluate(first, sample(now + 11100), now + 11100).status, 'RUNNING');
  assert.equal(engine.evaluate(first, sample(now + 12100), now + 12100).status, 'PASSED');
  const invalid = engine.evaluate(running('hover'), sample(now + 12200, { east: 5 }), now + 12200);
  assert.match(invalid.feedback ?? '', /距离目标/);
});
test('composite task needs observable maneuver before stable control', () => {
  const now = Date.now(); const engine = new TrainingRuleEngine(defaultConfig);
  engine.start(sample(now)); engine.acceptCommand();
  assert.equal(engine.evaluate(running('composite'), sample(now + 100), now + 100).status, 'RUNNING');
  assert.equal(engine.evaluate(running('composite'), sample(now + 2200), now + 2200).status, 'RUNNING');
  engine.evaluate(running('composite'), sample(now + 2300, { east: 3 }), now + 2300);
  assert.equal(engine.evaluate(running('composite'), sample(now + 2400), now + 2400).status, 'RUNNING');
  assert.equal(engine.evaluate(running('composite'), sample(now + 4600), now + 4600).status, 'PASSED');
});
test('RTL command acknowledgement is not a landing confirmation', () => {
  const now = Date.now(); const engine = new TrainingRuleEngine(defaultConfig); engine.start(sample(now)); engine.acceptCommand();
  assert.equal(engine.evaluate(running('rtl'), sample(now + 100, { mode: 'RTL' }), now + 100).status, 'RUNNING');
  assert.equal(engine.evaluate(running('rtl'), sample(now + 200, { mode: 'RTL', north: 0, east: 0 }), now + 200).status, 'RUNNING');
  assert.equal(engine.evaluate(running('rtl'), sample(now + 300, { armed: false, position: { latitude: 34, longitude: 108, altitude: 0 }, mode: 'LAND', north: 0, east: 0 }), now + 300).status, 'PASSED');
});
test('stale telemetry cannot pass tasks', () => {
  const now = Date.now(); const engine = new TrainingRuleEngine(defaultConfig); engine.start(sample(now));
  assert.equal(engine.evaluate(running('arm'), sample(now - 4000, { position: { latitude: 34, longitude: 108, altitude: 0 } }), now).status, 'RUNNING');
  assert.equal(engine.evaluate(running('arm'), sample(now, { position: { latitude: 34, longitude: 108, altitude: 0 }, mavlinkStatus: { connected: false, heartbeat: false, version: '2' } }), now).status, 'RUNNING');
});
test('scoring is deterministic, capped at 100 and duplicate events do not add points', () => {
  const run = createRun(); run.quizSubmitted = true;
  run.learnedParts = parts.map((part) => part.id); run.configurationConfirmed = true; run.sceneConfirmed = true;
  run.parameterAnswer = '高度决定起飞及悬停目标'; run.diagnosticSubmitted = true; run.preflightConfirmed = true;
  run.quizAnswers = Object.fromEntries(questions.map((item) => [item.id, item.answer]));
  run.completedSteps = [0, 1, 2, 3, 4, 5, 6]; run.safetyPassed = true;
  run.diagnosticAnswers = { gps: '不可继续', ekf: '不可继续', link: '不可继续' };
  run.taskResults = tasks.map(({ taskId }) => ({ taskId, status: 'PASSED', attempts: 1 }));
  run.taskScores = { arm: 2, takeoff: 4, hover: 5, vertical: 3, forward: 4, lateral: 3, yaw: 3, target: 4, composite: 3, rtl: 4 };
  run.anomalyAnswer = '暂停任务并评估返航'; run.anomalyChoice = '先确认故障并保持安全飞行高度'; run.anomalySubmitted = true; run.review = '悬停时位置误差最大，应保持低速。';
  run.reviewTask = 'takeoff'; run.taskResults[1] = { ...run.taskResults[1]!, metrics: { altitudeError: 1, positionError: 0, speed: 0, yawError: 0 } };
  run.evidence.push({ id: crypto.randomUUID(), runId: run.runId, type: 'TASK', message: '重复事件', timestamp: Date.now() });
  assert.equal(totalScore(scoreRun(run)), 100);
  run.evidence.push(run.evidence[0]!); assert.equal(totalScore(scoreRun(run)), 100);
  run.taskResults[2] = { taskId: 'hover', status: 'INTERRUPTED', attempts: 1 };
  assert.ok(totalScore(scoreRun(run)) < 100);
});
test('Mock runtime moves continuously, keeps telemetry aligned and returns Home before landing', () => {
  const mock = new MockAssessmentRuntime();
  const animation = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => undefined;
  try {
    mock.start(defaultConfig);
    mock.command('arm'); mock.command('takeoff', 10);
    mock.step(0.1);
    assert.ok(mock.snapshot().position.y > 0 && mock.snapshot().position.y < 10);
    for (let index = 0; index < 80; index++) mock.step(0.08);
    assert.ok(Math.abs(mock.telemetry().position.altitude - mock.snapshot().position.y) < 0.0001);
    mock.command('forward', 5);
    for (let index = 0; index < 45; index++) mock.step(0.08);
    assert.ok(mock.snapshot().position.z < -4);
    mock.command('rtl');
    assert.notEqual(mock.snapshot().position.z, 0);
    for (let index = 0; index < 160; index++) mock.step(0.08);
    assert.ok(Math.abs(mock.snapshot().position.z) < 0.25);
    assert.equal(mock.snapshot().armed, false);
    mock.stop();
  } finally { globalThis.requestAnimationFrame = animation; globalThis.cancelAnimationFrame = cancel; }
});
test('out-of-bounds command leaves flight target and motion unchanged', () => {
  const mock = new MockAssessmentRuntime();
  const animation = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    mock.start(defaultConfig, 'campus');
    mock.command('arm');
    mock.command('takeoff', 10);
    for (let index = 0; index < 80; index++) mock.step(0.08);
    mock.command('forward', 5);
    const before = mock.snapshot();
    assert.throws(() => mock.command('forward', 100), /安全区域/);
    assert.deepEqual(mock.snapshot(), before);
    mock.stop();
  } finally { globalThis.requestAnimationFrame = animation; globalThis.cancelAnimationFrame = cancel; }
});
test('pause freezes movement, stop clears telemetry and restart switches scene targets', () => {
  const mock = new MockAssessmentRuntime();
  const animation = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => undefined;
  try {
    mock.start(defaultConfig, 'runway');
    mock.command('arm'); mock.command('takeoff', 10);
    mock.step(0.08);
    mock.command('pause');
    const paused = mock.snapshot();
    for (let count = 0; count < 10; count++) mock.step(0.08);
    assert.deepEqual(mock.snapshot().position, paused.position);
    assert.equal(mock.telemetry().speedMetersPerSecond, 0);
    mock.command('resume'); mock.step(0.08);
    assert.ok(mock.snapshot().position.y > paused.position.y);
    mock.stop();
    assert.equal(mock.telemetry().timestamp, 0);
    mock.start(defaultConfig, 'campus');
    assert.deepEqual(mock.snapshot().homePosition, scenes.find((scene) => scene.id === 'campus')!.homePosition);
    assert.equal(mock.snapshot().armed, false);
  } finally { mock.stop(); globalThis.requestAnimationFrame = animation; globalThis.cancelAnimationFrame = cancel; }
});
test('wind shifts position deterministically and invalid flight values cannot corrupt state', () => {
  const animation = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => undefined;
  const runway = new MockAssessmentRuntime();
  const campus = new MockAssessmentRuntime();
  try {
    for (const [runtime, scene] of [[runway, 'runway'], [campus, 'campus']] as const) {
      runtime.start(defaultConfig, scene);
      runtime.command('arm'); runtime.command('takeoff', 10);
      for (let count = 0; count < 80; count++) runtime.step(0.08);
      runtime.command('forward', 5);
      for (let count = 0; count < 25; count++) runtime.step(0.08);
    }
    assert.notEqual(campus.snapshot().position.x, runway.snapshot().position.x);
    const before = campus.snapshot();
    assert.throws(() => campus.command('waypoint', { x: Number.NaN, z: 0 }), /无效/);
    assert.throws(() => campus.command('altitude', Number.NaN), /无效/);
    assert.deepEqual(campus.snapshot(), before);
  } finally { runway.stop(); campus.stop(); globalThis.requestAnimationFrame = animation; globalThis.cancelAnimationFrame = cancel; }
});
test('safety deductions reduce only the flight category', () => {
  const run = createRun();
  run.taskResults[0] = { taskId: 'arm', status: 'PASSED', attempts: 1 };
  run.taskScores.arm = 2;
  const clean = scoreRun(run).find((entry) => entry.ruleId === 'flight')!.actualScore;
  run.evidence.push({ id: 'risk', runId: run.runId, timestamp: 1, type: 'SAFETY', message: '接近障碍物' });
  assert.ok(scoreRun(run).find((entry) => entry.ruleId === 'flight')!.actualScore < clean);
});
test('Mock GPS and link failures are reflected in telemetry and recover deterministically', () => {
  const mock = new MockAssessmentRuntime();
  const animation = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    mock.start(defaultConfig);
    mock.setFault('gps');
    assert.equal(mock.telemetry().gpsSatellites, 2);
    assert.throws(() => mock.command('arm'), /异常/);
    mock.setFault('link');
    assert.equal(mock.telemetry().mavlinkStatus.connected, false);
    mock.setFault('normal');
    assert.equal(mock.telemetry().gpsSatellites, 16);
    assert.equal(mock.telemetry().mavlinkStatus.connected, true);
    mock.stop();
  } finally { globalThis.requestAnimationFrame = animation; globalThis.cancelAnimationFrame = cancel; }
});
test('all ten tasks require their own telemetry goal', () => {
  const now = Date.now();
  const runTask = (taskId: string, origin: TelemetrySample, observations: TelemetrySample[], accept = false) => {
    const engine = new TrainingRuleEngine(defaultConfig); engine.start(origin);
    if (accept) engine.acceptCommand();
    if (taskId === 'hover') engine.beginHover();
    let result = running(taskId);
    observations.forEach((observation) => { result = engine.evaluate(result, observation, observation.timestamp); });
    assert.equal(result.status, 'PASSED', `${taskId} needs telemetry completion`);
  };
  runTask('arm', sample(now, { armed: false, position: { latitude: 34, longitude: 108, altitude: 0 } }), [sample(now + 100, { position: { latitude: 34, longitude: 108, altitude: 0 } })]);
  runTask('takeoff', sample(now, { position: { latitude: 34, longitude: 108, altitude: 0 } }), [sample(now + 100), sample(now + 1200)]);
  runTask('hover', sample(now), [sample(now + 100), sample(now + 15100)]);
  runTask('vertical', sample(now), [sample(now + 100, { position: { latitude: 34, longitude: 108, altitude: 13 } }), sample(now + 200)]);
  runTask('forward', sample(now), [sample(now + 100, { north: 5 })]);
  runTask('lateral', sample(now), [sample(now + 100, { east: 5 })]);
  runTask('yaw', sample(now), [sample(now + 100, { attitude: { roll: 0, pitch: 0, yaw: 90 } })]);
  runTask('target', sample(now, { north: 5 }), [sample(now + 100, { north: 10 }), sample(now + 2200, { north: 10 })]);
  runTask('composite', sample(now), [sample(now + 50, { east: 3 }), sample(now + 100), sample(now + 2200)], true);
  runTask('rtl', sample(now), [sample(now + 100, { mode: 'RTL' }), sample(now + 200, { mode: 'LAND', armed: false, position: { latitude: 34, longitude: 108, altitude: 0 } })], true);
});
