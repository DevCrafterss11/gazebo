import assert from 'node:assert/strict';
import { test } from 'node:test';

import { campusOrigin, distance, planMissions, polygonCenter, swarmFrame, toGeo, toLocal, validateArea } from '../src/domain/swarmGeometry';
import { areaOverlapsNoFly, assertPlanningSafe, partitionSwarmArea, pointInPolygon, routeIntersectsNoFly } from '../src/domain/swarmPlanning';
import { scoreSwarm } from '../src/domain/swarmScoring';
import { MockSwarmRuntime } from '../src/services/mock/MockSwarmRuntime';
import { orthogonalRoute, routeLength, shortestRoute, segmentDistance, segmentHitsBox } from '../src/domain/swarmRouting';
import { minimumCoverageRectangle } from '../src/domain/swarmCoverage';
import { acceptedMissions, checkMissionPlan, completeMissionPath, deliveryStatus, missionUploaded } from '../src/domain/swarmMissionWorkflow';
import type { Point, SwarmConfig, SwarmMission, SwarmRun } from '../src/types/swarm';

const config: SwarmConfig = { count: 3, altitude: 10, speed: 20, spacing: 8, safety: 8, sceneId: 'test', simulationMode: 'mock', worldFrame: 'ENU' };
const rectangle = [toGeo([-35, -20]), toGeo([35, -20]), toGeo([35, 30]), toGeo([-35, 30])];

test('保存多边形边界、面积与真实面积中心，编辑后重新计算中心', () => {
  const vertices: Point[] = [[0, 0], [120, 0], [0, 90]];
  const area = validateArea(vertices.map(toGeo));
  assert.ok(distance(toLocal(area.center!), [40, 30]) < .001);
  assert.ok(Math.abs(area.area - 5400) < .001);
  assert.ok(distance(toLocal(polygonCenter([...vertices].reverse().map(toGeo))), [40, 30]) < .001);
  const edited = validateArea(([[-30, 0], [120, 0], [0, 90]] as Point[]).map(toGeo));
  assert.ok(distance(toLocal(edited.center!), [30, 30]) < .001);
});

function workflowRun(runtime: MockSwarmRuntime): SwarmRun {
  const area = validateArea(rectangle);
  const snapshot = runtime.initialize(config);
  const missions = planMissions(area, config, snapshot.drones);
  return { id: 'workflow-run', createdAt: new Date().toISOString(), config, area, missions, snapshot, step: 3, result: null, confirmed: false, checks: [],
    planning: { noFlyZones: [], savedAt: null }, delivery: { planId: 'workflow-plan', status: 'GENERATED', checks: [], receipts: [], checkedAt: null, uploadedAt: null } };
}

test('完整路径使用实际服务 Home，距离和检查结果来自同一计划', () => {
  const runtime = new MockSwarmRuntime();
  const run = workflowRun(runtime);
  assert.equal(deliveryStatus(run), 'GENERATED');
  assert.equal(missionUploaded(run), false);
  assert.ok(checkMissionPlan(run).every((check) => check.status === 'PASSED'));
  run.missions.forEach((mission) => {
    const drone = run.snapshot!.drones.find((item) => item.droneId === mission.droneId)!;
    const path = completeMissionPath(mission, drone);
    assert.deepEqual(path[0], drone.position);
    assert.deepEqual(path.at(-1), drone.homePosition);
    const length = path.slice(1).reduce((sum, point, index) => sum + distance(toLocal(path[index]!), toLocal(point)), 0);
    assert.ok(Math.abs(length - mission.plannedDistance) < .001);
  });
  for (const kind of ['missingReturn', 'duplicateDrone', 'wrongDistance', 'wrongCoverageIndex'] as const) {
    const invalid = structuredClone(run);
    if (kind === 'missingReturn') delete invalid.missions[0]!.returnPath;
    if (kind === 'duplicateDrone') invalid.missions[1]!.droneId = invalid.missions[0]!.droneId;
    if (kind === 'wrongDistance') invalid.missions[0]!.plannedDistance += 100;
    if (kind === 'wrongCoverageIndex') invalid.missions[0]!.coverageWaypointIndices = [-1];
    assert.ok(checkMissionPlan(invalid).some((check) => check.status === 'FAILED'), kind);
  }
  runtime.dispose();
});

test('Mock 下发逐机完整路径回执，收到前不能就绪，下发不推进飞行', async () => {
  const runtime = new MockSwarmRuntime();
  const run = workflowRun(runtime);
  runtime.loadMission(run.missions);
  assert.throws(() => runtime.markReady(), /先下发/);
  assert.throws(() => runtime.takeoff(), /不允许/);
  const before = runtime.getStatus();
  const receipts = await runtime.uploadMission(run.missions, run.delivery!.planId);
  assert.equal(receipts.length, 3);
  assert.ok(acceptedMissions(run.missions, receipts, before.drones, run.delivery!.planId));
  assert.equal(runtime.getStatus().status, 'PLANNED');
  assert.equal(runtime.getStatus().elapsed, 0);
  assert.deepEqual(runtime.getFleet(), before.drones);
  receipts.forEach((receipt) => {
    const mission = run.missions.find((item) => item.droneId === receipt.droneId)!;
    assert.equal(receipt.waypointCount, completeMissionPath(mission, before.drones.find((drone) => drone.droneId === receipt.droneId)).length);
    assert.equal(receipt.message, '航线接收成功');
  });
  run.snapshot = runtime.getStatus();
  run.delivery = { ...run.delivery!, status: 'UPLOADED', receipts, uploadedAt: receipts[0]!.receivedAt };
  assert.equal(missionUploaded(run), true);
  const restored = new MockSwarmRuntime();
  restored.restore(config, run.missions, run.snapshot);
  restored.markReady();
  assert.equal(restored.getStatus().status, 'READY');
  restored.takeoff();
  restored.dispose(); runtime.dispose();
});

