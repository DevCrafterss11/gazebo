export interface DroneConfiguration {
  id: string;
  model: string;
  frame: string;
  flightController: string;
  firmware: string;
}

export interface DroneModel extends DroneConfiguration {
  name: string;
  type: 'quadrotor' | 'hexacopter';
  frameType: string;
  weight: number;
  size: string;
  maxSpeed: number;
  maxAltitude: number;
  flightTime: number;
  description: string;
  image: string;
  recommended: boolean;
  rotorCount: number;
  maximumTakeoffWeightKg: number;
  wheelbaseMillimeters: number;
  heightMillimeters: number;
  maximumSpeedMetersPerSecond: number;
  enduranceMinutes: number;
}

export interface DronePosition {
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface DroneAttitude {
  roll: number;
  pitch: number;
  yaw: number;
}
