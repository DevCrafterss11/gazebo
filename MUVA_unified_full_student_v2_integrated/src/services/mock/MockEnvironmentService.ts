import type {
  EnvironmentLogEntry,
  EnvironmentRuntimeStatus,
  EnvironmentStartRequest,
  EnvironmentStartupState,
} from '../../types/environment';
import type { EnvironmentService, EnvironmentStateHandler } from '../contracts';

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const initialRuntime = (): EnvironmentRuntimeStatus => ({
  gazebo: 'STOPPED',
  ardupilotSitl: 'STOPPED',
  mavlinkGateway: 'DISCONNECTED',
  heartbeat: 'WAITING',
  gps: 'WAITING',
  ekf: 'WAITING',
  vehicle: 'UNAVAILABLE',
});

interface StartupPhaseDefinition {
  startup: EnvironmentStartupState;
  runtime: Partial<EnvironmentRuntimeStatus>;
}

export class MockEnvironmentService implements EnvironmentService {
  private readonly handlers = new Set<EnvironmentStateHandler>();
  private startup: EnvironmentStartupState = { phase: 'IDLE', progress: 0, message: '等待启动' };
  private runtime = initialRuntime();
  private logs: EnvironmentLogEntry[] = [];
  private runId = 0;

  async startEnvironment(_request: EnvironmentStartRequest): Promise<EnvironmentRuntimeStatus> {
    const runId = ++this.runId;
    this.runtime = initialRuntime();
    this.logs = [];
    const phases: StartupPhaseDefinition[] = [
      { startup: { phase: 'VALIDATING_CONFIG', progress: 7, message: '正在验证 ExperimentConfig' }, runtime: {} },
      { startup: { phase: 'LOADING_GAZEBO_WORLD', progress: 16, message: '正在加载 Gazebo World' }, runtime: {} },
      { startup: { phase: 'STARTING_GAZEBO', progress: 28, message: 'Gazebo 启动中' }, runtime: { gazebo: 'STARTING' } },
      { startup: { phase: 'STARTING_ARDUPILOT_SITL', progress: 42, message: 'ArduPilot SITL 启动中' }, runtime: { gazebo: 'RUNNING', ardupilotSitl: 'STARTING' } },
      { startup: { phase: 'STARTING_MAVLINK_GATEWAY', progress: 56, message: 'MAVLink Gateway 启动中' }, runtime: { ardupilotSitl: 'RUNNING', mavlinkGateway: 'STARTING' } },
      { startup: { phase: 'CONNECTING_MAVLINK', progress: 69, message: '正在建立 MAVLink JSON Gateway 连接' }, runtime: { mavlinkGateway: 'CONNECTING' } },
      { startup: { phase: 'WAITING_HEARTBEAT', progress: 81, message: '等待飞行器 Heartbeat' }, runtime: { mavlinkGateway: 'CONNECTED' } },
      { startup: { phase: 'VEHICLE_ONLINE', progress: 92, message: 'Heartbeat OK · Vehicle ONLINE' }, runtime: { heartbeat: 'OK', vehicle: 'ONLINE' } },
      { startup: { phase: 'READY', progress: 100, message: '仿真环境 READY' }, runtime: { gps: '3D FIX', ekf: 'HEALTHY' } },
    ];

    for (const phase of phases) {
      if (runId !== this.runId) throw new Error('仿真环境启动已取消');
      this.startup = phase.startup;
      this.runtime = { ...this.runtime, ...phase.runtime };
      this.logs = [...this.logs, { timestamp: new Date().toISOString(), phase: phase.startup.phase, message: phase.startup.message }];
      this.emit();
      await delay(720);
    }
    return { ...this.runtime };
  }

  async stopEnvironment(): Promise<void> {
    this.runId += 1;
    this.startup = { phase: 'IDLE', progress: 0, message: '环境已停止' };
    this.runtime = initialRuntime();
    this.logs = [];
    this.emit();
  }

  async getStatus(): Promise<EnvironmentRuntimeStatus> {
    return { ...this.runtime };
  }

  async getLogs(): Promise<EnvironmentLogEntry[]> {
    return this.logs.map((entry) => ({ ...entry }));
  }

  subscribe(handler: EnvironmentStateHandler): () => void {
    this.handlers.add(handler);
    handler(this.startup, this.runtime, this.logs);
    return () => this.handlers.delete(handler);
  }

  private emit(): void {
    const logs = this.logs.map((entry) => ({ ...entry }));
    this.handlers.forEach((handler) => handler({ ...this.startup }, { ...this.runtime }, logs));
  }
}
