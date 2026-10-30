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


def timed_paths_violate_separation(first: list[list[float]], first_start: float,
                                   second: list[list[float]], second_start: float,
                                   clearance: float, speed: float) -> bool:
    """Check minimum separation while two waypoint routes are concurrently flown."""
    def segments(path: list[list[float]], start: float):
        elapsed = start
        for before, after in zip(path, path[1:]):
            duration = math.dist(before, after) / speed
            if duration > 1e-9:
                yield before, after, elapsed, elapsed + duration
            elapsed += duration

    def position(segment: tuple[list[float], list[float], float, float], at: float) -> list[float]:
        before, after, start, end = segment
        ratio = max(0.0, min(1.0, (at - start) / (end - start)))
        return [before[axis] + (after[axis] - before[axis]) * ratio for axis in (0, 1)]

    first_segments = list(segments(first, first_start))
    second_segments = list(segments(second, second_start))
    first_end = first_segments[-1][3] if first_segments else first_start
    second_end = second_segments[-1][3] if second_segments else second_start
    horizon = max(first_end, second_end)
    if first and horizon > first_end:
        first_segments.append((first[-1], first[-1], first_end, horizon))
    if second and horizon > second_end:
        second_segments.append((second[-1], second[-1], second_end, horizon))
    for first_segment in first_segments:
        for second_segment in second_segments:
            start = max(first_segment[2], second_segment[2])
            end = min(first_segment[3], second_segment[3])
            if start > end:
                continue
            first_at_start = position(first_segment, start)
            second_at_start = position(second_segment, start)
            first_at_end = position(first_segment, end)
            second_at_end = position(second_segment, end)
            relative_start = [first_at_start[axis] - second_at_start[axis] for axis in (0, 1)]
            relative_velocity = [(first_at_end[axis] - second_at_end[axis]) - relative_start[axis] for axis in (0, 1)]
            velocity_squared = sum(value * value for value in relative_velocity)
            ratio = max(0.0, min(1.0, -sum(relative_start[axis] * relative_velocity[axis] for axis in (0, 1)) / velocity_squared)) if velocity_squared else 0.0
            closest = [relative_start[axis] + ratio * relative_velocity[axis] for axis in (0, 1)]
            if math.hypot(*closest) < clearance:
                return True
    return False


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
