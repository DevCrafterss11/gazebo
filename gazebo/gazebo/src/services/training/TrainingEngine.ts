import type { FlightParameters, SceneLocation } from '../../types/configuration';
import type { TrainingTask, TrainingTaskStatus } from '../../types/experiment';
import type { ExperimentResult } from '../../types/result';
import type { TelemetrySample } from '../../types/telemetry';
import type { ExperimentTimelineEvent } from '../../types/record';

const taskTitles = [
  'ARM',
  '起飞',
  '悬停 10 秒',
  '上升至 15m',
  '下降至 8m',
  '前进 20m',
  '右移 15m',
  '偏航 90°',
  '执行返航',
  '安全降落',
] as const;

const taskDetails = [
  ['解锁飞行器', 'Vehicle 状态变为 ARMED'], ['起飞至目标高度', '高度达到配置的 Takeoff Altitude'], ['稳定悬停', '高度误差 ±1m 且速度低于 0.35m/s，达到配置时长'], ['上升至 15m', '高度达到 15m'], ['下降至 8m', '高度下降到 8m'], ['前进 20m', '北向位移达到 20m'], ['右移 15m', '东向位移达到 15m'], ['偏航 90°', '偏航角变化达到 90°'], ['返航 Home', 'RTL 后返回 Home 附近'], ['安全降落', 'LAND 后高度为 0 且自动上锁'],
] as const;

const distanceMeters = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number => {
  const latitudeMeters = (a.latitude - b.latitude) * 111_111;
  const longitudeScale = 111_111 * Math.cos((a.latitude * Math.PI) / 180);
  const longitudeMeters = (a.longitude - b.longitude) * longitudeScale;
  return Math.hypot(latitudeMeters, longitudeMeters);
};

export interface TrainingSnapshot {
  tasks: TrainingTask[];
  activeTaskIndex: number;
  hoverSeconds: number;
  startedAt: number;
  maxAltitude: number;
  maxSpeed: number;
  averageAltitudeError: number;
  safetyEvents: string[];
  eventTimeline: ExperimentTimelineEvent[];
  result: ExperimentResult | null;
}

export class TrainingEngine {
  private tasks: TrainingTask[] = taskTitles.map((title, index) => ({
    id: index + 1,
    title,
    status: index === 0 ? 'ACTIVE' : 'LOCKED',
    goal: taskDetails[index]?.[0] ?? title,
    completionCondition: taskDetails[index]?.[1] ?? '',
    progress: 0,
  }));
  private activeTaskIndex = 0;
  private hoverMilliseconds = 0;
  private previousTimestamp: number | null = null;
  private taskStartSample: TelemetrySample | null = null;
  private maxAltitude = 0;
  private maxSpeed = 0;
  private altitudeErrorTotal = 0;
  private altitudeErrorSamples = 0;
  private readonly startedAt = Date.now();
  private readonly safetyEvents: string[] = [];
  private readonly eventTimeline: ExperimentTimelineEvent[] = [{ timestamp: new Date().toISOString(), type: 'TRAINING', message: '基础飞行训练开始' }];
  private result: ExperimentResult | null = null;

  constructor(
    private readonly parameters: FlightParameters,
    private readonly home: SceneLocation,
    private readonly droneName: string,
    private readonly sceneName: string,
  ) {}

  process(sample: TelemetrySample): TrainingSnapshot {
    if (this.result) return this.snapshot();
    this.maxAltitude = Math.max(this.maxAltitude, sample.position.altitude);
    this.maxSpeed = Math.max(this.maxSpeed, sample.groundSpeed ?? sample.speedMetersPerSecond);
    const deltaMilliseconds = this.previousTimestamp === null
      ? 0
      : Math.min(500, Math.max(0, sample.timestamp - this.previousTimestamp));
    this.previousTimestamp = sample.timestamp;
    if (!this.taskStartSample) this.taskStartSample = sample;

    let completed = false;
    switch (this.activeTaskIndex) {
      case 0:
        completed = Boolean(sample.armed);
        break;
      case 1:
        completed = Boolean(sample.armed) && sample.position.altitude >= this.parameters.takeoffAltitude - 0.5;
        break;
      case 2: {
        const stableAltitude = Math.abs(sample.position.altitude - this.parameters.takeoffAltitude) <= 1;
        const stableSpeed = (sample.groundSpeed ?? sample.speedMetersPerSecond) < 0.35;
        this.altitudeErrorTotal += Math.abs(sample.position.altitude - this.parameters.takeoffAltitude);
        this.altitudeErrorSamples += 1;
        this.hoverMilliseconds = stableAltitude && stableSpeed ? this.hoverMilliseconds + deltaMilliseconds : 0;
        completed = this.hoverMilliseconds >= this.parameters.hoverDuration * 1_000;
        break;
      }
      case 3:
        completed = sample.position.altitude >= 14.8;
        break;
      case 4:
        completed = sample.position.altitude <= 8.2;
        break;
      case 5:
        completed = this.taskDistance(sample) >= 19.5;
        break;
      case 6:
        completed = this.taskDistance(sample) >= 14.5;
        break;
      case 7:
        completed = this.taskYawDelta(sample) >= 88;
        break;
      case 8:
        completed = sample.mode === 'RTL' && distanceMeters(sample.position, this.home) <= 1;
        break;
      case 9:
        completed = sample.position.altitude < 0.2 && sample.armed === false;
        break;
      default:
        break;
    }

    this.updateProgress(sample);
    if (completed) this.completeActiveTask(sample);
    return this.snapshot();
  }

