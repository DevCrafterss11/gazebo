import { swarmFrame } from './swarmGeometry';
import type { Point, SwarmArea } from '../types/swarm';

const cross = (first: Point, second: Point, third: Point) =>
  (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((first, second) => first[0] - second[0] || first[1] - second[1]);
  const half = (vertices: Point[]) => {
    const result: Point[] = [];
    vertices.forEach((point) => {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, point) <= 0) result.pop();
      result.push(point);
    });
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function minimumCoverageRectangle(area: SwarmArea, sceneOrigin?: Point) {
  const { toLocal, toGeo } = swarmFrame(sceneOrigin);
  const hull = convexHull(area.polygon.coordinates[0]!.slice(0, -1).map(toLocal));
  if (hull.length < 3) throw new Error('任务区域无法生成有效的最小外接矩形');
  const candidates = hull.map((point, index) => {
    const next = hull[(index + 1) % hull.length]!;
    let angle = Math.atan2(next[1] - point[1], next[0] - point[0]);
    const boundsAt = (rotation: number): [number, number, number, number] => {
      const east = hull.map((vertex) => vertex[0] * Math.cos(rotation) + vertex[1] * Math.sin(rotation));
      const north = hull.map((vertex) => -vertex[0] * Math.sin(rotation) + vertex[1] * Math.cos(rotation));
      return [Math.min(...east), Math.min(...north), Math.max(...east), Math.max(...north)];
    };
    const initial = boundsAt(angle);
    if (initial[3] - initial[1] > initial[2] - initial[0] + .0001) angle += Math.PI / 2;
    angle = ((angle + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
    const bounds = boundsAt(angle);
    return { angle, bounds, area: (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) };
  });
  const best = candidates.reduce((chosen, candidate) => candidate.area < chosen.area - .0001
    || Math.abs(candidate.area - chosen.area) <= .0001 && Math.abs(candidate.angle) < Math.abs(chosen.angle) ? candidate : chosen);
  const cosine = Math.cos(best.angle);
  const sine = Math.sin(best.angle);
  const align = (point: Point): Point => [point[0] * cosine + point[1] * sine, -point[0] * sine + point[1] * cosine];
  const unalign = (point: Point): Point => [point[0] * cosine - point[1] * sine, point[0] * sine + point[1] * cosine];
  const [left, bottom, right, top] = best.bounds;
  const aligned: Point[] = [[left, bottom], [right, bottom], [right, top], [left, top]];
  const vertices = aligned.map((point) => toGeo(unalign(point)));
  return { area: best.area, angle: best.angle, aligned, align, unalign,
    polygon: { type: 'Polygon' as const, coordinates: [[...vertices, vertices[0]!]] } };
}
