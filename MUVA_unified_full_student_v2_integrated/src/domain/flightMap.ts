import type { FlightMapView, MapCoordinates } from '../types/flightMap';
import type { FlightPathPoint } from '../types/telemetry';

export const validMapCoordinates = (point: MapCoordinates | null | undefined): point is MapCoordinates => Boolean(point
  && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
  && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180);

export const flightMapContextId = (progressId: string, sceneId: string, home: MapCoordinates): string =>
  JSON.stringify([progressId, sceneId, home.latitude, home.longitude]);

export const validFlightMapView = (value: unknown): value is FlightMapView => {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Partial<FlightMapView>;
  return typeof view.contextId === 'string' && validMapCoordinates(view.center)
    && typeof view.zoom === 'number' && Number.isFinite(view.zoom) && view.zoom >= 0 && view.zoom <= 22;
};

export const initialFlightMapView = (
  contextId: string,
  home: MapCoordinates,
  saved: FlightMapView | null,
  center: MapCoordinates = home,
  zoom = 17.2,
): FlightMapView => validFlightMapView(saved) && saved.contextId === contextId
  ? saved
  : { contextId, center: { latitude: center.latitude, longitude: center.longitude }, zoom };

export const homeDistanceMeters = (configured: MapCoordinates, actual: MapCoordinates): number => {
  const radians = Math.PI / 180;
  const latitudeDelta = (actual.latitude - configured.latitude) * radians;
  const longitudeDelta = (actual.longitude - configured.longitude) * radians;
  const chord = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(configured.latitude * radians)
    * Math.cos(actual.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, chord))));
};

export function rebaseMapCoordinates<Point extends MapCoordinates>(point: Point, sourceHome: MapCoordinates, targetHome: MapCoordinates): Point {
  const latitudeScale = 111_111;
  const sourceLongitudeScale = latitudeScale * Math.cos(sourceHome.latitude * Math.PI / 180);
  const targetLongitudeScale = latitudeScale * Math.cos(targetHome.latitude * Math.PI / 180);
  const north = (point.latitude - sourceHome.latitude) * latitudeScale;
  const longitudeDelta = ((point.longitude - sourceHome.longitude + 540) % 360) - 180;
  const east = longitudeDelta * sourceLongitudeScale;
  const longitude = targetHome.longitude + east / Math.max(Math.abs(targetLongitudeScale), 0.01);
  return { ...point, latitude: targetHome.latitude + north / latitudeScale, longitude: ((longitude + 540) % 360) - 180 };
}

export const offscreenVehicleIndicator = (point: { x: number; y: number }, width: number, height: number): {
  x: number;
  y: number;
  bearing: number;
} | null => {
  if (![point.x, point.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height) return null;
  const centerX = width / 2;
  const centerY = height / 2;
  const deltaX = point.x - centerX;
  const deltaY = point.y - centerY;
  const availableX = centerX - Math.min(88, width / 4);
  const availableY = centerY - Math.min(70, height / 4);
  const scale = Math.min(availableX / Math.abs(deltaX), availableY / Math.abs(deltaY));
  return {
    x: centerX + deltaX * scale,
    y: centerY + deltaY * scale,
    bearing: Math.atan2(deltaX, -deltaY) * 180 / Math.PI,
  };
};

export const mergeFlightMapTrack = (snapshot: FlightPathPoint[], live: FlightPathPoint[], startedAt: number | null): FlightPathPoint[] => {
  const unique = new Map<string, FlightPathPoint>();
  [...snapshot, ...live].forEach((point) => {
    if (!validMapCoordinates(point) || !Number.isFinite(point.north) || !Number.isFinite(point.east)) return;
    if (startedAt !== null && (!Number.isFinite(point.timestamp) || point.timestamp! < startedAt)) return;
    unique.set(`${point.timestamp ?? ''}:${point.latitude}:${point.longitude}`, point);
  });
  return [...unique.values()].sort((first, second) => (first.timestamp ?? 0) - (second.timestamp ?? 0)).slice(-600);
};

export const segmentFlightMapTrack = (
  points: FlightPathPoint[],
  maxGapMs = 5_000,
  maxSpeedMetersPerSecond = 30,
): FlightPathPoint[][] => {
  const segments: FlightPathPoint[][] = [];
  const distanceMeters = (first: FlightPathPoint, second: FlightPathPoint): number => {
    const latitudeScale = 111_111;
    const north = (second.latitude - first.latitude) * latitudeScale;
    const east = (((second.longitude - first.longitude + 540) % 360) - 180)
      * latitudeScale * Math.cos(first.latitude * Math.PI / 180);
    return Math.hypot(north, east);
  };

  points.slice(-600).forEach((point) => {
    if (!validMapCoordinates(point) || !Number.isFinite(point.north) || !Number.isFinite(point.east)) {
      segments.push([]);
      return;
    }
    const current = segments.at(-1);
    const previous = current?.at(-1);
    if (!previous) {
      if (!current) segments.push([point]);
      else current.push(point);
      return;
    }
    const elapsedMs = point.timestamp! - previous.timestamp!;
    const distance = distanceMeters(previous, point);
    const invalidTiming = !Number.isFinite(point.timestamp) || !Number.isFinite(previous.timestamp) || elapsedMs <= 0;
    const impossibleJump = !invalidTiming && distance / (elapsedMs / 1000) > maxSpeedMetersPerSecond;
    if (impossibleJump) {
      segments.push([]);
      return;
    }
    if (invalidTiming || elapsedMs > maxGapMs || !current) segments.push([point]);
    else current.push(point);
  });

  return segments.filter((segment) => segment.length > 0);
};