  recordSafetyEvent(message: string): TrainingSnapshot {
    this.safetyEvents.push(message);
    this.eventTimeline.push({ timestamp: new Date().toISOString(), type: 'SAFETY', message });
    return this.snapshot();
  }

  snapshot(): TrainingSnapshot {
    return {
      tasks: this.tasks.map((task) => ({ ...task })),
      activeTaskIndex: this.activeTaskIndex,
      hoverSeconds: this.hoverMilliseconds / 1_000,
      startedAt: this.startedAt,
      maxAltitude: this.maxAltitude,
      maxSpeed: this.maxSpeed,
      averageAltitudeError: this.altitudeErrorSamples > 0 ? this.altitudeErrorTotal / this.altitudeErrorSamples : 0,
      safetyEvents: [...this.safetyEvents],
      eventTimeline: this.eventTimeline.map((event) => ({ ...event })),
      result: this.result,
    };
  }

  private taskDistance(sample: TelemetrySample): number {
    return this.taskStartSample ? distanceMeters(sample.position, this.taskStartSample.position) : 0;
  }

  private taskYawDelta(sample: TelemetrySample): number {
    if (!this.taskStartSample) return 0;
    const difference = Math.abs(sample.attitude.yaw - this.taskStartSample.attitude.yaw);
    return Math.min(difference, 360 - difference);
  }

  private completeActiveTask(sample: TelemetrySample): void {
    const completedTask = this.tasks[this.activeTaskIndex];
    if (completedTask) this.eventTimeline.push({ timestamp: new Date(sample.timestamp).toISOString(), type: 'TASK_COMPLETED', message: `${completedTask.title} 完成` });
    this.tasks = this.tasks.map((task, index) => ({
      ...task,
      status: (index < this.activeTaskIndex + 1 ? 'COMPLETED' : index === this.activeTaskIndex + 1 ? 'ACTIVE' : 'LOCKED') as TrainingTaskStatus,
      progress: index <= this.activeTaskIndex ? 100 : 0,
    }));
    this.activeTaskIndex += 1;
    this.taskStartSample = sample;
    if (this.activeTaskIndex >= this.tasks.length) {
      this.result = this.createResult();
    }
  }

  private createResult(): ExperimentResult {
    const completedTasks = this.tasks.filter((task) => task.status === 'COMPLETED').length;
    const completionRate = Math.round((completedTasks / this.tasks.length) * 100);
    const averageAltitudeError = this.altitudeErrorSamples > 0
      ? this.altitudeErrorTotal / this.altitudeErrorSamples
      : 0;
    const stabilityScore = Math.max(0, 20 - averageAltitudeError * 8);
    const safetyScore = Math.max(0, 20 - this.safetyEvents.length * 5);
    const score = Math.round(completionRate * 0.6 + stabilityScore + safetyScore);
    return {
      experimentName: '实验一：ArduPilot 四旋翼无人机配置与基础飞行操作',
      droneName: this.droneName,
      sceneName: this.sceneName,
      durationSeconds: Math.round((Date.now() - this.startedAt) / 1_000),
      score: Math.min(100, score),
      completionRate,
      completedTasks,
      failedTasks: 0,
      maxAltitude: this.maxAltitude,
      maxSpeed: this.maxSpeed,
      averageAltitudeError,
      safetyEvents: [...this.safetyEvents],
      completedAt: new Date().toISOString(),
    };
  }

  private updateProgress(sample: TelemetrySample): void {
    const progress = (() => {
      switch (this.activeTaskIndex) {
        case 0: return sample.armed ? 100 : 0;
        case 1: return Math.min(100, sample.position.altitude / this.parameters.takeoffAltitude * 100);
        case 2: return Math.min(100, this.hoverMilliseconds / (this.parameters.hoverDuration * 1_000) * 100);
        case 3: return Math.min(100, sample.position.altitude / 15 * 100);
        case 4: return Math.min(100, (15 - sample.position.altitude) / 7 * 100);
        case 5: return Math.min(100, this.taskDistance(sample) / 20 * 100);
        case 6: return Math.min(100, this.taskDistance(sample) / 15 * 100);
        case 7: return Math.min(100, this.taskYawDelta(sample) / 90 * 100);
        case 8: return Math.min(100, (1 - Math.min(1, distanceMeters(sample.position, this.home) / 20)) * 100);
        case 9: return sample.position.altitude < 0.2 ? 100 : Math.max(0, (1 - sample.position.altitude / 8) * 100);
        default: return 100;
      }
    })();
    this.tasks = this.tasks.map((task, index) => index === this.activeTaskIndex ? { ...task, progress } : task);
  }
}
