import { distance, homes, swarmFrame } from './swarmGeometry';
import { minimumCoverageRectangle } from './swarmCoverage';
import { routeLength, shortestRoute, segmentDistance, segmentHitsBox, type RoutingBox, type RoutingSegment } from './swarmRouting';
import type { Point, SwarmArea, SwarmConfig, SwarmDrone, SwarmMission, SwarmRegion } from '../types/swarm';

export const swarmColors = ['#18baff', '#3ee7b1', '#ffb547', '#b994ff', '#ff728d', '#f2d56b'];
const epsilon = 0.0001;
const polygonArea = (polygon: Point[]) => Math.abs(polygon.reduce((sum, point, index) => {
  const next = polygon[(index + 1) % polygon.length]!;
  return sum + point[0] * next[1] - next[0] * point[1];
}, 0)) / 2;

function clip(polygon: Point[], limit: number, above: boolean): Point[] {
  const result: Point[] = [];
  polygon.forEach((point, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    const contains = above ? point[1] >= limit : point[1] <= limit;
    const contained = above ? previous[1] >= limit : previous[1] <= limit;
    if (contains !== contained) {
      const ratio = (limit - previous[1]) / (point[1] - previous[1]);
      result.push([previous[0] + ratio * (point[0] - previous[0]), limit]);
    }
    if (contains) result.push(point);
  });
  return result;
}

function scanIntervals(polygon: Point[], north: number, obstacles: RoutingBox[] = []): [number, number][] {
  const crossings: number[] = [];
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    if ((point[1] <= north && next[1] > north) || (next[1] <= north && point[1] > north)) {
      crossings.push(point[0] + (north - point[1]) * (next[0] - point[0]) / (next[1] - point[1]));
    }
  });
  crossings.sort((left, right) => left - right);
  let intervals: [number, number][] = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) intervals.push([crossings[index]!, crossings[index + 1]!]);
  for (const box of obstacles) {
    if (north < box[1] - epsilon || north > box[3] + epsilon) continue;
    intervals = intervals.flatMap(([start, end]): [number, number][] => {
      if (end < box[0] - epsilon || start > box[2] + epsilon) return [[start, end]];
      const result: [number, number][] = [];
      if (start < box[0] - epsilon) result.push([start, box[0] - epsilon]);
      if (end > box[2] + epsilon) result.push([box[2] + epsilon, end]);
      return result;
    });
  }
  return intervals.filter(([start, end]) => end - start > epsilon);
}

function usableArea(polygon: Point[], obstacles: RoutingBox[], maximum = Infinity): number {
  const levels = polygon.map((point) => point[1]);
  obstacles.forEach((box) => {
    levels.push(box[1], box[3]);
    polygon.forEach((point, index) => {
      const next = polygon[(index + 1) % polygon.length]!;
      for (const east of [box[0], box[2]]) {
        if ((point[0] < east && next[0] > east) || (next[0] < east && point[0] > east)) {
          levels.push(point[1] + (east - point[0]) * (next[1] - point[1]) / (next[0] - point[0]));
        }
      }
    });
  });
  levels.sort((left, right) => left - right);
  let total = 0;
  for (let index = 1; index < levels.length; index += 1) {
    const lower = levels[index - 1]!;
    const upper = Math.min(levels[index]!, maximum);
    if (upper > lower) total += (upper - lower) * scanIntervals(polygon, (lower + upper) / 2, obstacles).reduce((sum, [start, end]) => sum + end - start, 0);
  }
  return total;
}