test('拒绝部分、重复、过期计划及航点数错误的回执', async () => {
  const runtime = new MockSwarmRuntime();
  const run = workflowRun(runtime);
  runtime.loadMission(run.missions);
  const receipts = await runtime.uploadMission(run.missions, 'workflow-plan');
  const invalid = [receipts.slice(0, 2), [receipts[0]!, receipts[0]!, receipts[2]!], receipts.map((item) => ({ ...item, planId: 'old-plan' })),
    receipts.map((item) => ({ ...item, waypointCount: item.waypointCount + 1 }))];
  invalid.forEach((candidate) => {
    assert.equal(acceptedMissions(run.missions, candidate, run.snapshot!.drones, 'workflow-plan'), false);
    const state = { ...runtime.getStatus(), missionReceipts: candidate };
    const restored = new MockSwarmRuntime();
    restored.restore(config, run.missions, state);
    assert.throws(() => restored.markReady(), /先下发/);
    restored.dispose();
  });
  runtime.dispose();
});

test('重新生成、清除或离开取消下发，不遗留迟到回执', async () => {
  const runtime = new MockSwarmRuntime();
  const run = workflowRun(runtime);
  for (const action of ['clear', 'dispose'] as const) {
    runtime.initialize(config); runtime.loadMission(run.missions);
    const pending = runtime.uploadMission(run.missions, 'workflow-plan');
    const rejection = assert.rejects(pending, /取消/);
    if (action === 'clear') runtime.loadMission([]); else runtime.dispose();
    await rejection;
    assert.equal(runtime.getStatus().missionReceipts?.length ?? 0, 0);
  }
  runtime.initialize(config); runtime.loadMission(run.missions);
  const changed = structuredClone(run.missions);
  changed[0]!.waypoints[0] = toGeo([0, 0]);
  await assert.rejects(runtime.uploadMission(changed, 'wrong-plan'), /不匹配/);
  runtime.dispose();
});

function assertMissionGeometry(missions: SwarmMission[], area: ReturnType<typeof validateArea>, setting: SwarmConfig) {
  const rectangle = minimumCoverageRectangle(area, setting.sceneOrigin);
  const cross = (first: Point, second: Point, other: Point) => (second[0] - first[0]) * (other[1] - first[1]) - (second[1] - first[1]) * (other[0] - first[0]);
  const paths = missions.map((mission) => mission.waypoints.slice(mission.coverageStartIndex).map(toLocal));
  const segments = paths.flatMap((points) => points.slice(1).map((point, index): [Point, Point] => [points[index]!, point]));
  segments.forEach(([first, second], index) => segments.slice(index + 1).forEach(([start, end]) => {
    assert.equal(cross(first, second, start) * cross(first, second, end) < -0.0001 && cross(start, end, first) * cross(start, end, second) < -0.0001, false, '覆盖路径不得自身或跨机交叉');
  }));
  missions.forEach((mission) => {
    mission.coverageSegments.forEach(([first, second]) => {
      const start = rectangle.align(toLocal(first)); const end = rectangle.align(toLocal(second));
      assert.ok(Math.abs(start[1] - end[1]) < .001, '扫描必须平行最小外接矩形长边');
    });
    assert.equal(mission.coverageWaypointIndices!.length, mission.coverageSegments.length);
    mission.coverageSegments.forEach(([first, second], index) => {
      assert.deepEqual(mission.waypoints[mission.coverageWaypointIndices![index]!], second);
      const start = toLocal(first); const end = toLocal(second);
      for (let sample = 1; sample < 10; sample += 1) assert.ok(pointInPolygon([start[0] + (end[0] - start[0]) * sample / 10, start[1] + (end[1] - start[1]) * sample / 10], rectangle.polygon.coordinates[0]!.map(toLocal)));
    });
    const path = [mission.entryPath![0]!, ...mission.waypoints, ...mission.returnPath!.slice(1)];
    const boxes = mission.routingObstacles!;
    path.slice(1).forEach((point, index) => assert.equal(boxes.some((box) => segmentHitsBox(toLocal(path[index]!), toLocal(point), box)), false, '扫描、入场和返航均不得进入禁飞缓冲区'));
  });
  assert.doesNotThrow(() => assertPlanningSafe(area, [], setting, missions));
}

for (const angle of [-Math.PI / 5, Math.PI / 4, Math.PI / 2]) {
  test(`最小外接矩形包围所有顶点并保持旋转矩形面积 ${angle.toFixed(2)}`, () => {
    const rotate = ([east, north]: Point): Point => [east * Math.cos(angle) - north * Math.sin(angle), east * Math.sin(angle) + north * Math.cos(angle)];
    const vertices: Point[] = [[-100, -60], [100, -60], [100, 60], [-100, 60]];
    const area = validateArea(vertices.map((point) => toGeo(rotate(point))));
    const footprint = minimumCoverageRectangle(area);
    assert.ok(Math.abs(footprint.area - 24000) < .001, '不是放大的轴对齐包围盒');
    const left = footprint.aligned[0]![0]; const right = footprint.aligned[1]![0];
    const bottom = footprint.aligned[0]![1]; const top = footprint.aligned[2]![1];
    area.polygon.coordinates[0]!.forEach((point) => {
      const aligned = footprint.align(toLocal(point));
      assert.ok(aligned[0] >= left - .001 && aligned[0] <= right + .001 && aligned[1] >= bottom - .001 && aligned[1] <= top + .001);
      assert.ok(distance(footprint.unalign(aligned), toLocal(point)) < .001, '旋转与逆旋转保持原点');
    });
    const reversed = minimumCoverageRectangle(validateArea([...area.polygon.coordinates[0]!.slice(0, -1)].reverse()));
    assert.ok(Math.abs(reversed.area - footprint.area) < .001);
    assert.ok(Math.abs(reversed.angle - footprint.angle) < .001, '顶点顺序不改变扫描方向');
    assertMissionGeometry(planMissions(area, config), area, config);
  });
}

