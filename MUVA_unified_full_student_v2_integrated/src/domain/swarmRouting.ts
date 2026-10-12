import type { Point } from '../types/swarm';

export type RoutingBox = [number, number, number, number];
export type RoutingSegment = [Point, Point];
export interface RoutingOptions {
  bounds?: RoutingBox;
  barriers?: RoutingSegment[];
  corridors?: RoutingSegment[];
  vertices?: Point[];
  allowed?: (start: Point, end: Point) => boolean;
}
const tolerance = 0.00001;
const clearance = 0.02;
const same = (first: Point, second: Point) => Math.abs(first[0] - second[0]) < tolerance && Math.abs(first[1] - second[1]) < tolerance;

export function segmentHitsBox(first: Point, second: Point, box: RoutingBox): boolean {
  let lower = 0;
  let upper = 1;
  for (const axis of [0, 1] as const) {
    const delta = second[axis] - first[axis];
    if (Math.abs(delta) < tolerance) {
      if (first[axis] < box[axis] - tolerance || first[axis] > box[axis + 2]! + tolerance) return false;
    } else {
      const start = (box[axis] - first[axis]) / delta;
      const end = (box[axis + 2]! - first[axis]) / delta;
      lower = Math.max(lower, Math.min(start, end));
      upper = Math.min(upper, Math.max(start, end));
      if (lower > upper) return false;
    }
  }
  return true;
}

function crossesBarrier(first: Point, second: Point, [start, end]: RoutingSegment): boolean {
  const direction: Point = [second[0] - first[0], second[1] - first[1]];
  const edge: Point = [end[0] - start[0], end[1] - start[1]];
  const offset: Point = [start[0] - first[0], start[1] - first[1]];
  const cross = (before: Point, after: Point) => before[0] * after[1] - before[1] * after[0];
  const denominator = cross(direction, edge);
  if (Math.abs(denominator) < tolerance) {
    if (Math.abs(cross(direction, offset)) > tolerance) return false;
    const axis = Math.abs(direction[0]) > Math.abs(direction[1]) ? 0 : 1;
    return Math.min(Math.max(first[axis], second[axis]), Math.max(start[axis], end[axis]))
      - Math.max(Math.min(first[axis], second[axis]), Math.min(start[axis], end[axis])) > tolerance;
  }
  const along = cross(offset, edge) / denominator;
  const across = cross(offset, direction) / denominator;
  return along >= -tolerance && along <= 1 + tolerance && across > tolerance && across < 1 - tolerance;
}

export function routeLength(points: Point[]): number {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - points[index]![0], point[1] - points[index]![1]), 0);
}

export function segmentDistance([first, second]: RoutingSegment, [start, end]: RoutingSegment): number {
  const direction: Point = [second[0] - first[0], second[1] - first[1]];
  const edge: Point = [end[0] - start[0], end[1] - start[1]];
  const offset: Point = [start[0] - first[0], start[1] - first[1]];
  const denominator = direction[0] * edge[1] - direction[1] * edge[0];
  if (Math.abs(denominator) > tolerance) {
    const along = (offset[0] * edge[1] - offset[1] * edge[0]) / denominator;
    const across = (offset[0] * direction[1] - offset[1] * direction[0]) / denominator;
    if (along >= 0 && along <= 1 && across >= 0 && across <= 1) return 0;
  }
  const pointDistance = (point: Point, before: Point, after: Point) => {
    const east = after[0] - before[0];
    const north = after[1] - before[1];
    const lengthSquared = east * east + north * north;
    const ratio = lengthSquared > tolerance * tolerance
      ? Math.max(0, Math.min(1, ((point[0] - before[0]) * east + (point[1] - before[1]) * north) / lengthSquared)) : 0;
    return Math.hypot(point[0] - before[0] - ratio * east, point[1] - before[1] - ratio * north);
  };
  return Math.min(pointDistance(first, start, end), pointDistance(second, start, end), pointDistance(start, first, second), pointDistance(end, first, second));
}

