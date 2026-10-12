from __future__ import annotations

import heapq
import math

from .commands import CommandRejectedError


def hits_box(first: list[float], second: list[float], box: list[float]) -> bool:
    lower, upper = 0.0, 1.0
    for axis in (0, 1):
        direction = second[axis] - first[axis]
        if abs(direction) < 1e-9:
            if first[axis] < box[axis] or first[axis] > box[axis + 2]:
                return False
        else:
            start, end = sorted(((box[axis] - first[axis]) / direction, (box[axis + 2] - first[axis]) / direction))
            lower, upper = max(lower, start), min(upper, end)
            if lower > upper:
                return False
    return True


def segment_distance(first: list[list[float]], second: list[list[float]]) -> float:
    start, end = first
    other_start, other_end = second
    cross = lambda before, after, point: (after[0] - before[0]) * (point[1] - before[1]) - (after[1] - before[1]) * (point[0] - before[0])
    if cross(start, end, other_start) * cross(start, end, other_end) < 0 and cross(other_start, other_end, start) * cross(other_start, other_end, end) < 0:
        return 0.0
    def point_distance(point: list[float], before: list[float], after: list[float]) -> float:
        delta = [after[axis] - before[axis] for axis in (0, 1)]
        squared = sum(value * value for value in delta)
        along = max(0, min(1, sum((point[axis] - before[axis]) * delta[axis] for axis in (0, 1)) / squared)) if squared else 0
        return math.dist(point, [before[axis] + along * delta[axis] for axis in (0, 1)])
    return min(point_distance(start, other_start, other_end), point_distance(end, other_start, other_end),
               point_distance(other_start, start, end), point_distance(other_end, start, end))


def shortest_route(first: list[float], second: list[float], boxes: list[list[float]]) -> list[list[float]]:
    valid = lambda point: all(abs(value) <= 500 for value in point) and not any(hits_box(point, point, box) for box in boxes)
    if not valid(first) or not valid(second):
        raise CommandRejectedError("返航端点位于禁飞缓冲或其他无人机等待安全范围内")
    points = [first, second]
    for left, bottom, right, top in boxes:
        points.extend(point for point in ([left - .1, bottom - .1], [left - .1, top + .1], [right + .1, bottom - .1], [right + .1, top + .1]) if valid(point))
    costs = {0: 0.0}
    parents: dict[int, int] = {}
    queue = [(0.0, 0)]
    while queue:
        cost, current = heapq.heappop(queue)
        if cost > costs[current]:
            continue
        if current == 1:
            path = [points[current]]
            while current in parents:
                current = parents[current]
                path.append(points[current])
            return list(reversed(path))
        for index, point in enumerate(points):
            candidate = cost + math.dist(points[current], point)
            if candidate < costs.get(index, math.inf) and not any(hits_box(points[current], point, box) for box in boxes):
                costs[index] = candidate
                parents[index] = current
                heapq.heappush(queue, (candidate, index))
    raise CommandRejectedError("无法在禁飞缓冲和机间安全间距下返航；保持悬停，请调整任务")