test('不规则顶点最小矩形面积等于所有候选边方向的最小值', () => {
  const vertices: Point[] = [[-180, 15], [-90, 45], [-40, -45], [-105, -105], [-170, -60]];
  const area = validateArea(vertices.map(toGeo));
  const footprint = minimumCoverageRectangle(area);
  let minimum = Infinity;
  vertices.forEach((first) => vertices.forEach((second) => {
    if (first === second) return;
    const angle = Math.atan2(second[1] - first[1], second[0] - first[0]);
    const east = vertices.map((point) => point[0] * Math.cos(angle) + point[1] * Math.sin(angle));
    const north = vertices.map((point) => -point[0] * Math.sin(angle) + point[1] * Math.cos(angle));
    minimum = Math.min(minimum, (Math.max(...east) - Math.min(...east)) * (Math.max(...north) - Math.min(...north)));
  }));
  assert.ok(Math.abs(footprint.area - minimum) < .001);
  assertMissionGeometry(planMissions(area, config), area, config);
});

test('旋转坐标超过500米但实际ENU合法的矩形可以规划', () => {
  const vertices: Point[] = [[350, 390], [390, 350], [450, 410], [410, 450]];
  const area = validateArea(vertices.map(toGeo));
  const footprint = minimumCoverageRectangle(area);
  assert.ok(footprint.aligned.some((point) => point.some((value) => Math.abs(value) > 500)));
  assertMissionGeometry(planMissions(area, { ...config, count: 2 }), area, { ...config, count: 2 });
});

for (const shape of ['triangle', 'rectangle', 'concave'] as const) {
  test(`${shape} 异形区域正交扫描、内部禁飞绕障、跨机不交叉`, () => {
    const vertices: Point[] = shape === 'triangle' ? [[-140, 0], [170, 0], [30, 250]] : shape === 'rectangle'
      ? [[-140, -20], [160, -20], [160, 268], [-140, 268]]
      : [[-100, 0], [180, 0], [180, 60], [60, 60], [60, 150], [180, 150], [180, 240], [-100, 240]];
    const setting = { ...config, spacing: 12 };
    const area = validateArea(vertices.map(toGeo));
    const zones = [validateArea(([[-20, 60], [20, 60], [20, 105], [-20, 105]] as Point[]).map(toGeo))];
    const missions = planMissions(area, setting, undefined, zones);
    assertMissionGeometry(missions, area, setting);
    assert.doesNotThrow(() => assertPlanningSafe(area, zones, setting, missions));
    assert.ok(missions.reduce((sum, mission) => sum + mission.assignedArea, 0) < minimumCoverageRectangle(area).area);
    const average = missions.reduce((sum, mission) => sum + mission.assignedArea, 0) / missions.length;
    missions.forEach((mission) => assert.ok(Math.abs(mission.assignedArea - average) < 0.1, '按扣除禁飞缓冲的可飞面积均分'));
  });
}

test('多个不规则禁飞区保守包络避让，覆盖分区保持正交安全', () => {
  const area = validateArea(([[-150, 0], [200, 0], [200, 290], [-150, 290]] as Point[]).map(toGeo));
  const zones = [validateArea(([[-60, 45], [-20, 50], [-35, 75]] as Point[]).map(toGeo)),
    validateArea(([[80, 155], [110, 155], [110, 190], [80, 190]] as Point[]).map(toGeo))];
  const missions = planMissions(area, { ...config, spacing: 12 }, undefined, zones);
  assertMissionGeometry(missions, area, { ...config, spacing: 12 });
  assert.doesNotThrow(() => assertPlanningSafe(area, zones, config, missions));
});

test('阻断全训练场和覆盖整个任务区域的禁飞区明确拒绝，不生成穿越路线', () => {
  const area = validateArea(rectangle);
  const blocked = validateArea(([[-500, -30], [500, -30], [500, -10], [-500, -10]] as Point[]).map(toGeo));
  assert.throws(() => planMissions(area, config, undefined, [blocked]), /无法|阻断/);
  const above = validateArea(([[-40, 40], [40, 40], [40, 100], [-40, 100]] as Point[]).map(toGeo));
  assert.throws(() => planMissions(above, config, undefined, [above]), /可覆盖区域不足/);
});

test('正交 A* 输出无斜线，保持拐点，不误判长航段的微小边界间隙', () => {
  const box: [number, number, number, number] = [-20, -10, 20, 10];
  const path = orthogonalRoute([-50, 0], [50, 0], [box]);
  assert.ok(path.length >= 4);
  path.slice(1).forEach((point, index) => {
    assert.equal(segmentHitsBox(path[index]!, point, box), false);
    assert.ok(path[index]![0] === point[0] || path[index]![1] === point[1]);
  });
  assert.equal(segmentHitsBox([160, 0], [20.0001, 0], box), false);
  assert.equal(segmentHitsBox([160, 0], [20, 0], box), true);
});