function partition(area: SwarmArea, count: number, sceneOrigin?: Point, obstacles: RoutingBox[] = []) {
  const { toGeo } = swarmFrame(sceneOrigin);
  const rectangle = minimumCoverageRectangle(area, sceneOrigin);
  const transform = rectangle.align;
  const aligned = rectangle.aligned;
  const boxes: RoutingBox[] = obstacles.map((box) => {
    const corners: Point[] = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
    const rotated = corners.map(transform);
    return [Math.min(...rotated.map((point) => point[0])), Math.min(...rotated.map((point) => point[1])),
      Math.max(...rotated.map((point) => point[0])), Math.max(...rotated.map((point) => point[1]))];
  });
  const min = Math.min(...aligned.map((point) => point[1]));
  const max = Math.max(...aligned.map((point) => point[1]));
  const total = usableArea(aligned, boxes);
  if (total < 100) throw new Error('扣除禁飞缓冲区后可覆盖区域不足，请调整禁飞区或任务边界');
  const boundaries = [min];
  for (let index = 1; index < count; index += 1) {
    let lower = min;
    let upper = max;
    for (let iteration = 0; iteration < 45; iteration += 1) {
      const middle = (lower + upper) / 2;
      if (usableArea(aligned, boxes, middle) < total * index / count) lower = middle;
      else upper = middle;
    }
    boundaries.push((lower + upper) / 2);
  }
  boundaries.push(max);
  const polygons = Array.from({ length: count }, (_, index) => clip(clip(aligned, boundaries[index]!, true), boundaries[index + 1]!, false));
  return { polygons, aligned, boxes, boundaries, transform, restore: (point: Point) => toGeo(rectangle.unalign(point)) };
}

export function partitionSwarmArea(area: SwarmArea, count: number, sceneOrigin?: Point): SwarmRegion[] {
  if (!Number.isInteger(count) || count < 2 || count > 6) return [];
  const { polygons, restore } = partition(area, count, sceneOrigin);
  return polygons.map((polygon, index) => ({
    name: `${String.fromCharCode(65 + index)}区`, color: swarmColors[index]!, area: polygonArea(polygon),
    polygon: { type: 'Polygon', coordinates: [[...polygon.map(restore), restore(polygon[0]!)]] },
  }));
}

export function missionRegions(run: { area: SwarmArea | null; config: SwarmConfig; missions: SwarmMission[] }): SwarmRegion[] {
  if (!run.area || !run.missions.length) return [];
  const fallback = partitionSwarmArea(run.area, run.config.count, run.config.sceneOrigin);
  return run.missions.map((mission, index) => ({ name: `${String.fromCharCode(65 + index)}区`, color: mission.assignedColor,
    area: mission.assignedArea, polygon: mission.assignedPolygon ?? fallback[index]!.polygon }));
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let contained = false;
  polygon.forEach((first, index) => {
    const second = polygon[(index + 1) % polygon.length]!;
    if ((first[1] > point[1]) !== (second[1] > point[1]) && point[0] < (second[0] - first[0]) * (point[1] - first[1]) / (second[1] - first[1]) + first[0]) contained = !contained;
  });
  return contained;
}

function segmentTouches(first: Point, second: Point, start: Point, end: Point): boolean {
  const cross = (point: Point, next: Point, other: Point) => (next[0] - point[0]) * (other[1] - point[1]) - (next[1] - point[1]) * (other[0] - point[0]);
  const onSegment = (point: Point, startPoint: Point, endPoint: Point) => Math.abs(cross(startPoint, endPoint, point)) < epsilon
    && point[0] >= Math.min(startPoint[0], endPoint[0]) - epsilon && point[0] <= Math.max(startPoint[0], endPoint[0]) + epsilon
    && point[1] >= Math.min(startPoint[1], endPoint[1]) - epsilon && point[1] <= Math.max(startPoint[1], endPoint[1]) + epsilon;
  return cross(first, second, start) * cross(first, second, end) < 0 && cross(start, end, first) * cross(start, end, second) < 0
    || onSegment(first, start, end) || onSegment(second, start, end) || onSegment(start, first, second) || onSegment(end, first, second);
}

