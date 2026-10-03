import type { FlightParameters } from './configuration';

export type EnvironmentStartupPhase =
  | 'IDLE'
  | 'VALIDATING_CONFIG'
  | 'LOADING_GAZEBO_WORLD'
  | 'STARTING_GAZEBO'
  | 'STARTING_ARDUPILOT_SITL'
  | 'STARTING_MAVLINK_GATEWAY'
  | 'CONNECTING_MAVLINK'
  | 'WAITING_HEARTBEAT'
  | 'VEHICLE_ONLINE'
  | 'READY'
  | 'ERROR';

export interface EnvironmentStartupState {
  phase: EnvironmentStartupPhase;
  progress: number;
  message: string;
}

export interface EnvironmentRuntimeStatus {
  gazebo: 'STOPPED' | 'STARTING' | 'RUNNING';
  ardupilotSitl: 'STOPPED' | 'STARTING' | 'RUNNING';
  mavlinkGateway: 'DISCONNECTED' | 'STARTING' | 'CONNECTING' | 'CONNECTED';
  heartbeat: 'WAITING' | 'OK';
  gps: 'WAITING' | '3D FIX';
  ekf: 'WAITING' | 'INITIALIZING' | 'HEALTHY';
  vehicle: 'UNAVAILABLE' | 'INITIALIZING' | 'ONLINE';
}

export interface EnvironmentLogEntry {
  timestamp: string;
  phase: EnvironmentStartupPhase;
  message: string;
}

export interface EnvironmentStartRequest {
  experimentId: string;
  droneModel: string;
  vehicleType: string;
  frame: string;
  firmware: string;
  scene: string;
  home: { latitude: number; longitude: number; altitude: number };
  flightParameters: FlightParameters;
}