test('畅通转场直达，障碍绕行保留必要拐点且短于直角绕行', () => {
  const first: Point = [-40, -15];
  const second: Point = [40, 25];
  assert.deepEqual(shortestRoute(first, second, []), [first, second]);
  const box: [number, number, number, number] = [-8, -12, 8, 12];
  const path = shortestRoute(first, second, [box]);
  assert.ok(path.length > 2);
  assert.ok(routeLength(path) < routeLength(orthogonalRoute(first, second, [box])) - 1);
  path.slice(1).forEach((point, index) => assert.equal(segmentHitsBox(path[index]!, point, box), false));
  assert.deepEqual(shortestRoute(first, second, [[-8, 60, 8, 80]]), [first, second]);
  assert.throws(() => shortestRoute([-600, 0], second, []), /训练范围/);
  assert.throws(() => shortestRoute([0, 0], second, [box]), /缓冲区/);
});

test('边界相切、多个禁飞缓冲与封闭训练范围不被直线简化穿越', () => {
  const boxes: [number, number, number, number][] = [[-12, -8, -2, 8], [2, -8, 12, 8]];
  const path = shortestRoute([-30, 8], [30, 8], boxes);
  assert.ok(path.length > 2);
  path.slice(1).forEach((point, index) => assert.equal(boxes.some((box) => segmentHitsBox(path[index]!, point, box)), false));
  assert.throws(() => shortestRoute([-30, 0], [30, 0], [[-2, -500, 2, 500]]), /无法/);
});

test('斜边区域保持蛇形扫描，行间直接衔接，区外无障碍进出均为直线', () => {
  const setting = { ...config, altitude: 20, speed: 10, spacing: 10 };
  const area = validateArea(([[-185, 0], [-90, -10], [-64, -110], [-175, -110]] as Point[]).map(toGeo));
  const zone = validateArea(([[-26, -86], [0, -86], [0, -108], [-26, -108]] as Point[]).map(toGeo));
  const runtime = new MockSwarmRuntime();
  const fleet = runtime.initialize(setting).drones;
  const missions = planMissions(area, setting, fleet, [zone]);
  missions.forEach((mission) => {
    assert.equal(mission.entryPath!.length, 2);
    assert.equal(mission.returnPath!.length, 2);
    assert.equal(mission.waypoints.length, mission.coverageSegments.length * 2, '斜边衔接不插入人为直角拐点');
    assert.ok(mission.estimatedDuration > mission.plannedDistance / setting.speed);
    assert.equal(routeIntersectsNoFly(completeMissionPath(mission), [zone]), false);
  });
  assertMissionGeometry(missions, area, setting);
  runtime.dispose();
});

test('扫描方向同时比较实际入场与返航成本，不只选择最近入场点', () => {
  const setting = { ...config, count: 2, spacing: 20 };
  const area = validateArea(([[-100, 0], [100, 0], [100, 60], [-100, 60]] as Point[]).map(toGeo));
  const runtime = new MockSwarmRuntime();
  const fleet = runtime.initialize(setting).drones;
  fleet[0]!.position = toGeo([110, -10]);
  fleet[0]!.homePosition = toGeo([-110, 100]);
  fleet[1]!.position = toGeo([250, -80]);
  fleet[1]!.homePosition = fleet[1]!.position;
  const mission = planMissions(area, setting, fleet)[0]!;
  const coverage = mission.waypoints.slice(mission.coverageStartIndex).map(toLocal);
  const first = toLocal(fleet[0]!.position);
  const home = toLocal(fleet[0]!.homePosition);
  const chosen = distance(first, coverage[0]!) + distance(coverage.at(-1)!, home);
  const alternatives = [coverage, [...coverage].reverse(), coverage.map(([east, north]): Point => [-east, north]),
    [...coverage].reverse().map(([east, north]): Point => [-east, north])];
  const best = Math.min(...alternatives.map((path) => distance(first, path[0]!) + distance(path.at(-1)!, home)));
  assert.ok(Math.abs(chosen - best) < .001);
  runtime.dispose();
});

test('安全检查按完整线段间距识别跨机冲突，不只检查顶点或服务 Home', () => {
  assert.equal(segmentDistance([[0, 0], [20, 0]], [[10, -10], [10, 10]]), 0);
  assert.equal(segmentDistance([[0, 0], [20, 0]], [[5, 7], [15, 7]]), 7);
  const area = validateArea(rectangle);
  const missions = planMissions(area, config);
  const invalid = structuredClone(missions);
  invalid[1]!.waypoints = structuredClone(invalid[0]!.waypoints);
  invalid[1]!.coverageStartIndex = invalid[0]!.coverageStartIndex;
  assert.throws(() => assertPlanningSafe(area, [], config, invalid), /安全间距/);
});

