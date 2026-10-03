import type { DroneAttitude, DronePosition } from './drone';
import type { FlightMode } from './flight';
import type { EkfTelemetryStatus, MavlinkTelemetryStatus } from './telemetry';

export type SimulatedFlightState =
  | 'grounded'
  | 'armed'
  | 'taking-off'
  | 'flying'
  | 'holding'
  | 'returning'
  | 'landing';

export interface SimulatedDroneState {
  armed: boolean;
  mode: FlightMode | 'STABILIZE';
  latitude: number;
  longitude: number;
  homeLatitude: number;
  homeLongitude: number;
  altitude: number;
  north: number;
  east: number;
  vx: number;
  vy: number;
  vz: number;
  roll: number;
  pitch: number;
  yaw: number;
  battery: number;
  /** @deprecated Use health.ekfStatus / ekfStatus. Kept for legacy consumers. */
  ekfHealthy: boolean;
  /** @deprecated Use health.mavlinkStatus / mavlinkStatus. Kept for legacy consumers. */
  mavlinkConnected: boolean;
  ekfStatus: EkfTelemetryStatus;
  mavlinkStatus: MavlinkTelemetryStatus;
  health: { ekfStatus: EkfTelemetryStatus; mavlinkStatus: MavlinkTelemetryStatus };
  position: DronePosition;
  homePosition: DronePosition;
  velocity: { vx: number; vy: number; vz: number };
  groundSpeed: number;
  attitude: DroneAttitude;
  batteryPercent: number;
  gpsSatellites: number;
  ekfOk: boolean;
  /** @deprecated Use mavlinkStatus.connected. */
  connected: boolean;
  targetAltitude: number;
  targetPosition: DronePosition;
  targetYaw: number;
  flightState: SimulatedFlightState;
}
