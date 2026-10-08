import type { TelemetrySample } from '../../types/telemetry';
import { tasks, type AssessmentConfig, type TaskResult } from './model';

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
  constructor(private readonly config: AssessmentConfig) {}
  start(sample: TelemetrySample): void { this.origin = sample; this.stableSince = 0; this.climbed = false; this.commandAccepted = false; this.returnedHome = false; this.hoverCommand = false; }
  acceptCommand(): void { this.commandAccepted = true; }
  beginHover(): void { this.hoverCommand = true; this.stableSince = 0; }
  interruptStability(): void { this.stableSince = 0; }
  evaluate(task: TaskResult, sample: TelemetrySample, now = Date.now()): TaskResult {
    if (task.status !== 'RUNNING' || !this.origin || !Number.isFinite(sample.timestamp) || now - sample.timestamp > 3000 || sample.timestamp > now + 1000 || !sample.mavlinkStatus.connected || !sample.mavlinkStatus.heartbeat || ![sample.position.altitude, sample.position.latitude, sample.position.longitude, sample.attitude.yaw, sample.speedMetersPerSecond].every(Number.isFinite)) return task;
    const definition = tasks.find((item) => item.taskId === task.taskId);
    if (!definition) return task;
    const displacement = northEast(sample, this.origin);
    const heading = this.origin.attitude.yaw * Math.PI / 180;
    const target = task.taskId === 'lateral' ? { north: -5 * Math.sin(heading), east: 5 * Math.cos(heading) } : { north: 5 * Math.cos(heading), east: 5 * Math.sin(heading) };
    const metrics = { altitudeError: Math.abs(sample.position.altitude - this.config.altitude), positionError: Math.hypot(displacement.north, displacement.east), speed: sample.speedMetersPerSecond, yawError: yawError(sample.attitude.yaw, this.origin.attitude.yaw + 90) };
    let valid = false;
    switch (task.taskId) {
      case 'arm': valid = sample.armed === true && sample.position.altitude < 0.2; break;
      case 'takeoff': valid = sample.armed === true && metrics.altitudeError <= definition.tolerance; break;
      case 'hover': valid = this.hoverCommand && metrics.altitudeError <= 0.8 && metrics.positionError <= definition.tolerance && metrics.speed <= 0.6 && sample.armed === true; break;
      case 'vertical': if (sample.position.altitude >= this.config.altitude + 2.2) this.climbed = true; valid = this.climbed && metrics.altitudeError <= definition.tolerance; break;
      case 'forward': case 'lateral': case 'target': valid = Math.hypot(displacement.north - target.north, displacement.east - target.east) <= definition.tolerance && metrics.speed < 0.8; break;
      case 'yaw': valid = metrics.yawError <= definition.tolerance && metrics.speed < 0.8; break;
      case 'composite': valid = this.commandAccepted && metrics.altitudeError <= definition.tolerance && metrics.speed <= 0.6 && sample.armed === true; break;
      case 'rtl': {
        const homeDistance = Math.hypot(sample.north ?? 999, sample.east ?? 999);
        if (this.commandAccepted && (sample.mode === 'RTL' || sample.mode === 'LAND') && homeDistance <= definition.tolerance && sample.armed) this.returnedHome = true;
        valid = this.returnedHome && sample.armed === false && sample.position.altitude < 0.2 && (sample.flightState === 'grounded' || sample.mode === 'LAND') && homeDistance <= definition.tolerance;
        break;
      }
    }
    if (!valid) this.stableSince = 0;
    else if (!this.stableSince) this.stableSince = now;
    const duration = task.taskId === 'hover' ? this.config.hoverSeconds : definition.duration;
    return valid && (duration === 0 || now - this.stableSince >= duration * 1000) ? { ...task, status: 'PASSED', completedAt: now, metrics } : { ...task, metrics };
  }
}