for (const { count, blocked, angle = 0 } of [{ count: 2, blocked: false }, { count: 3, blocked: false }, { count: 3, blocked: true },
  { count: 4, blocked: false }, { count: 5, blocked: false }, { count: 3, blocked: false, angle: Math.PI / 6 }, { count: 3, blocked: true, angle: Math.PI / 6 }]) {
  test(`${count} 架逐机入场、并行扫描、逐机返航保持连续运动安全间距（禁飞绕障 ${blocked}，旋转 ${angle.toFixed(2)}）`, async () => {
    const setting = { ...config, count, altitude: 20, speed: 10, spacing: 10 };
    const rotate = ([east, north]: Point): Point => [east * Math.cos(angle) - north * Math.sin(angle), east * Math.sin(angle) + north * Math.cos(angle)];
    const area = validateArea(([[-185, 0], [-90, -10], [-64, -110], [-175, -110]] as Point[]).map((point) => toGeo(rotate(point))));
    const zones = blocked ? [validateArea(([[-96, -72], [-80, -72], [-80, -48], [-96, -48]] as Point[]).map((point) => toGeo(rotate(point))))] : [];
    const runtime = new MockSwarmRuntime();
    const missions = planMissions(area, setting, runtime.initialize(setting).drones, zones);
    runtime.loadMission(missions);
    await runtime.uploadMission(missions, 'phase-safety-plan');
    runtime.markReady(); runtime.takeoff(); runtime.stop();
    for (let index = 0; index < 200 && runtime.getStatus().status !== 'HOLDING'; index += 1) runtime.tick(.2);
    assert.equal(runtime.getStatus().status, 'HOLDING');
    runtime.startMission();
    for (let step = 0; step < 4000 && runtime.getStatus().status !== 'COMPLETED'; step += 1) {
      const before = runtime.getFleet();
      const entering = before.find((drone) => drone.state === 'RUNNING' && drone.waypointIndex <= missions.find((mission) => mission.droneId === drone.droneId)!.coverageStartIndex!);
      runtime.tick(.2);
      const after = runtime.getFleet();
      if (entering) before.filter((drone) => drone.droneId !== entering.droneId).forEach((drone) => {
        assert.deepEqual(after.find((other) => other.droneId === drone.droneId)!.position, drone.position, '入场期间其他无人机应等待，不沿扫描线移动');
      });
      if (before.some((drone) => drone.state === 'RUNNING')) before.filter((drone) => drone.state === 'RETURNING').forEach((drone) => {
        assert.deepEqual(after.find((other) => other.droneId === drone.droneId)!.position, drone.position, '覆盖未全部完成时正常返航应等待');
      });
      before.forEach((drone, index) => before.slice(index + 1).forEach((other, offset) => {
        const otherIndex = index + offset + 1;
        const from = toLocal(drone.position);
        const otherFrom = toLocal(other.position);
        const end = toLocal(after[index]!.position);
        const otherEnd = toLocal(after[otherIndex]!.position);
        const relative = [from[0] - otherFrom[0], from[1] - otherFrom[1], drone.altitude - other.altitude];
        const velocity = [end[0] - otherEnd[0] - relative[0]!, end[1] - otherEnd[1] - relative[1]!, after[index]!.altitude - after[otherIndex]!.altitude - relative[2]!];
        const squared = velocity.reduce((sum, value) => sum + value * value, 0);
        const along = squared > 0 ? Math.max(0, Math.min(1, -relative.reduce((sum, value, axis) => sum + value * velocity[axis]!, 0) / squared)) : 0;
        const closest = Math.hypot(...relative.map((value, axis) => value + along * velocity[axis]!));
        assert.ok(closest >= setting.safety - .001, `连续运动最小间距 ${closest.toFixed(3)} m`);
      }));
    }
    assert.equal(runtime.getStatus().status, 'COMPLETED');
    runtime.getFleet().forEach((drone) => {
      assert.equal(routeIntersectsNoFly(drone.trajectory, zones), false);
      assert.ok(Math.abs(routeLength(drone.trajectory.map(toLocal)) - missions.find((mission) => mission.droneId === drone.droneId)!.plannedDistance) < .05);
      assert.deepEqual(drone.position, drone.homePosition);
    });
    runtime.dispose();
  });
}

test('禁飞缓冲截断狭窄作业带时明确拒绝，不借道其他无人机分区', () => {
  const setting = { ...config, count: 5, spacing: 10 };
  const area = validateArea(([[-185, 0], [-90, -10], [-64, -110], [-175, -110]] as Point[]).map(toGeo));
  const zone = validateArea(([[-96, -72], [-80, -72], [-80, -48], [-96, -48]] as Point[]).map(toGeo));
  assert.throws(() => planMissions(area, setting, undefined, [zone]), /被禁飞区阻断/);
});

test('单机提前返航优先执行，其余扫描等待，落地后继续而不是互相穿越', async () => {
  const runtime = new MockSwarmRuntime();
  const missions = planMissions(validateArea(rectangle), config, runtime.initialize(config).drones);
  runtime.loadMission(missions); await runtime.uploadMission(missions, 'urgent-return-plan'); runtime.markReady(); runtime.takeoff(); runtime.stop();
  for (let index = 0; index < 100 && runtime.getStatus().status !== 'HOLDING'; index += 1) runtime.tick(.2);
  runtime.startMission();
  for (let index = 0; index < 1000 && !runtime.getFleet().some((drone) => drone.completedSegments > 0); index += 1) runtime.tick(.2);
  const requested = runtime.getFleet().find((drone) => drone.state === 'RUNNING' && drone.progress < 100)!;
  assert.ok(requested);
  runtime.returnDroneToHome(requested.droneId);
  const waiting = runtime.getFleet().filter((drone) => drone.droneId !== requested.droneId);
  for (let index = 0; index < 1000 && runtime.getFleet().find((drone) => drone.droneId === requested.droneId)!.state !== 'LANDED'; index += 1) {
    runtime.tick(.2);
    waiting.forEach((drone) => assert.deepEqual(runtime.getFleet().find((other) => other.droneId === drone.droneId)!.position, drone.position));
  }
  assert.equal(runtime.getFleet().find((drone) => drone.droneId === requested.droneId)!.state, 'LANDED');
  runtime.tick(.2);
  assert.ok(waiting.some((drone) => distance(toLocal(runtime.getFleet().find((other) => other.droneId === drone.droneId)!.position), toLocal(drone.position)) > .01));
  runtime.dispose();
});