function segmentInside(first: Point, second: Point, polygon: Point[]): boolean {
  const direction: Point = [second[0] - first[0], second[1] - first[1]];
  const parameters = [0, 1];
  polygon.forEach((start, index) => {
    const end = polygon[(index + 1) % polygon.length]!;
    const edge: Point = [end[0] - start[0], end[1] - start[1]];
    const denominator = direction[0] * edge[1] - direction[1] * edge[0];
    if (Math.abs(denominator) < epsilon) return;
    const offset: Point = [start[0] - first[0], start[1] - first[1]];
    const along = (offset[0] * edge[1] - offset[1] * edge[0]) / denominator;
    const across = (offset[0] * direction[1] - offset[1] * direction[0]) / denominator;
    if (along > 0 && along < 1 && across >= 0 && across <= 1) parameters.push(along);
  });
  parameters.sort((left, right) => left - right);
  return parameters.slice(1).every((end, index) => {
    const middle = (parameters[index]! + end) / 2;
    const point: Point = [first[0] + direction[0] * middle, first[1] + direction[1] * middle];
    return pointInPolygon(point, polygon) || polygon.some((start, edge) => segmentTouches(point, point, start, polygon[(edge + 1) % polygon.length]!));
  });
}

export function routeIntersectsNoFly(points: Point[], zones: SwarmArea[], sceneOrigin?: Point): boolean {
  const { toLocal } = swarmFrame(sceneOrigin);
  const route = points.map(toLocal);
  return zones.some((zone) => {
    const polygon = zone.polygon.coordinates[0]!.slice(0, -1).map(toLocal);
    return route.some((point) => pointInPolygon(point, polygon)) || route.slice(1).some((point, index) =>
      polygon.some((start, edge) => segmentTouches(route[index]!, point, start, polygon[(edge + 1) % polygon.length]!)));
  });
}

export function areaOverlapsNoFly(area: SwarmArea, zones: SwarmArea[], sceneOrigin?: Point): boolean {
  if (!zones.length) return false;
  const boundary = area.polygon.coordinates[0]!;
  const { toLocal } = swarmFrame(sceneOrigin);
  const areaPolygon = boundary.slice(0, -1).map(toLocal);
  return routeIntersectsNoFly(boundary, zones, sceneOrigin) || zones.some((zone) =>
    zone.polygon.coordinates[0]!.slice(0, -1).some((point) => pointInPolygon(toLocal(point), areaPolygon)));
}

function obstacleBoxes(zones: SwarmArea[], config: SwarmConfig): RoutingBox[] {
  const { toLocal } = swarmFrame(config.sceneOrigin);
  return zones.map((zone) => {
    const polygon = zone.polygon.coordinates[0]!.map(toLocal);
    const margin = config.safety / 2;
    return [Math.min(...polygon.map((point) => point[0])) - margin, Math.min(...polygon.map((point) => point[1])) - margin,
      Math.max(...polygon.map((point) => point[0])) + margin, Math.max(...polygon.map((point) => point[1])) + margin];
  });
}

function waitingBoxes(missions: SwarmMission[], index: number, config: SwarmConfig, phase: 'entry' | 'return', fleet?: SwarmDrone[]): RoutingBox[] {
  const { toLocal } = swarmFrame(config.sceneOrigin);
  const initial = homes(config.count, undefined, config.sceneOrigin);
  const margin = config.safety - epsilon;
  return missions.flatMap((mission, other): RoutingBox[] => {
    if (other === index || phase === 'return' && other < index) return [];
    const position = phase === 'return' ? mission.waypoints.at(-1)
      : other < index ? mission.waypoints[mission.coverageStartIndex ?? 0]
        : fleet?.find((drone) => drone.droneId === mission.droneId)?.position ?? initial[other];
    if (!position) return [];
    const [east, north] = toLocal(position);
    return [[east - margin, north - margin, east + margin, north + margin]];
  });
}

