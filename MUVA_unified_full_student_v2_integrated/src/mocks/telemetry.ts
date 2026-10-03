import type { TelemetrySample } from '../types/telemetry';

export const mockTelemetry: TelemetrySample[] = Array.from({ length: 24 }, (_, index) => ({
  timestamp: Date.now() - (23 - index) * 1_000,
  position: {
    latitude: 30.2741 + index * 0.000001,
    longitude: 120.1551 + index * 0.000001,
    altitude: 9.7 + Math.sin(index / 3) * 0.5,
  },
  attitude: {
    roll: Math.sin(index / 2) * 1.2,
    pitch: Math.cos(index / 3) * 0.8,
    yaw: 88 + index * 0.1,
  },
  speedMetersPerSecond: 0.16 + Math.abs(Math.sin(index / 4)) * 0.08,
  batteryPercent: 93 - index * 0.08,
  gpsSatellites: index < 8 ? 14 : index < 16 ? 15 : 16,
  ekfStatus: { healthy: true, state: 'NORMAL' },
  mavlinkStatus: { connected: true, heartbeat: true, version: 'MAVLink 2' },
}));
