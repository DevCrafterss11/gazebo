export type ArduPilotFlightMode = 'GUIDED' | 'STABILIZE' | 'LOITER' | 'ALT_HOLD' | 'AUTO';

export interface FlightControllerConfig {
  autopilot: 'ArduPilot';
  vehicleType: 'Copter';
  firmware: 'ArduCopter 4.6.x' | 'ArduCopter 4.5.x';
  frameClass: 'Quad' | 'Hexa';
  frameType: 'X' | 'Plus';
  flightMode: ArduPilotFlightMode;
  protocol: 'MAVLink 2';
}

export type SensorId = 'heartbeat' | 'gps' | 'imu' | 'compass' | 'barometer' | 'ekf';
export type SensorCheckStatus = 'WAITING' | 'CHECKING' | 'PASS' | 'FAIL';
export type CheckOutcome = 'WAITING' | 'CHECKING' | 'PASSED' | 'FAILED';

export interface SensorCheckItem {
  id: SensorId;
  name: string;
  status: SensorCheckStatus;
  details: string[];
}

export interface FlightParameters {
  takeoffAltitude: number;
  maxAltitude: number;
  maxSpeed: number;
  rtlAltitude: number;
  hoverDuration: number;
}

export interface SceneLocation {
  latitude: number;
  longitude: number;
}

export interface HomePosition extends SceneLocation {
  altitude: number;
}

export interface TrainingScene {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  altitude: number;
  weather: string;
  wind: string;
  image: string;
}

export type PreflightStatus = 'WAITING' | 'CHECKING' | 'PASS' | 'FAIL';

export interface PreflightChecklistItem {
  id: string;
  label: string;
  status: PreflightStatus;
  reason?: string;
}

export interface ExperimentConfiguration {
  selectedDroneId: string | null;
  flightController: FlightControllerConfig;
  sensors: SensorCheckItem[];
  flightParameters: FlightParameters;
  selectedSceneId: string | null;
  homePosition: HomePosition | null;
}