export function assertPlanningSafe(area: SwarmArea, zones: SwarmArea[], config: SwarmConfig, missions: SwarmMission[] = [], fleet?: SwarmDrone[]) {
  const { toLocal } = swarmFrame(config.sceneOrigin);
  const boxes = obstacleBoxes(zones, config);
  const rectangle = minimumCoverageRectangle(area, config.sceneOrigin);
  const boundary = rectangle.polygon.coordinates[0]!.slice(0, -1).map(toLocal);
  missions.forEach((mission) => {
    const assigned = mission.assignedPolygon?.coordinates[0]?.slice(0, -1).map(toLocal) ?? boundary;
    if (mission.coverageSegments.some(([first, second]) => !segmentInside(toLocal(first), toLocal(second), boundary)
      || !segmentInside(toLocal(first), toLocal(second), assigned))) throw new Error('覆盖航段超出任务或分区边界，请重新规划');
    if (mission.coverageSegments.some(([first, second]) => {
      const start = rectangle.align(toLocal(first));
      const end = rectangle.align(toLocal(second));
      return Math.abs(start[0] - end[0]) > epsilon && Math.abs(start[1] - end[1]) > epsilon;
    })) throw new Error('覆盖扫描线未沿最小外接矩形方向排列，请重新规划');
    if (mission.coverageStartIndex === undefined) return;
    const path = mission.waypoints.slice(mission.coverageStartIndex).map(toLocal);
    const cross = (first: Point, second: Point, other: Point) => (second[0] - first[0]) * (other[1] - first[1]) - (second[1] - first[1]) * (other[0] - first[0]);
    path.slice(1).forEach((end, index) => {
      const start = path[index]!;
      if (path.slice(index + 3).some((second, offset) => {
        const first = path[index + offset + 2]!;
        return cross(start, end, first) * cross(start, end, second) < -epsilon && cross(first, second, start) * cross(first, second, end) < -epsilon;
      })) throw new Error('覆盖转场存在交叉，无法安全规划，请调整区域或禁飞区');
    });
  });
  const coveragePaths = missions.map((mission) => mission.waypoints.slice(mission.coverageStartIndex ?? 0).map(toLocal));
  coveragePaths.forEach((path, index) => {
    if (coveragePaths.slice(index + 1).some((other) => path.slice(1).some((point, position) => other.slice(1).some((end, otherPosition) =>
      segmentDistance([path[position]!, point], [other[otherPosition]!, end]) < config.safety - .01)))) {
      throw new Error('并行覆盖路径之间不足安全间距，请重新分区或规划');
    }
  });
  if (config.homePosition && routeIntersectsNoFly([config.homePosition, config.homePosition], zones, config.sceneOrigin)) throw new Error('规划 Home 位于禁飞区内，请调整参考点');
  const positions = fleet?.map((drone) => drone.homePosition) ?? homes(config.count, undefined, config.sceneOrigin);
  positions.forEach((home, index) => {
    const initial = fleet?.[index]?.position ?? home;
    if ([home, initial].some((point) => toLocal(point).some((value) => !Number.isFinite(value) || Math.abs(value) > 500))) throw new Error('服务起降点超出训练范围（中心 500 m）');
    const mission = fleet ? missions.find((item) => item.droneId === fleet[index]!.droneId) : missions[index];
    const path = mission ? [initial, ...mission.waypoints, ...(mission.returnPath ?? [home])] : [initial];
    const local = path.map(toLocal);
    if (local.some((point) => point.some((value) => !Number.isFinite(value) || Math.abs(value) > 500 + epsilon))) throw new Error('航线超出训练范围（中心 500 m）');
    if (local.some((point) => boxes.some((box) => segmentHitsBox(point, point, box)))
      || local.slice(1).some((point, position) => boxes.some((box) => segmentHitsBox(local[position]!, point, box)))) {
      throw new Error(`${mission?.droneId ?? '服务起降点'} 的航线穿越禁飞区或安全缓冲区，请重新生成航线`);
    }
    if (mission) {
      for (const phase of ['entry', 'return'] as const) {
        const route = (phase === 'entry' ? mission.entryPath : mission.returnPath)?.map(toLocal) ?? [];
        const occupied = waitingBoxes(missions, missions.indexOf(mission), config, phase, fleet);
        if (route.slice(1).some((point, position) => occupied.some((box) => segmentHitsBox(route[position]!, point, box)))) {
          throw new Error(`${mission.droneId} 的${phase === 'entry' ? '入场' : '返航'}航线与其他无人机安全等待点冲突，请重新规划`);
        }
      }
    }
  });
}