for (const early of [false, true]) {
  test(`${early ? '提前' : '正常'}禁飞绕障返航及返航检查点恢复`, async () => {
    const setting = { ...config, count: 2 };
    const area = validateArea(([[-100, 40], [100, 40], [100, 130], [-100, 130]] as Point[]).map(toGeo));
    const zone = validateArea(([[-150, -20], [150, -20], [150, 20], [-150, 20]] as Point[]).map(toGeo));
    const runtime = new MockSwarmRuntime();
    const fleet = runtime.initialize(setting).drones;
    const missions = planMissions(area, setting, fleet, [zone]);
    runtime.loadMission(missions); await runtime.uploadMission(missions, 'test-plan'); runtime.markReady(); runtime.takeoff();
    for (let index = 0; index < 50; index += 1) runtime.tick(.5);
    runtime.startMission();
    for (let index = 0; index < 2000; index += 1) {
      runtime.tick(.5);
      if (early ? runtime.getFleet().some((drone) => drone.completedSegments > 1) : runtime.getFleet().some((drone) => drone.state === 'RETURNING')) break;
    }
    if (early) runtime.returnToHome();
    runtime.stop();
    const snapshot = runtime.getStatus();
    assert.ok(snapshot.drones.some((drone) => drone.returnWaypoints?.length));
    const restored = new MockSwarmRuntime();
    assert.deepEqual(restored.restore(setting, missions, snapshot), snapshot);
    for (let index = 0; index < 5000 && !['COMPLETED', 'ABORTED'].includes(restored.getStatus().status); index += 1) restored.tick(.5);
    assert.equal(restored.getStatus().status, early ? 'ABORTED' : 'COMPLETED');
    restored.getFleet().forEach((drone) => {
      assert.equal(routeIntersectsNoFly(drone.trajectory, [zone]), false, '实际执行轨迹（含返航）不得穿越禁飞区');
      assert.deepEqual(drone.position, drone.homePosition);
    });
    runtime.dispose(); restored.dispose();
  });
}

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

