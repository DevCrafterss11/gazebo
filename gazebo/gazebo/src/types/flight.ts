export type FlightMode = 'GUIDED' | 'STABILIZE' | 'LOITER' | 'RTL' | 'LAND';
export type MoveDirection =
  | 'up'
  | 'down'
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'yaw-left'
  | 'yaw-right';

export interface MoveCommand {
  direction: MoveDirection;
  magnitude: number;
}

export interface FlightCommandResult {
  accepted: boolean;
  message: string;
  requestedAt: string;
}

export interface FlightStatus {
  mode: FlightMode;
  armed: boolean;
  altitudeMeters: number;
  speedMetersPerSecond: number;
  gpsSatellites: number;
  batteryPercent: number;
  ekfHealthy: boolean;
  mavlinkConnected: boolean;
}

export interface EnvironmentServiceStatus {
  id: string;
  label: string;
  status: 'running' | 'connected' | 'stopped';
}