export function shortestRoute(first: Point, second: Point, boxes: RoutingBox[], options: RoutingOptions = {}): Point[] {
  const bounds = options.bounds ?? [-500, -500, 500, 500];
  const inBounds = (point: Point) => point.every(Number.isFinite) && point[0] >= bounds[0] - tolerance && point[0] <= bounds[2] + tolerance
    && point[1] >= bounds[1] - tolerance && point[1] <= bounds[3] + tolerance;
  const validPoint = (point: Point) => inBounds(point) && !boxes.some((box) => segmentHitsBox(point, point, box));
  if (![first, second].every(validPoint)) throw new Error('起降点或航点位于禁飞缓冲区内、与其他无人机等待点过近，或超出训练范围，请调整规划');
  if (same(first, second)) return [first];
  const barriers = [...(options.barriers ?? []), ...(options.corridors ?? [])];
  const allowed = (start: Point, end: Point) => validPoint(start) && validPoint(end)
    && !boxes.some((box) => segmentHitsBox(start, end, box))
    && !barriers.some((barrier) => crossesBarrier(start, end, barrier))
    && (options.allowed?.(start, end) ?? true);
  if (allowed(first, second)) return [first, second];
  const candidates: Point[] = [first, second, ...(options.vertices ?? []), ...barriers.flat(),
    ...boxes.flatMap((box): Point[] => [
      [box[0] - clearance, box[1] - clearance], [box[0] - clearance, box[3] + clearance],
      [box[2] + clearance, box[1] - clearance], [box[2] + clearance, box[3] + clearance],
    ])];
  const points = candidates.filter((point, index) => validPoint(point) && !candidates.slice(0, index).some((previous) => same(previous, point)));
  const costs = points.map(() => Infinity);
  const parents = points.map(() => -1);
  const visited = new Set<number>();
  costs[0] = 0;
  while (visited.size < points.length) {
    let current = -1;
    points.forEach((_, index) => {
      if (!visited.has(index) && Number.isFinite(costs[index]) && (current < 0 || costs[index]! < costs[current]!)) current = index;
    });
    if (current < 0) break;
    if (current === 1) {
      const path: Point[] = [];
      while (current >= 0) { path.push(points[current]!); current = parents[current]!; }
      return path.reverse();
    }
    visited.add(current);
    const start = points[current]!;
    points.forEach((end, index) => {
      if (visited.has(index)) return;
      const cost = costs[current]! + Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (cost >= costs[index]! || !allowed(start, end)) return;
      costs[index] = cost;
      parents[index] = current;
    });
  }
  throw new Error('无法在禁飞缓冲区、等待点和分区安全间距约束下连接航线，请调整规划');
}

