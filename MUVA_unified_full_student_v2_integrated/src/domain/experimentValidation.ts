import type { ExperimentConfiguration, FlightParameters, PreflightChecklistItem } from '../types/configuration';
import type { PreflightCheckContext } from '../services/contracts';
import { defaultFlightControllerConfig } from '../mocks/configuration';

export const validateFlightParameters = (parameters: FlightParameters): string | null => {
  if (!Number.isFinite(parameters.takeoffAltitude) || parameters.takeoffAltitude < 1 || parameters.takeoffAltitude > 50) return '起飞高度应为 1–50 m';
  if (!Number.isFinite(parameters.maxAltitude) || parameters.maxAltitude < 1 || parameters.maxAltitude > 500) return '最大高度应为 1–500 m';
  if (parameters.takeoffAltitude > parameters.maxAltitude) return '起飞高度不能超过最大高度';
  if (!Number.isFinite(parameters.maxSpeed) || parameters.maxSpeed < 0.5 || parameters.maxSpeed > 20) return '最大速度应为 0.5–20 m/s';
  if (!Number.isFinite(parameters.rtlAltitude)) return '请输入有效的 RTL 高度';
  if (parameters.rtlAltitude < parameters.takeoffAltitude || parameters.rtlAltitude > parameters.maxAltitude) return 'RTL 高度应介于起飞高度和最大高度之间';
  if (!Number.isFinite(parameters.hoverDuration) || parameters.hoverDuration < 1 || parameters.hoverDuration > 120) return '悬停时间应为 1–120 秒';
  return null;
};

export const validateIrisBasicFlightConfig = (configuration: ExperimentConfiguration): string | null => {
  if (configuration.selectedDroneId !== 'iris-quadrotor-01') return '请先完成 Iris 四旋翼系统认知';
  if (Object.entries(defaultFlightControllerConfig).some(([key, value]) => configuration.flightController[key as keyof typeof configuration.flightController] !== value)) return '请恢复 Iris 四旋翼教学构型';
  return validateFlightParameters(configuration.flightParameters);
};

export const getPreflightFailureReason = (
  itemId: PreflightChecklistItem['id'],
  context: PreflightCheckContext,
): string | null => {
  const { configuration, runtime } = context;
  const sensor = configuration.sensors.find((candidate) => candidate.id === itemId);
  if (sensor) return sensor.status === 'PASS' ? null : `${sensor.name} 尚未通过系统检查`;
  switch (itemId) {
    case 'environment-ready': return context.environmentReady ? null : '仿真环境未 READY';
    case 'sitl-connected': return runtime.ardupilotSitl === 'RUNNING' ? null : 'ArduPilot SITL 未连接';
    case 'mavlink-connected': return runtime.mavlinkGateway === 'CONNECTED' ? null : 'MAVLink Gateway 未连接';
    case 'parameters': return validateFlightParameters(configuration.flightParameters);
    case 'home': return configuration.homePosition ? null : 'Home Position 未设置';
    case 'vehicle-disarmed': return context.vehicleArmed ? '飞行器必须处于未解锁状态' : null;
    default: return '配置项无效';
  }
};
