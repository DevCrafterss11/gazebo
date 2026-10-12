import type { Point, SwarmArea } from '../types/swarm';

export const origin: Point = [108.8289653, 34.1251589];
export const campusOrigin: Point = [116.3268, 40.0098];
export function swarmFrame(center: Point = origin) {
  const eastScale = 111320 * Math.cos(center[1] * Math.PI / 180);
  return {
    toLocal: (point: Point): Point => [(point[0] - center[0]) * eastScale, (point[1] - center[1]) * 111320],
    toGeo: (point: Point): Point => [center[0] + point[0] / eastScale, center[1] + point[1] / 111320],
  };
}
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
export const homes = (count: number, homePosition?: Point, sceneOrigin?: Point): Point[] => {
  if (!Number.isInteger(count) || count < 2 || count > 6) return [];
  const { toLocal, toGeo } = swarmFrame(sceneOrigin);
  const base = homePosition ? toLocal(homePosition) : [-48, -52];
  return Array.from({ length: count }, (_, index) => toGeo([base[0]! + index * 14, base[1]!]));
};
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const intersects = (a: Point, b: Point, c: Point, d: Point) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;

export function validateArea(vertices: Point[], sceneOrigin?: Point): SwarmArea {
  const { toLocal } = swarmFrame(sceneOrigin);
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
  return { polygon: { type: 'Polygon', coordinates: [[...vertices, vertices[0]!] ] }, area, center: polygonCenter(vertices, sceneOrigin), perimeter,
    boundingBox: [Math.min(...vertices.map((point) => point[0])), Math.min(...vertices.map((point) => point[1])), Math.max(...vertices.map((point) => point[0])), Math.max(...vertices.map((point) => point[1]))], coordinateSystem: 'WGS84' };
}

export function polygonCenter(vertices: Point[], sceneOrigin?: Point): Point {
  const { toLocal, toGeo } = swarmFrame(sceneOrigin);
  const local = vertices.map(toLocal);
  let signedArea = 0;
  let east = 0;
  let north = 0;
  local.forEach((point, index) => {
    const next = local[(index + 1) % local.length]!;
    const weight = cross([0, 0], point, next);
    signedArea += weight;
    east += (point[0] + next[0]) * weight;
    north += (point[1] + next[1]) * weight;
  });
  if (Math.abs(signedArea) < 0.0001) return toGeo([local.reduce((sum, point) => sum + point[0], 0) / local.length, local.reduce((sum, point) => sum + point[1], 0) / local.length]);
  return toGeo([east / (3 * signedArea), north / (3 * signedArea)]);
}

export { buildCoverageMissions as planMissions } from './swarmPlanning';
