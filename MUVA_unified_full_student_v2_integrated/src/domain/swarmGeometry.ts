import type { Point, SwarmArea, SwarmConfig, SwarmMission } from '../types/swarm';

export const origin: Point = [108.8289653, 34.1251589];
const longitudeScale = 111320 * Math.cos(origin[1] * Math.PI / 180);
const latitudeScale = 111320;
export const toLocal = (point: Point): Point => [(point[0] - origin[0]) * longitudeScale, (point[1] - origin[1]) * latitudeScale];
export const toGeo = (point: Point): Point => [origin[0] + point[0] / longitudeScale, origin[1] + point[1] / latitudeScale];
export const distance = (first: Point, second: Point) => Math.hypot(first[0] - second[0], first[1] - second[1]);
const inside = (point: Point, polygon: Point[]): boolean => {
  let contained = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const first = polygon[index]!; const second = polygon[previous]!;
    const lengthSquared = distance(first, second) ** 2;
    if (lengthSquared > 0) {
      const ratio = Math.max(0, Math.min(1, ((point[0] - first[0]) * (second[0] - first[0]) + (point[1] - first[1]) * (second[1] - first[1])) / lengthSquared));
      if (distance(point, [first[0] + ratio * (second[0] - first[0]), first[1] + ratio * (second[1] - first[1])]) < 0.001) return true;
    }
    if ((first[1] > point[1]) !== (second[1] > point[1]) && point[0] < (second[0] - first[0]) * (point[1] - first[1]) / (second[1] - first[1]) + first[0]) contained = !contained;
  }
  return contained;
};
export const homes = (count: number): Point[] => Array.from({ length: count }, (_, index) => toGeo([-48 + index * 14, -52]));
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const intersects = (a: Point, b: Point, c: Point, d: Point) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;

export function validateArea(vertices: Point[]): SwarmArea {
  if (vertices.length < 3 || vertices.some((point) => !point.every(Number.isFinite))) throw new Error('请至少绘制三个有效顶点');
  const local = vertices.map(toLocal);
  if (local.some(([east, north]) => Math.abs(east) > 500 || Math.abs(north) > 500)) throw new Error('区域超出允许规划的场景范围（中心 500 米）');
  for (let index = 0; index < local.length; index += 1) {
    for (let other = index + 2; other < local.length; other += 1) {
      if (index === 0 && other === local.length - 1) continue;
      if (intersects(local[index]!, local[(index + 1) % local.length]!, local[other]!, local[(other + 1) % local.length]!)) throw new Error('区域边界自交，请调整顶点');
    }
  }
  const area = Math.abs(local.reduce((sum, point, index) => sum + cross([0, 0], point, local[(index + 1) % local.length]!), 0)) / 2;
  if (area < 100 || area > 200000) throw new Error('区域面积须在 100–200000 平方米之间');
  const perimeter = local.reduce((sum, point, index) => sum + distance(point, local[(index + 1) % local.length]!), 0);
  return { polygon: { type: 'Polygon', coordinates: [[...vertices, vertices[0]!] ] }, area, perimeter,
    boundingBox: [Math.min(...vertices.map((point) => point[0])), Math.min(...vertices.map((point) => point[1])), Math.max(...vertices.map((point) => point[0])), Math.max(...vertices.map((point) => point[1]))], coordinateSystem: 'WGS84' };
}

export function planMissions(area: SwarmArea, config: SwarmConfig): SwarmMission[] {
  const polygon = area.polygon.coordinates[0]!.slice(0, -1).map(toLocal);
  const minY = Math.min(...polygon.map((point) => point[1]));
  const maxY = Math.max(...polygon.map((point) => point[1]));
  const segments: [Point, Point][] = [];
  for (let y = minY + Math.min(config.spacing / 2, (maxY - minY) / 2); y < maxY; y += config.spacing) {
    const crossings: number[] = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const first = polygon[index]!; const second = polygon[(index + 1) % polygon.length]!;
      if ((first[1] <= y && second[1] > y) || (second[1] <= y && first[1] > y)) crossings.push(first[0] + (y - first[1]) * (second[0] - first[0]) / (second[1] - first[1]));
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      if (crossings[index + 1]! - crossings[index]! > 0.1) segments.push([[crossings[index]!, y], [crossings[index + 1]!, y]]);
    }
  }
  if (segments.length < config.count) throw new Error('区域过窄，无法为每架无人机分配独立覆盖航段；请缩小航线间距或扩大区域');
  const colors = ['#18baff', '#3ee7b1', '#ffb547', '#b994ff', '#ff728d'];
  return Array.from({ length: config.count }, (_, index) => {
    const assigned = segments.slice(Math.floor(index * segments.length / config.count), Math.floor((index + 1) * segments.length / config.count));
    const oriented = assigned.map((segment, segmentIndex) => segmentIndex % 2 ? [segment[1], segment[0]] : segment);
    for (let segmentIndex = 1; segmentIndex < oriented.length; segmentIndex += 1) {
      const from = oriented[segmentIndex - 1]![1]!; const to = oriented[segmentIndex]![0]!;
      for (let sample = 1; sample < 20; sample += 1) {
        const ratio = sample / 20;
        if (!inside([from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio], polygon)) throw new Error('不规则区域的航段接续需穿越规划区外，请调整区域形状或航线间距');
      }
    }
    const home = toLocal(homes(config.count)[index]!);
    const route = [home, ...oriented.flat()];
    const plannedDistance = route.slice(1).reduce((total, point, position) => total + distance(point, route[position]!), 0) + distance(route[route.length - 1]!, home);
    return { missionId: `mission-${index + 1}`, droneId: `UAV-${String(index + 1).padStart(2, '0')}`, assignedArea: area.area * assigned.length / segments.length,
      waypoints: route.slice(1).map(toGeo), coverageSegments: oriented.map((pair) => [toGeo(pair[0]!), toGeo(pair[1]!)]), plannedDistance, estimatedDuration: plannedDistance / config.speed + config.altitude / 2 + index * 4,
      assignedColor: colors[index]!, taskStatus: 'PLANNED' };
  });
}