export function orthogonalRoute(first: Point, second: Point, boxes: RoutingBox[], options: RoutingOptions = {}): Point[] {
  const bounds = options.bounds ?? [-500, -500, 500, 500];
  const inBounds = (point: Point) => point[0] >= bounds[0] - tolerance && point[0] <= bounds[2] + tolerance
    && point[1] >= bounds[1] - tolerance && point[1] <= bounds[3] + tolerance;
  if (![first, second].every(inBounds) || boxes.some((box) => segmentHitsBox(first, first, box) || segmentHitsBox(second, second, box))) {
    throw new Error('起降点或航点位于禁飞缓冲区内，或超出训练范围，请调整禁飞区/区域边界');
  }
  if (same(first, second)) return [first];
  const barriers = options.barriers ?? [];
  const corridors = options.corridors ?? [];
  const allowed = (start: Point, end: Point) => inBounds(start) && inBounds(end)
    && !boxes.some((box) => segmentHitsBox(start, end, box))
    && !barriers.some((barrier) => crossesBarrier(start, end, barrier))
    && !corridors.some((barrier) => Math.abs(start[0] - end[0]) < tolerance !== (Math.abs(barrier[0][0] - barrier[1][0]) < tolerance) && crossesBarrier(start, end, barrier))
    && (options.allowed?.(start, end) ?? true);
  if ((Math.abs(first[0] - second[0]) < tolerance || Math.abs(first[1] - second[1]) < tolerance) && allowed(first, second)) return [first, second];
  for (const corner of [[first[0], second[1]], [second[0], first[1]]] as Point[]) {
    if (allowed(first, corner) && allowed(corner, second)) return [first, corner, second].filter((point, index, points) => index === 0 || !same(point, points[index - 1]!));
  }
  const anchors = [first, second, ...(options.vertices ?? []), ...barriers.flat(), ...corridors.flat(),
    ...boxes.flatMap((box): Point[] => [[box[0] - clearance, box[1] - clearance], [box[2] + clearance, box[3] + clearance]]),
    [bounds[0], bounds[1]] as Point, [bounds[2], bounds[3]] as Point];
  const coordinates = (axis: 0 | 1) => [...new Set(anchors.flatMap((point) => [point[axis], point[axis] - clearance, point[axis] + clearance])
    .filter((value) => value >= bounds[axis] && value <= bounds[axis + 2]!))].sort((left, right) => left - right);
  const east = coordinates(0);
  const north = coordinates(1);
  const width = east.length;
  const origin = north.indexOf(first[1]) * width + east.indexOf(first[0]);
  const target = north.indexOf(second[1]) * width + east.indexOf(second[0]);
  const pointAt = (index: number): Point => [east[index % width]!, north[Math.floor(index / width)]!];
  const costs = new Map<number, number>([[origin, 0]]);
  const parents = new Map<number, number>();
  const visited = new Set<number>();
  const heap: { index: number; score: number }[] = [];
  const push = (index: number, score: number) => {
    heap.push({ index, score });
    let position = heap.length - 1;
    while (position > 0) {
      const parent = Math.floor((position - 1) / 2);
      if (heap[parent]!.score <= heap[position]!.score) break;
      [heap[parent], heap[position]] = [heap[position]!, heap[parent]!];
      position = parent;
    }
  };
  const pop = () => {
    const firstItem = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let position = 0;
      while (position * 2 + 1 < heap.length) {
        let child = position * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1]!.score < heap[child]!.score) child += 1;
        if (heap[position]!.score <= heap[child]!.score) break;
        [heap[position], heap[child]] = [heap[child]!, heap[position]!];
        position = child;
      }
    }
    return firstItem.index;
  };
  push(origin, 0);
  while (heap.length) {
    const current = pop();
    if (visited.has(current)) continue;
    if (current === target) {
      const path: Point[] = [second];
      let cursor = current;
      while (cursor !== origin) { cursor = parents.get(cursor)!; path.push(pointAt(cursor)); }
      path.reverse();
      const result: Point[] = [];
      path.forEach((point) => {
        while (result.length >= 2) {
          const before = result[result.length - 2]!;
          const middle = result.at(-1)!;
          if (!(before[0] === middle[0] && middle[0] === point[0] || before[1] === middle[1] && middle[1] === point[1])) break;
          result.pop();
        }
        result.push(point);
      });
      return result;
    }
    visited.add(current);
    const column = current % width;
    const row = Math.floor(current / width);
    const neighbors = [column > 0 ? current - 1 : -1, column + 1 < width ? current + 1 : -1,
      row > 0 ? current - width : -1, row + 1 < north.length ? current + width : -1];
    const start = pointAt(current);
    for (const next of neighbors) {
      if (next < 0 || visited.has(next)) continue;
      const end = pointAt(next);
      const cost = costs.get(current)! + Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);
      if (cost >= (costs.get(next) ?? Infinity) || !allowed(start, end)) continue;
      costs.set(next, cost); parents.set(next, current);
      push(next, cost + Math.abs(end[0] - second[0]) + Math.abs(end[1] - second[1]));
    }
  }
  throw new Error('无法在禁飞缓冲区和分区安全间距约束下连接航线，请调整顶点、禁飞区或减少无人机数量');
}