export function buildCoverageMissions(area: SwarmArea, config: SwarmConfig, fleet?: SwarmDrone[], zones: SwarmArea[] = []): SwarmMission[] {
  const { toLocal, toGeo } = swarmFrame(config.sceneOrigin);
  if (!Number.isInteger(config.count) || config.count < 2 || config.count > 6 || !Number.isFinite(config.spacing) || config.spacing < 3 || config.spacing > 50 || !Number.isFinite(config.safety) || config.safety < 3 || config.spacing < config.safety) {
    throw new Error('请核对机群数量和航线间距；航线间距不得小于安全间距');
  }
  if (!Number.isFinite(config.speed) || config.speed <= 0 || !Number.isFinite(config.altitude) || config.altitude <= 0) throw new Error('飞行速度和高度须为有效正数');
  if (fleet && (fleet.length !== config.count || new Set(fleet.map((drone) => drone.droneId)).size !== config.count
    || fleet.some((drone) => [...drone.position, ...drone.homePosition].some((value) => !Number.isFinite(value))))) throw new Error('服务返回的机群初始位置或编号无效，请重新初始化');
  assertPlanningSafe(area, zones, config, [], fleet);
  const obstacles = obstacleBoxes(zones, config);
  const { polygons, aligned, boxes, boundaries, transform, restore } = partition(area, config.count, config.sceneOrigin, obstacles);
  const positions = fleet?.map((drone) => drone.position) ?? homes(config.count, undefined, config.sceneOrigin);
  const missions = polygons.map((polygon, index): SwarmMission => {
    const min = boundaries[index]!;
    const max = boundaries[index + 1]!;
    if (max - min < config.safety - epsilon) throw new Error('区域过窄，分区后无法满足安全间距；请扩大区域或减少无人机');
    const start = min + config.safety / 2;
    const end = max - config.safety / 2;
    const rows = Math.max(1, Math.ceil((end - start) / config.spacing) + 1);
    const cells: RoutingSegment[][] = [];
    let active: RoutingSegment[][] = [];
    for (let row = 0; row < rows; row += 1) {
      const north = rows === 1 ? (min + max) / 2 : start + (end - start) * row / (rows - 1);
      const intervals = scanIntervals(aligned, north, boxes);
      const continuous = intervals.length === active.length && intervals.every(([first, second], position) => {
        const previous = active[position]!.at(-1)!;
        return Math.min(second, Math.max(previous[0][0], previous[1][0])) > Math.max(first, Math.min(previous[0][0], previous[1][0])) + epsilon;
      });
      if (!continuous) { cells.push(...active); active = intervals.map(() => []); }
      intervals.forEach(([first, second], position) => {
        const cell = active[position]!;
        cell.push(cell.length % 2 ? [[second, north], [first, north]] : [[first, north], [second, north]]);
      });
    }
    cells.push(...active);
    const segments = cells.flat();
    if (!segments.length) throw new Error('分区被禁飞区阻断，无法生成覆盖航段，请调整禁飞区或减少无人机');
    const initial = transform(toLocal(positions[index]!));
    const home = transform(toLocal(fleet?.[index]?.homePosition ?? positions[index]!));
    const ordered: RoutingSegment[] = [];
    const pending = [...cells];
    let cursor = initial;
    while (pending.length) {
      const alternatives = pending.flatMap((cell, position) => [cell, cell.map(([first, second]): RoutingSegment => [second, first]),
        [...cell].reverse(), [...cell].reverse().map(([first, second]): RoutingSegment => [second, first])].map((path) => ({ path, position })));
      const feasible = alternatives.flatMap((candidate) => {
        try {
          const approach = routeLength(shortestRoute(toLocal(restore(cursor)), toLocal(restore(candidate.path[0]![0])), obstacles));
          const departure = pending.length === 1 ? routeLength(shortestRoute(toLocal(restore(candidate.path.at(-1)![1])), toLocal(restore(home)), obstacles)) : 0;
          return [{ ...candidate, cost: approach + routeLength(candidate.path.flat()) + departure }];
        } catch { return []; }
      });
      if (!feasible.length) throw new Error('分区的入场或返航被禁飞区阻断，请调整规划');
      const chosen = feasible.reduce((best, candidate) => candidate.cost < best.cost - epsilon ? candidate : best);
      ordered.push(...chosen.path); cursor = chosen.path.at(-1)![1]; pending.splice(chosen.position, 1);
    }
    const waypoints: Point[] = [];
    const coverageWaypointIndices: number[] = [];
    const bounds: RoutingBox = [Math.min(...aligned.map((point) => point[0])), start,
      Math.max(...aligned.map((point) => point[0])), end];
    ordered.forEach(([first, second]) => {
      if (waypoints.length) {
        let connection: Point[];
        const options = { bounds, barriers: segments, vertices: clip(clip(polygon, start, true), end, false) };
        try { connection = shortestRoute(waypoints.at(-1)!, first, boxes, { ...options, allowed: (before: Point, after: Point) => segmentInside(before, after, polygon) }); }
        catch {
          try { connection = shortestRoute(waypoints.at(-1)!, first, boxes, options); }
          catch { throw new Error(`分区 ${String.fromCharCode(65 + index)} 被禁飞区阻断，无法安全连接，请调整区域、禁飞区或减少无人机`); }
        }
        waypoints.push(...connection.slice(1));
      } else waypoints.push(first);
      waypoints.push(second);
      coverageWaypointIndices.push(waypoints.length - 1);
    });
    return { missionId: `mission-${index + 1}`, droneId: fleet?.[index]?.droneId ?? `UAV-${String(index + 1).padStart(2, '0')}`,
      assignedArea: usableArea(polygon, boxes), assignedPolygon: { type: 'Polygon', coordinates: [[...polygon.map(restore), restore(polygon[0]!)]] },
      waypoints: waypoints.map(restore), coverageSegments: ordered.map(([first, second]) => [restore(first), restore(second)]),
      coverageWaypointIndices, routingObstacles: obstacles, plannedDistance: 0, estimatedDuration: 0,
      assignedColor: swarmColors[index]!, taskStatus: 'PLANNED' };
  });
  missions.forEach((mission, index) => {
    mission.entryPath = shortestRoute(toLocal(positions[index]!), toLocal(mission.waypoints[0]!), [...obstacles, ...waitingBoxes(missions, index, config, 'entry', fleet)]).map(toGeo);
    mission.returnPath = shortestRoute(toLocal(mission.waypoints.at(-1)!), toLocal(fleet?.[index]?.homePosition ?? positions[index]!),
      [...obstacles, ...waitingBoxes(missions, index, config, 'return', fleet)]).map(toGeo);
    const entry = mission.entryPath.slice(1, -1);
    mission.coverageStartIndex = entry.length;
    mission.coverageWaypointIndices = mission.coverageWaypointIndices!.map((position) => position + entry.length);
    mission.waypoints = [...entry, ...mission.waypoints];
    const path = [positions[index]!, ...mission.waypoints, ...mission.returnPath.slice(1)].map(toLocal);
    mission.plannedDistance = path.slice(1).reduce((sum, point, position) => sum + distance(path[position]!, point), 0);
  });
  const entrySeconds = missions.reduce((sum, mission) => sum + routeLength(mission.entryPath!.map(toLocal)) / config.speed, 0);
  const coverageSeconds = Math.max(...missions.map((mission) => routeLength(mission.waypoints.slice(mission.coverageStartIndex).map(toLocal)) / config.speed));
  let returnSeconds = 0;
  missions.forEach((mission) => {
    returnSeconds += routeLength(mission.returnPath!.map(toLocal)) / config.speed + config.altitude / 5;
    mission.estimatedDuration = config.altitude / 5 + (config.count - 1) * 4 + entrySeconds + coverageSeconds + returnSeconds;
  });
  assertPlanningSafe(area, zones, config, missions, fleet);
  return missions;
}