for (const count of [2, 3, 4, 5, 6]) {
  test(`${count} 机分配唯一覆盖航线并完成生命周期`, async () => {
    const setting = { ...config, count };
    const missions = planMissions(validateArea(rectangle), setting);
    assert.equal(missions.length, count);
    assert.equal(new Set(missions.map((mission) => mission.droneId)).size, count);
    assert.equal(new Set(missions.map((mission) => mission.assignedColor)).size, count);
    assert.ok(missions.every((mission) => mission.coverageSegments.length > 0 && mission.plannedDistance > 0));
    const runtime = new MockSwarmRuntime();
    const snapshot = runtime.initialize(setting);
    assert.equal(snapshot.drones.at(-1)?.droneId, `UAV-${String(count).padStart(2, '0')}`);
    assert.equal(new Set(snapshot.drones.map((drone) => drone.sysId)).size, count);
    assert.doesNotThrow(() => assertPlanningSafe(validateArea(rectangle), [], setting, missions, snapshot.drones));
    runtime.loadMission(missions); await runtime.uploadMission(missions, 'test-plan');
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

test('暂停保持位置，恢复插值前进，提前返航保留覆盖缺口', async () => {
  const runtime = new MockSwarmRuntime();
  runtime.initialize(config);
  const missions = planMissions(validateArea(rectangle), config);
  runtime.loadMission(missions); await runtime.uploadMission(missions, 'test-plan');
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

for (const angle of [0, Math.PI / 6, Math.PI / 3]) {
  test(`最小矩形方向扫描、面积均分、无重复航段（旋转 ${Math.round(angle * 180 / Math.PI)}°）`, () => {
    const rotate = ([east, north]: [number, number]): [number, number] => [east * Math.cos(angle) - north * Math.sin(angle), east * Math.sin(angle) + north * Math.cos(angle)];
    const area = validateArea(([[-100, -60], [100, -60], [100, 60], [-100, 60]] as [number, number][]).map((point) => toGeo(rotate(point))));
    const missions = planMissions(area, config);
    const regions = partitionSwarmArea(area, config.count);
    const footprint = minimumCoverageRectangle(area);
    assert.ok(Math.abs(missions.reduce((sum, mission) => sum + mission.assignedArea, 0) - area.area) < 0.01);
    assert.ok(regions.every((region) => Math.abs(region.area - area.area / config.count) < 0.01));
    const allSegments = missions.flatMap((mission) => mission.coverageSegments);
    const signatures = allSegments.map((segment) => segment.map((point) => toLocal(point).map((value) => value.toFixed(3)).join(',')).sort().join('|'));
    assert.equal(new Set(signatures).size, allSegments.length);
    missions.forEach((mission, index) => {
      const polygon = regions[index]!.polygon.coordinates[0]!.map(toLocal);
      mission.coverageSegments.forEach(([first, second], position) => {
        const start = toLocal(first); const end = toLocal(second);
        assert.ok(Math.abs(footprint.align(start)[1] - footprint.align(end)[1]) < .001, '沿最小矩形长边扫描');
        assert.ok(distance(start, end) > 0);
        assert.ok(pointInPolygon([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], polygon));
        if (position > 0) {
          const previous = mission.coverageSegments[position - 1]!;
          const previousStart = toLocal(previous[0]); const previousEnd = toLocal(previous[1]);
          assert.ok((end[0] - start[0]) * (previousEnd[0] - previousStart[0]) + (end[1] - start[1]) * (previousEnd[1] - previousStart[1]) < 0, '相邻扫描线反向');
          assert.ok(Math.abs(footprint.align(previousEnd)[1] - footprint.align(start)[1]) <= config.spacing + 0.01, '相邻扫描行的横向间距不超出设定值');
        }
      });
    });
    missions.slice(1).forEach((mission, index) => {
      const previous = missions[index]!;
      assert.ok(Math.min(...mission.waypoints.slice(mission.coverageStartIndex).flatMap((point) => previous.waypoints.slice(previous.coverageStartIndex).map((other) => distance(toLocal(point), toLocal(other))))) >= config.safety - 0.01);
    });
  });
}

test('规划 Home 不覆盖服务初始位置，规划使用服务编号、位置和返航点', () => {
  const homePosition = toGeo([-100, -100]);
  const setting = { ...config, homePosition };
  const runtime = new MockSwarmRuntime();
  const snapshot = runtime.initialize(setting);
  assert.notDeepEqual(snapshot.drones[0]!.homePosition, homePosition);
  assert.ok(Math.abs(distance(toLocal(snapshot.drones[0]!.position), toLocal(snapshot.drones[1]!.position)) - 14) < 0.01);
  const area = validateArea(rectangle);
  snapshot.drones[0]!.droneId = 'SERVICE-UAV-07';
  snapshot.drones[0]!.position = toGeo([-80, -70]);
  const missions = planMissions(area, setting, snapshot.drones);
  assert.equal(missions[0]!.droneId, 'SERVICE-UAV-07');
  assert.deepEqual(missions, planMissions(area, { ...setting, homePosition: toGeo([200, 200]) }, snapshot.drones));
  missions.forEach((mission, index) => {
    const path = [snapshot.drones[index]!.position, ...mission.waypoints, ...mission.returnPath!.slice(1)].map(toLocal);
    const expected = path.slice(1).reduce((sum, point, position) => sum + distance(path[position]!, point), 0);
    assert.ok(Math.abs(expected - mission.plannedDistance) < 0.001);
  });
  runtime.dispose();
});

for (const phase of ['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING'] as const) {
  test(`${phase} 完整检查点恢复，不重置时间、轨迹、电量或航点`, async () => {
    const runtime = new MockSwarmRuntime();
    const missions = planMissions(validateArea(rectangle), config);
    runtime.initialize(config); runtime.loadMission(missions); await runtime.uploadMission(missions, 'test-plan'); runtime.markReady(); runtime.takeoff();
    runtime.tick(0.5);
    if (phase !== 'TAKING_OFF') {
      for (let index = 0; index < 50; index += 1) runtime.tick(0.5);
      if (phase !== 'HOLDING') { runtime.startMission(); for (let index = 0; index < 20; index += 1) runtime.tick(0.5); }
      if (phase === 'PAUSED') runtime.pauseMission();
      if (phase === 'RETURNING') runtime.returnToHome();
    }
    const checkpoint = runtime.getStatus();
    assert.equal(checkpoint.status, phase);
    runtime.dispose();
    const restored = new MockSwarmRuntime();
    assert.deepEqual(restored.restore(config, missions, checkpoint), checkpoint);
    restored.stop();
    const before = restored.getStatus(); restored.tick(0.5);
    if (phase === 'PAUSED') assert.deepEqual(restored.getStatus(), before);
    else assert.equal(restored.getStatus().elapsed, checkpoint.elapsed + 0.5);
    assert.ok(restored.getFleet().every((drone, index) => drone.battery <= checkpoint.drones[index]!.battery));
    restored.dispose();
  });
}

test('恢复旧中断草稿可继续执行并完成任务', async () => {
  const runtime = new MockSwarmRuntime();
  const missions = planMissions(validateArea(rectangle), config);
  runtime.initialize(config); runtime.loadMission(missions); await runtime.uploadMission(missions, 'test-plan'); runtime.markReady(); runtime.takeoff();
  for (let index = 0; index < 50; index += 1) runtime.tick(0.5);
  runtime.startMission(); runtime.tick(0.5);
  const checkpoint = { ...runtime.getStatus(), interrupted: true };
  runtime.dispose(); runtime.restore(config, missions, checkpoint); runtime.stop();
  assert.equal(runtime.getStatus().interrupted, undefined);
  for (let index = 0; index < 1000 && runtime.getStatus().status !== 'COMPLETED'; index += 1) runtime.tick(0.5);
  assert.equal(runtime.getStatus().coverage, 100);
  assert.equal(runtime.getStatus().status, 'COMPLETED');
  runtime.dispose();
});

test('凹形边界扩展为最小矩形，生成规则蛇形并完成模拟', async () => {
  const vertices: [number, number][] = [[0, 0], [240, 0], [240, 50], [60, 50], [60, 130], [240, 130], [240, 180], [0, 180]];
  const setting = { ...config, count: 2, spacing: 8 };
  const area = validateArea(vertices.map(toGeo));
  const missions = planMissions(area, setting);
  const footprint = minimumCoverageRectangle(area);
  assert.ok(Math.abs(footprint.area - 240 * 180) < .001);
  assert.ok(footprint.area > area.area, '覆盖面积明确扩展到外接矩形');
  assertMissionGeometry(missions, area, setting);
  missions.forEach((mission) => {
    assert.equal(mission.coverageWaypointIndices?.length, mission.coverageSegments.length);
    assert.equal(mission.waypoints.slice(mission.coverageStartIndex).length, mission.coverageSegments.length * 2, '不再沿凹口插入绕角航点');
    mission.coverageSegments.forEach(([first, second]) => assert.ok(Math.abs(distance(toLocal(first), toLocal(second)) - 240) < .001));
  });
  const runtime = new MockSwarmRuntime();
  runtime.initialize(setting); runtime.loadMission(missions); await runtime.uploadMission(missions, 'test-plan'); runtime.markReady(); runtime.takeoff();
  for (let index = 0; index < 50; index += 1) runtime.tick(0.5);
  runtime.startMission();
  for (let index = 0; index < 4000 && runtime.getStatus().status !== 'COMPLETED'; index += 1) runtime.tick(0.5);
  assert.equal(runtime.getStatus().coverage, 100);
  assert.equal(runtime.getStatus().status, 'COMPLETED');
  runtime.dispose();
});

test('允许区域与禁飞区包含/相交；校验实际路线及服务起降点', () => {
  const area = validateArea(rectangle);
  const inner = validateArea([toGeo([-10, -10]), toGeo([10, -10]), toGeo([10, 10]), toGeo([-10, 10])]);
  const outer = validateArea([toGeo([-100, -100]), toGeo([100, -100]), toGeo([100, 100]), toGeo([-100, 100])]);
  const touching = validateArea([toGeo([35, -20]), toGeo([55, -20]), toGeo([55, 20]), toGeo([35, 20])]);
  const clear = validateArea([toGeo([150, 150]), toGeo([180, 150]), toGeo([180, 180]), toGeo([150, 180])]);
  const crossing = validateArea([toGeo([-50, -5]), toGeo([50, -5]), toGeo([50, 5]), toGeo([-50, 5])]);
  for (const zone of [inner, outer, touching, crossing]) assert.equal(areaOverlapsNoFly(area, [zone]), true);
  assert.equal(areaOverlapsNoFly(area, [clear]), false);
  assert.equal(areaOverlapsNoFly(area, []), false);
  for (const zone of [inner, touching]) assert.doesNotThrow(() => assertPlanningSafe(area, [zone], config));
  assert.throws(() => assertPlanningSafe(area, [outer], config), /禁飞区/);
  assert.doesNotThrow(() => assertPlanningSafe(area, [clear], config, planMissions(area, config)));
  const runtime = new MockSwarmRuntime();
  const fleet = runtime.initialize(config).drones;
  assert.throws(() => assertPlanningSafe(area, [clear], { ...config, homePosition: toGeo([160, 160]) }, [], fleet), /Home.*禁飞区/);
  runtime.dispose();
  assert.equal(routeIntersectsNoFly([toGeo([0, -30]), toGeo([0, 30])], [inner]), true);
  assert.equal(routeIntersectsNoFly([toGeo([-20, -20]), toGeo([-20, 30])], [inner]), false);
});

test('拒绝穿越禁飞区的起降转场航线和禁飞区内的 Home', () => {
  const area = validateArea([toGeo([-40, 40]), toGeo([40, 40]), toGeo([40, 100]), toGeo([-40, 100])]);
  const barrier = validateArea([toGeo([-150, -20]), toGeo([150, -20]), toGeo([150, 20]), toGeo([-150, 20])]);
  assert.throws(() => assertPlanningSafe(area, [barrier], config, planMissions(area, config)), /航线穿越/);
  const avoided = planMissions(area, config, undefined, [barrier]);
  assert.doesNotThrow(() => assertPlanningSafe(area, [barrier], config, avoided));
  assert.ok(avoided.every((mission) => mission.entryPath!.length > 2 && mission.returnPath!.length > 2));
  assert.throws(() => assertPlanningSafe(area, [barrier], { ...config, homePosition: toGeo([0, 0]) }), /禁飞区/);
});

test('规划拒绝非有限参数、非整数机数及过窄分区', () => {
  const area = validateArea(rectangle);
  assert.throws(() => planMissions(area, { ...config, count: 2.5 }), /数量/);
  assert.throws(() => planMissions(area, { ...config, spacing: NaN }), /间距/);
  assert.throws(() => planMissions(area, { ...config, spacing: 3 }), /安全间距/);
  assert.throws(() => planMissions(validateArea([toGeo([0, 0]), toGeo([100, 0]), toGeo([100, 10]), toGeo([0, 10])]), config), /过窄/);
  assert.deepEqual(partitionSwarmArea(area, 0), []);
});

test('高清校园场景独立 ENU 坐标系，兼容旧场景且模拟航程一致', async () => {
  const frame = swarmFrame(campusOrigin);
  const setting = { ...config, sceneOrigin: campusOrigin, homePosition: frame.toGeo([-48, -52]) };
  const area = validateArea([frame.toGeo([-35, -20]), frame.toGeo([35, -20]), frame.toGeo([35, 30]), frame.toGeo([-35, 30])], campusOrigin);
  assert.ok(Math.abs(area.area - 3500) < 0.01);
  const regions = partitionSwarmArea(area, 3, campusOrigin);
  const missions = planMissions(area, setting);
  assert.ok(Math.abs(regions.reduce((sum, region) => sum + region.area, 0) - area.area) < 0.01);
  assert.doesNotThrow(() => assertPlanningSafe(area, [], setting, missions));
  const runtime = new MockSwarmRuntime();
  runtime.initialize(setting); runtime.loadMission(missions); await runtime.uploadMission(missions, 'test-plan'); runtime.markReady(); runtime.takeoff();
  for (let index = 0; index < 100; index += 1) runtime.tick(0.5);
  runtime.startMission();
  for (let index = 0; index < 1500 && runtime.getStatus().status !== 'COMPLETED'; index += 1) runtime.tick(0.5);
  assert.equal(runtime.getStatus().status, 'COMPLETED');
  assert.equal(runtime.getStatus().coverage, 100);
  assert.deepEqual(runtime.getFleet()[0]!.homePosition, frame.toGeo([-48, -52]));
  runtime.dispose();
});
