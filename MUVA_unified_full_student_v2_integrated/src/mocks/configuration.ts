import type {
  ExperimentConfiguration,
  FlightControllerConfig,
  FlightParameters,
  PreflightChecklistItem,
  SensorCheckItem,
  TrainingScene,
} from '../types/configuration';

export const defaultFlightControllerConfig: FlightControllerConfig = {
  autopilot: 'ArduPilot',
  vehicleType: 'Copter',
  firmware: 'ArduCopter 4.6.x',
  frameClass: 'Quad',
  frameType: 'X',
  flightMode: 'GUIDED',
  protocol: 'MAVLink 2',
};

export const defaultFlightParameters: FlightParameters = {
  takeoffAltitude: 10,
  maxAltitude: 120,
  maxSpeed: 5,
  rtlAltitude: 30,
  hoverDuration: 10,
};

export const createUncheckedSensors = (): SensorCheckItem[] => [
  { id: 'heartbeat', name: 'Heartbeat', status: 'WAITING', details: ['Awaiting vehicle heartbeat'] },
  { id: 'gps', name: 'GPS', status: 'WAITING', details: ['Fix --', 'Satellites --', 'HDOP --'] },
  { id: 'imu', name: 'IMU', status: 'WAITING', details: ['Gyroscope --', 'Accelerometer --'] },
  { id: 'compass', name: 'Compass', status: 'WAITING', details: ['Health --'] },
  { id: 'barometer', name: 'Barometer', status: 'WAITING', details: ['Health --'] },
  { id: 'ekf', name: 'EKF', status: 'WAITING', details: ['Health --'] },
];

export const healthySensorDetails: Record<SensorCheckItem['id'], string[]> = {
  heartbeat: ['Heartbeat OK', 'Vehicle ONLINE'],
  gps: ['3D Fix', '16 satellites', 'HDOP 0.8'],
  imu: ['Gyroscope Healthy', 'Accelerometer Healthy'],
  compass: ['Healthy'],
  barometer: ['Healthy'],
  ekf: ['Healthy'],
};

export const mockScenes: TrainingScene[] = [
  {
    id: 'campus',
    name: '校园环境',
    description: '包含教学楼、操场和开阔起降区的基础教学场景。',
    latitude: 34.1251589,
    longitude: 108.8289653,
    altitude: 412,
    weather: '晴朗 · 22°C',
    wind: '东北风 1.2 m/s',
    image: 'campus',
  },
  {
    id: 'training-field',
    name: '标准训练场',
    description: '带标准训练点和航线标记的封闭训练区域。',
    latitude: 34.1266589,
    longitude: 108.8313653,
    altitude: 415,
    weather: '晴朗 · 21°C',
    wind: '东风 0.8 m/s',
    image: 'training-field',
  },
  {
    id: 'open-area',
    name: '空旷环境',
    description: '障碍物较少，适合初次起飞和姿态控制练习。',
    latitude: 34.1223589,
    longitude: 108.8245653,
    altitude: 395,
    weather: '多云 · 20°C',
    wind: '西北风 2.1 m/s',
    image: 'open-area',
  },
];

export const createDefaultConfiguration = (): ExperimentConfiguration => ({
  selectedDroneId: null,
  flightController: defaultFlightControllerConfig,
  sensors: createUncheckedSensors(),
  flightParameters: defaultFlightParameters,
  selectedSceneId: null,
  homePosition: null,
});

export const createPreflightChecklist = (): PreflightChecklistItem[] => [
  { id: 'environment-ready', label: 'Environment READY', status: 'WAITING' },
  { id: 'sitl-connected', label: 'SITL Connected', status: 'WAITING' },
  { id: 'mavlink-connected', label: 'MAVLink Connected', status: 'WAITING' },
  { id: 'heartbeat', label: 'Heartbeat OK', status: 'WAITING' },
  { id: 'gps', label: 'GPS 3D Fix', status: 'WAITING' },
  { id: 'ekf', label: 'EKF Healthy', status: 'WAITING' },
  { id: 'imu', label: 'IMU Healthy', status: 'WAITING' },
  { id: 'compass', label: 'Compass Healthy', status: 'WAITING' },
  { id: 'barometer', label: 'Barometer Healthy', status: 'WAITING' },
  { id: 'home', label: 'Home Position Set', status: 'WAITING' },
  { id: 'parameters', label: 'Flight Parameters Valid', status: 'WAITING' },
  { id: 'vehicle-disarmed', label: 'Vehicle Disarmed', status: 'WAITING' },
];
