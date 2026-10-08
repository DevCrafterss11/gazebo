import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distance, planMissions, toGeo, toLocal, validateArea } from '../src/domain/swarmGeometry';
import { scoreSwarm } from '../src/domain/swarmScoring';
import { MockSwarmRuntime } from '../src/services/mock/MockSwarmRuntime';
import type { SwarmConfig, SwarmRun } from '../src/types/swarm';

const config: SwarmConfig = { count: 3, altitude: 10, speed: 20, spacing: 8, safety: 8, sceneId: 'test', simulationMode: 'mock', worldFrame: 'ENU' };
const rectangle = [toGeo([-35, -20]), toGeo([35, -20]), toGeo([35, 30]), toGeo([-35, 30])];

test('区域面积、周长及坐标换算', () => {
  const area = validateArea(rectangle);
  assert.ok(Math.abs(area.area - 3500) < 0.01);
  assert.ok(Math.abs(area.perimeter - 240) < 0.01);
  assert.ok(distance(toLocal(rectangle[0]), [-35, -20]) < 0.01);
  assert.deepEqual(area.polygon.coordinates[0][0], area.polygon.coordinates[0].at(-1));
});

test('拒绝自交与过小区域', () => {
  assert.throws(() => validateArea([rectangle[0], rectangle[2], rectangle[1], rectangle[3]]), /自交/);
  assert.throws(() => validateArea([toGeo([0, 0]), toGeo([2, 0]), toGeo([0, 2])]), /面积/);
});

for (const count of [2, 3, 4, 5]) {
  test(`${count} 机分配唯一覆盖航线并完成生命周期`, () => {
    const setting = { ...config, count };
    const missions = planMissions(validateArea(rectangle), setting);
    assert.equal(missions.length, count);
    assert.equal(new Set(missions.map((mission) => mission.droneId)).size, count);
    assert.ok(missions.every((mission) => mission.coverageSegments.length > 0 && mission.plannedDistance > 0));
    const runtime = new MockSwarmRuntime();
    runtime.initialize(setting);
    runtime.loadMission(missions);
    assert.throws(() => runtime.takeoff(), /不允许/);
    runtime.markReady();
    runtime.takeoff();
    for (let index = 0; index < 300 && runtime.getStatus().status !== 'HOLDING'; index += 1) runtime.tick(0.5);
    assert.equal(runtime.getStatus().status, 'HOLDING');
    runtime.startMission();
    for (let index = 0; index < 1000 && runtime.getStatus().status !== 'COMPLETED'; index += 1) runtime.tick(0.5);
    assert.equal(runtime.getStatus().status, 'COMPLETED');
    assert.equal(runtime.getStatus().coverage, 100);
    assert.ok(runtime.getFleet().every((drone) => drone.state === 'LANDED'));
    runtime.dispose();
  });
}

test('暂停保持位置，恢复插值前进，提前返航保留覆盖缺口', () => {
  const runtime = new MockSwarmRuntime();
  runtime.initialize(config);
  runtime.loadMission(planMissions(validateArea(rectangle), config));
  runtime.markReady(); runtime.takeoff();
  for (let index = 0; index < 100; index += 1) runtime.tick(0.5);
  runtime.startMission(); runtime.tick(0.5);
  runtime.pauseMission();
  const before = runtime.getStatus().drones.map((drone) => drone.trajectory.length);
  runtime.tick(5);
  assert.deepEqual(runtime.getStatus().drones.map((drone) => drone.trajectory.length), before);
  runtime.resumeMission(); runtime.tick(0.5);
  assert.ok(runtime.getStatus().drones.some((drone, index) => drone.trajectory.length > before[index]!));
  runtime.returnDroneToHome('UAV-01');
  assert.equal(runtime.getStatus().drones[0]?.state, 'RETURNING');
  runtime.returnToHome();
  for (let index = 0; index < 300 && runtime.getStatus().status !== 'ABORTED'; index += 1) runtime.tick(0.5);
  assert.equal(runtime.getStatus().status, 'ABORTED');
  assert.ok(runtime.getStatus().coverage < 100);
  runtime.dispose();
});

test('评分随实际覆盖率、终态及安全降落变化', () => {
  const runtime = new MockSwarmRuntime();
  const area = validateArea(rectangle); const missions = planMissions(area, config);
  const snapshot = runtime.initialize(config);
  const run: SwarmRun = { id: 'test-run', createdAt: '', config, area, missions, confirmed: true, checks: [], snapshot: { ...snapshot, coverage: 50, status: 'ABORTED' }, step: 6, result: null };
  assert.equal(scoreSwarm(run).score, 35);
  const complete: SwarmRun = { ...run, snapshot: { ...snapshot, status: 'COMPLETED', coverage: 100, drones: snapshot.drones.map((drone) => ({ ...drone, state: 'LANDED' })) } };
  assert.equal(scoreSwarm(complete).score, 100);
  runtime.dispose();
});
