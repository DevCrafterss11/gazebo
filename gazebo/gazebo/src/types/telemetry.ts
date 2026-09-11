import type { DroneAttitude, DronePosition } from './drone';

export interface EkfTelemetryStatus {
  healthy: boolean;
  state: string;
}

export interface MavlinkTelemetryStatus {
  connected: boolean;
  heartbeat: boolean;
  version: string;
}

export interface TelemetrySample {
  timestamp: number;
  vehicleId?: string;
  sequence?: number;
  source?: TelemetrySource;
  position: DronePosition;
  attitude: DroneAttitude;
  speedMetersPerSecond: number;
  batteryPercent: number;
  gpsSatellites: number;
  ekfStatus: EkfTelemetryStatus;
  mavlinkStatus: MavlinkTelemetryStatus;
  armed?: boolean;
  mode?: string;
  groundSpeed?: number;
  flightState?: string;
  north?: number;
  east?: number;
}

export type TelemetrySource = 'mavlink' | 'simulation' | 'gateway';
export type TelemetryPayloadType = 'SNAPSHOT' | 'HEARTBEAT' | 'ESTIMATOR_STATUS' | 'POSITION' | 'ATTITUDE' | 'GPS' | 'BATTERY' | 'FLIGHT_STATE';

export interface HeartbeatPayload { type: 'HEARTBEAT'; armed: boolean; mode: string; version?: string; }
export interface EstimatorStatusPayload { type: 'ESTIMATOR_STATUS'; healthy: boolean; state: string; }
export interface PositionPayload { type: 'POSITION'; latitude: number; longitude: number; altitude: number; north?: number; east?: number; groundSpeed?: number; }
export interface AttitudePayload { type: 'ATTITUDE'; roll: number; pitch: number; yaw: number; }
export interface GpsPayload { type: 'GPS'; satellites: number; fixType: string; hdop: number; }
export interface BatteryPayload { type: 'BATTERY'; percent: number; }
export interface FlightStatePayload { type: 'FLIGHT_STATE'; state: string; }
export interface SnapshotPayload {
  type: 'SNAPSHOT';
  position: { latitude: number; longitude: number; altitude: number };
  velocity: { groundSpeed: number; verticalSpeed: number };
  attitude: { roll: number; pitch: number; yaw: number };
  batteryPercent: number;
  gps: { satellites: number; fixType: string; hdop: number };
  health: { ekfStatus: EkfTelemetryStatus; mavlinkStatus: MavlinkTelemetryStatus };
  system: { mode: string; armed: boolean };
}

export type TelemetryPayload =
  | SnapshotPayload
  | HeartbeatPayload
  | EstimatorStatusPayload
  | PositionPayload
  | AttitudePayload
  | GpsPayload
  | BatteryPayload
  | FlightStatePayload;

/** Versioned JSON envelope exchanged by the Gateway over WebSocket. */
export interface TelemetryMessageEnvelope<TPayload extends TelemetryPayload = TelemetryPayload> {
  protocolVersion: '1.0';
  type: 'telemetry';
  timestamp: number;
  vehicleId: string;
  sequence: number;
  source: TelemetrySource;
  payload: TPayload;
}

/** Complete snapshot shape for a future Gateway snapshot payload. */
export interface TelemetrySampleDTO {
  protocolVersion: '1.0';
  type: 'telemetry';
  timestamp: number;
  vehicleId: string;
  sequence: number;
  source: TelemetrySource;
  payload: SnapshotPayload;
}

export interface MavlinkMonitorMessage {
  messageType: string;
  systemId: number;
  componentId: number;
  sequence: number;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface TelemetrySeriesPoint {
  timestamp: number;
  value: number;
}

export type TelemetryConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type TelemetryAvailability = 'UNKNOWN' | 'AVAILABLE' | 'LOST';
