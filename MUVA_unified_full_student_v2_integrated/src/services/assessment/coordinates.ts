import type { TelemetrySample } from '../../types/telemetry';

export interface LocalPoint { x: number; y: number; z: number }
export interface HomeCoordinates { latitude: number; longitude: number; altitude: number }

export function toLocalPoint(sample: TelemetrySample, home: HomeCoordinates | null): LocalPoint | null {
  if (!home || !Number.isFinite(home.latitude) || !Number.isFinite(home.longitude) ||
      !Number.isFinite(sample.position.latitude) || !Number.isFinite(sample.position.longitude) ||
      !Number.isFinite(sample.position.altitude) ||
      Math.abs(home.latitude) > 90 || Math.abs(home.longitude) > 180 ||
      Math.abs(sample.position.latitude) > 90 || Math.abs(sample.position.longitude) > 180) return null;
  const north = (sample.position.latitude - home.latitude) * 111_111;
  const east = (sample.position.longitude - home.longitude) * 111_111 * Math.cos(home.latitude * Math.PI / 180);
  return { x: east, y: sample.position.altitude, z: -north };
}

export function isRealTelemetryReady(sample: TelemetrySample | null, now = Date.now()): boolean {
  return !!sample && sample.source === 'mavlink' && sample.snapshotTimestamp !== undefined && sample.snapshotTimestamp > 0 &&
    now >= sample.snapshotTimestamp && now - sample.snapshotTimestamp <= 3000 &&
    now >= sample.timestamp && now - sample.timestamp <= 3000 &&
    sample.mavlinkStatus.connected && sample.mavlinkStatus.heartbeat;
}

export function toViewAttitude(attitude: TelemetrySample['attitude']): { roll: number; pitch: number; yaw: number } {
  return { roll: attitude.roll, pitch: attitude.pitch, yaw: ((attitude.yaw % 360) + 360) % 360 };
}

export function toThreeEuler(attitude: TelemetrySample['attitude']): [number, number, number] {
  return [attitude.pitch * Math.PI / 180, -attitude.yaw * Math.PI / 180, -attitude.roll * Math.PI / 180];
}
