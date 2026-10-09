import type { TelemetrySample } from '../../types/telemetry';
import { tasks, toleranceScale, type AssessmentConfig, type SceneConfig, type TaskResult } from './model';

const yawError = (actual: number, target: number) => Math.abs(((actual - target + 540) % 360) - 180);
const northEast = (sample: TelemetrySample, origin: TelemetrySample) => ({
  north: (sample.north ?? (sample.position.latitude - origin.position.latitude) * 111111) - (origin.north ?? 0),
  east: (sample.east ?? (sample.position.longitude - origin.position.longitude) * 111111 * Math.cos(origin.position.latitude * Math.PI / 180)) - (origin.east ?? 0),
});
export class TrainingRuleEngine {
  private origin: TelemetrySample | null = null;
  private stableSince = 0;
  private climbed = false;
  private commandAccepted = false;
  private returnedHome = false;
  private hoverCommand = false;
  private maneuverObserved = false;
  private pausedAt = 0;
  constructor(private readonly config: AssessmentConfig, private readonly scene?: SceneConfig) {}
  start(sample: TelemetrySample): void { this.origin = sample; this.stableSince = 0; this.pausedAt = 0; this.climbed = false; this.commandAccepted = false; this.returnedHome = false; this.hoverCommand = false; this.maneuverObserved = false; }
  pause(now = Date.now()): void { this.pausedAt = now; }
  resume(now = Date.now()): void { if (this.pausedAt && this.stableSince) this.stableSince += Math.max(0, now - this.pausedAt); this.pausedAt = 0; }
  acceptCommand(): void { this.commandAccepted = true; }
  beginHover(): void { this.hoverCommand = true; this.stableSince = 0; }
  interruptStability(): void { this.stableSince = 0; }
  evaluate(task: TaskResult, sample: TelemetrySample, now = Date.now()): TaskResult {
    if (this.pausedAt || task.status !== 'RUNNING' || !this.origin || !Number.isFinite(sample.timestamp) || now - sample.timestamp > 3000 || sample.timestamp > now + 1000 || !sample.mavlinkStatus.connected || !sample.mavlinkStatus.heartbeat || ![sample.position.altitude, sample.position.latitude, sample.position.longitude, sample.attitude.yaw, sample.speedMetersPerSecond].every(Number.isFinite)) return task;
    const definition = tasks.find((item) => item.taskId === task.taskId);
    if (!definition) return task;
    const displacement = northEast(sample, this.origin);
    const heading = this.origin.attitude.yaw * Math.PI / 180;
    const target = task.taskId === 'target' && this.scene ? { north: -this.scene.targetPosition.z - (this.origin.north ?? 0), east: this.scene.targetPosition.x - (this.origin.east ?? 0) } : task.taskId === 'lateral' ? { north: -5 * Math.sin(heading), east: 5 * Math.cos(heading) } : { north: 5 * Math.cos(heading), east: 5 * Math.sin(heading) };
    const tolerance = definition.tolerance * toleranceScale(this.config);
    const distanceToGoal = Math.hypot(displacement.north - target.north, displacement.east - target.east);
    const metrics = { altitudeError: Math.abs(sample.position.altitude - this.config.altitude), positionError: ['forward', 'lateral', 'target'].includes(task.taskId) ? distanceToGoal : Math.hypot(displacement.north, displacement.east), speed: sample.speedMetersPerSecond, yawError: yawError(sample.attitude.yaw, this.origin.attitude.yaw + 90) };
    if (task.taskId === 'composite' && (metrics.positionError >= 2 || yawError(sample.attitude.yaw, this.origin.attitude.yaw) >= 20)) this.maneuverObserved = true;
    let valid = false;
    switch (task.taskId) {
      case 'arm': valid = sample.armed === true && sample.position.altitude < 0.2; break;
      case 'takeoff': valid = sample.armed === true && metrics.altitudeError <= tolerance && metrics.speed < 0.6; break;
      case 'hover': valid = this.hoverCommand && metrics.altitudeError <= 0.8 * toleranceScale(this.config) && metrics.positionError <= tolerance && metrics.speed <= 0.6 && sample.armed === true; break;
      case 'vertical': if (sample.position.altitude >= this.config.altitude + 2.2) this.climbed = true; valid = this.climbed && metrics.altitudeError <= tolerance; break;
      case 'forward': case 'lateral': case 'target': valid = metrics.positionError <= tolerance && metrics.speed < 0.8 && metrics.altitudeError <= 0.8 * toleranceScale(this.config); break;
      case 'yaw': valid = metrics.yawError <= tolerance && metrics.speed < 0.8; break;
      case 'composite': valid = this.commandAccepted && this.maneuverObserved && metrics.altitudeError <= tolerance && metrics.speed <= 0.6 && sample.armed === true; break;
      case 'rtl': {
        const homeDistance = Math.hypot(sample.north ?? 999, sample.east ?? 999);
        if (this.commandAccepted && (sample.mode === 'RTL' || sample.mode === 'LAND') && homeDistance <= tolerance && sample.armed) this.returnedHome = true;
        valid = this.returnedHome && sample.armed === false && sample.position.altitude < 0.2 && (sample.flightState === 'grounded' || sample.mode === 'LAND') && homeDistance <= tolerance;
        break;
      }
    }
    if (!valid) this.stableSince = 0;
    else if (!this.stableSince) this.stableSince = now;
    const duration = task.taskId === 'hover' ? this.config.hoverSeconds : definition.duration;
    const stableSeconds = valid ? Math.min(duration, (now - this.stableSince) / 1000) : 0;
    const feedback = valid ? duration && stableSeconds < duration ? `已达标，请继续稳定 ${Math.ceil(duration - stableSeconds)} 秒` : '遥测条件达标' : task.taskId === 'composite' && !this.maneuverObserved ? '先移动至少 2m 或转向 20°，再稳定悬停' : task.taskId === 'rtl' ? '需返回 Home 并完成降落' : task.taskId === 'vertical' && !this.climbed ? '先上升至少 2.2m' : metrics.altitudeError > 0.8 * toleranceScale(this.config) && task.taskId !== 'arm' ? `高度偏差 ${metrics.altitudeError.toFixed(1)}m` : ['forward', 'lateral', 'target', 'hover'].includes(task.taskId) && metrics.positionError > tolerance ? `距离目标 ${metrics.positionError.toFixed(1)}m` : metrics.speed > 0.8 ? `速度 ${metrics.speed.toFixed(1)}m/s，需稳定` : '继续按目标操控';
    const next = { ...task, metrics, stableSeconds, tolerance, feedback };
    return valid && stableSeconds >= duration ? { ...next, status: 'PASSED', completedAt: now } : next;
  }
}
