export interface FlightSafetyContext {
  environmentReady: boolean;
  vehicleOnline: boolean;
  mavlinkConnected: boolean;
  ekfHealthy: boolean;
  gpsSatellites: number;
  batteryPercent: number;
  armed: boolean;
  altitude: number;
  maxAltitude: number;
  homePosition: { latitude: number; longitude: number; altitude: number } | null;
}

export class FlightSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlightSafetyError';
  }
}

export function assertBeforeArm(context: FlightSafetyContext): void {
  assertConnected(context);
  if (context.armed) throw new FlightSafetyError('无人机已经解锁');
}

export function assertBeforeTakeoff(context: FlightSafetyContext, altitudeMeters: number): void {
  assertConnected(context);
  if (!context.armed) throw new FlightSafetyError('请先执行 ARM 再起飞');
  if (!Number.isFinite(altitudeMeters) || altitudeMeters <= 0 || altitudeMeters > context.maxAltitude) throw new FlightSafetyError(`起飞高度必须介于 0 和 ${context.maxAltitude} m 之间`);
}

export function assertBeforeLand(context: FlightSafetyContext): void {
  if (!context.environmentReady || !context.vehicleOnline || !context.mavlinkConnected) throw new FlightSafetyError('飞行环境或 MAVLink 尚未就绪');
  if (!context.armed) throw new FlightSafetyError('无人机未解锁，不能 LAND');
}

export function assertBeforeRtl(context: FlightSafetyContext): void {
  assertConnected(context);
  if (!context.armed || context.altitude < 0.2) throw new FlightSafetyError('地面状态不能执行 RTL');
  if (!context.homePosition) throw new FlightSafetyError('Home Position 未设置，不能 RTL');
}

export function assertBeforeControl(context: FlightSafetyContext): void {
  assertConnected(context);
}

function assertConnected(context: FlightSafetyContext): void {
  if (!context.environmentReady) throw new FlightSafetyError('仿真环境尚未 READY');
  if (!context.vehicleOnline) throw new FlightSafetyError('Vehicle 尚未 ONLINE');
  if (!context.mavlinkConnected) throw new FlightSafetyError('MAVLink 尚未连接');
  if (!context.ekfHealthy) throw new FlightSafetyError('EKF 状态异常');
  if (context.gpsSatellites < 6) throw new FlightSafetyError('GPS 卫星数不足');
  if (context.batteryPercent <= 5) throw new FlightSafetyError('电池电量过低');
}
