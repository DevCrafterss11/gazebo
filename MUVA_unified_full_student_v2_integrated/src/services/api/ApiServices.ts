import type { ExperimentConfiguration, PreflightChecklistItem, SensorCheckItem, TrainingScene } from '../../types/configuration';
import type { ExperimentProgressEvent } from '../../types/experiment';
import type { ExperimentOneAssessment } from '../../types/experiment1Assessment';
import type { DroneModel } from '../../types/drone';
import type { EnvironmentLogEntry, EnvironmentRuntimeStatus, EnvironmentStartRequest, EnvironmentStartupState } from '../../types/environment';
import type { Mission, MissionUpload } from '../../types/mission';
import type { ExperimentRecord } from '../../types/record';
import type { ExperimentResult } from '../../types/result';
import type { CreateExperimentSessionInput, ExperimentSession } from '../../types/session';
import type { SimulatedDroneState } from '../../types/simulator';
import type { FlightMapSnapshot } from '../../types/telemetry';
import type { DroneService, EnvironmentService, EnvironmentStateHandler, ExperimentService, FlightService, MissionService, PersistedExperimentState, PreflightCheckContext, SceneService, TelemetryService } from '../contracts';
import { assertBeforeArm, assertBeforeLand, assertBeforeRtl, assertBeforeTakeoff, type FlightSafetyContext } from '../../domain/flightSafety';
import { httpClient } from '../http/client';
import { WebSocketTelemetryService } from '../websocket/telemetrySocket';
import { showCheckSequence } from '../checkSequence';

const apiProgressStorageKey = (): string => `muva-experiment1-api-progress:${sessionStorage.getItem('muva-username') ?? 'student'}`;

export class ApiDroneService implements DroneService {
  async getDroneModels(): Promise<DroneModel[]> { return (await httpClient.get<DroneModel[]>('/v1/drones')).data; }
}
export class ApiSceneService implements SceneService {
  async getScenes(): Promise<TrainingScene[]> { return (await httpClient.get<TrainingScene[]>('/v1/scenes')).data; }
}
export class ApiExperimentService implements ExperimentService {
  async createExperiment(input: CreateExperimentSessionInput): Promise<ExperimentSession> { return (await httpClient.post<ExperimentSession>('/v1/experiments', input)).data; }
  async saveConfiguration(state: PersistedExperimentState): Promise<void> {
    await httpClient.post('/v1/experiments/configuration', state);
    if (state.progressId) localStorage.setItem(apiProgressStorageKey(), state.progressId);
  }
  async loadConfiguration(): Promise<PersistedExperimentState | null> {
    const progressId = localStorage.getItem(apiProgressStorageKey());
    if (!progressId) return null;
    if (progressId.startsWith('{')) {
      const legacy = JSON.parse(progressId) as PersistedExperimentState;
      if (!legacy.progressId) return null;
      await this.saveConfiguration(legacy);
      return legacy;
    }
    return (await httpClient.get<PersistedExperimentState | null>(`/v1/experiments/progress/${encodeURIComponent(progressId)}`)).data;
  }
  async startExperiment(experimentId: string): Promise<void> { await httpClient.post(`/v1/experiments/${experimentId}/start`); }
  async finishExperiment(experimentId: string, result: ExperimentResult): Promise<ExperimentResult> { return (await httpClient.post<ExperimentResult>(`/v1/experiments/${experimentId}/finish`, result)).data; }
  async saveRecord(record: ExperimentRecord): Promise<void> { await httpClient.post(`/v1/experiments/${record.id}/record`, record); }
  async listRecords(): Promise<ExperimentRecord[]> { return (await httpClient.get<ExperimentRecord[]>('/v1/experiments/records')).data; }
  async getRecord(recordId: string): Promise<ExperimentRecord | null> { return (await httpClient.get<ExperimentRecord | null>(`/v1/experiments/records/${recordId}`)).data; }
  async saveAssessment(assessment: ExperimentOneAssessment): Promise<void> { await httpClient.put(`/v1/experiments/${encodeURIComponent(assessment.sessionId)}/assessment`, assessment); }
  async loadAssessment(sessionId: string): Promise<ExperimentOneAssessment | null> {
    return (await httpClient.get<ExperimentOneAssessment | null>(`/v1/experiments/${encodeURIComponent(sessionId)}/assessment`)).data;
  }
  async clearConfiguration(): Promise<void> {
    const progressId = localStorage.getItem(apiProgressStorageKey());
    if (progressId && !progressId.startsWith('{')) await httpClient.delete(`/v1/experiments/progress/${encodeURIComponent(progressId)}`);
    localStorage.removeItem(apiProgressStorageKey());
  }
  async runSensorCheck(onUpdate: (items: SensorCheckItem[]) => void, onProgress?: (event: ExperimentProgressEvent) => void, signal?: AbortSignal): Promise<SensorCheckItem[]> {
    onProgress?.({ type: 'sensor_check', step: 'all', status: 'checking' });
    const items = (await httpClient.post<SensorCheckItem[]>('/v1/system/sensors/check', undefined, { signal })).data;
    return showCheckSequence(items, onUpdate, 'sensor_check', 520, onProgress, signal);
  }
  async runPreflightCheck(context: PreflightCheckContext, onUpdate: (items: PreflightChecklistItem[]) => void, onProgress?: (event: ExperimentProgressEvent) => void, signal?: AbortSignal): Promise<PreflightChecklistItem[]> {
    onProgress?.({ type: 'preflight_check', step: 'all', status: 'checking' });
    const items = (await httpClient.post<PreflightChecklistItem[]>('/v1/flight/preflight', context, { signal })).data;
    return showCheckSequence(items, onUpdate, 'preflight_check', 360, onProgress, signal);
  }
}
export class ApiEnvironmentService implements EnvironmentService {
  private readonly handlers = new Set<EnvironmentStateHandler>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private starting = false;
  private polling = false;
  private lastKnownReady = false;
  private currentPhase: EnvironmentStartupState['phase'] = 'IDLE';
  async startEnvironment(request: EnvironmentStartRequest): Promise<EnvironmentRuntimeStatus> {
    this.starting = true;
    this.emit({ phase: 'STARTING_GAZEBO', progress: 1, message: '请求后端启动环境...' }, this.emptyRuntime(), []);
    try {
      const runtime = (await httpClient.post<EnvironmentRuntimeStatus>('/v1/runtime/start', request, { timeout: 30_000 })).data;
      if (runtime.vehicle !== 'ONLINE') throw new Error('未收到飞行器 Heartbeat，环境未就绪');
      this.lastKnownReady = true;
      this.currentPhase = 'READY';
      this.emit({ phase: 'READY', progress: 100, message: '仿真环境 READY' }, runtime, await this.getLogs());
      return runtime;
    } catch (error: unknown) {
      this.lastKnownReady = false;
      this.currentPhase = 'ERROR';
      this.emit({ phase: 'ERROR', progress: 0, message: error instanceof Error ? error.message : '仿真环境启动失败' }, this.emptyRuntime(), await this.getLogs().catch(() => []));
      throw error;
    } finally {
      this.starting = false;
    }
  }
  async stopEnvironment(): Promise<void> {
    await httpClient.post('/v1/runtime/stop');
    this.lastKnownReady = false;
    this.currentPhase = 'IDLE';
    this.emit({ phase: 'IDLE', progress: 0, message: '环境已停止' }, this.emptyRuntime(), await this.getLogs());
  }
  async getStatus(): Promise<EnvironmentRuntimeStatus> { return (await httpClient.get<EnvironmentRuntimeStatus>('/v1/runtime/status')).data; }
  async getLogs(): Promise<EnvironmentLogEntry[]> { return (await httpClient.get<EnvironmentLogEntry[]>('/v1/runtime/logs')).data; }
  subscribe(handler: EnvironmentStateHandler): () => void {
    this.handlers.add(handler);
    void this.syncInitialState();
    if (!this.interval) this.interval = setInterval(() => { void this.syncInitialState(); }, 3000);
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0 && this.interval) { clearInterval(this.interval); this.interval = null; }
    };
  }
  private emit(startup: EnvironmentStartupState, runtime: EnvironmentRuntimeStatus, logs: EnvironmentLogEntry[]): void { this.handlers.forEach((handler) => handler(startup, runtime, logs)); }
  private emptyRuntime(): EnvironmentRuntimeStatus { return { gazebo: 'STOPPED', ardupilotSitl: 'STOPPED', mavlinkGateway: 'DISCONNECTED', heartbeat: 'WAITING', gps: 'WAITING', ekf: 'WAITING', vehicle: 'UNAVAILABLE' }; }
  private async syncInitialState(): Promise<void> {
    if (this.polling || this.starting) return;
    this.polling = true;
    try {
      const runtime = await this.getStatus();
      const logs = await this.getLogs();
      if (this.starting) return;
      const ready = runtime.vehicle === 'ONLINE';
      const phase = ready ? 'READY' : this.currentPhase === 'ERROR' || this.lastKnownReady ? 'ERROR' : 'IDLE';
      this.lastKnownReady = ready;
      this.currentPhase = phase;
      if (this.handlers.size) this.emit({ phase, progress: ready ? 100 : 0, message: ready ? '仿真环境 READY' : phase === 'ERROR' ? '飞行器连接中断' : '等待启动' }, runtime, logs);
    } catch (error: unknown) {
      if (this.starting) return;
      this.lastKnownReady = false;
      this.currentPhase = 'ERROR';
      if (this.handlers.size) this.emit({ phase: 'ERROR', progress: 0, message: error instanceof Error ? error.message : '无法连接网关' }, this.emptyRuntime(), []);
    } finally {
      this.polling = false;
    }
  }
}
export class ApiFlightService implements FlightService {
  async initialize(): Promise<void> { /* Runtime startup establishes the vehicle connection. */ }
  getState(): SimulatedDroneState | null { return null; }
  async beforeArmCheck(): Promise<void> { assertBeforeArm(await this.getSafetyContext()); }
  async beforeTakeoffCheck(altitudeMeters: number): Promise<void> { assertBeforeTakeoff(await this.getSafetyContext(), altitudeMeters); }
  async beforeLandCheck(): Promise<void> { assertBeforeLand(await this.getSafetyContext()); }
  async beforeRtlCheck(): Promise<void> { assertBeforeRtl(await this.getSafetyContext()); }
  async arm(): Promise<void> { await this.beforeArmCheck(); await httpClient.post('/v1/vehicle/arm'); }
  async disarm(): Promise<void> { await httpClient.post('/v1/vehicle/disarm'); }
  async takeoff(altitudeMeters: number): Promise<void> { await this.beforeTakeoffCheck(altitudeMeters); await httpClient.post('/v1/vehicle/takeoff', { altitudeMeters }, { timeout: 30_000 }); }
  async ascend(): Promise<void> { await this.move('up', 1); }
  async descend(): Promise<void> { await this.move('down', 1); }
  async moveForward(): Promise<void> { await this.move('forward', 5); }
  async moveBackward(): Promise<void> { await this.move('backward', 5); }
  async moveLeft(): Promise<void> { await this.move('left', 5); }
  async moveRight(): Promise<void> { await this.move('right', 5); }
  async yawLeft(): Promise<void> { await this.yaw('left', 15); }
  async yawRight(): Promise<void> { await this.yaw('right', 15); }
  async land(): Promise<void> { await this.beforeLandCheck(); await httpClient.post('/v1/vehicle/land'); }
  async rtl(): Promise<void> { await this.beforeRtlCheck(); await httpClient.post('/v1/vehicle/rtl'); }
  async hold(): Promise<void> { await httpClient.post('/v1/vehicle/hold'); }
  async move(direction: 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down', meters: number): Promise<void> { await httpClient.post('/v1/vehicle/move', { direction, meters }); }
  async yaw(direction: 'left' | 'right', degrees: number): Promise<void> { await httpClient.post('/v1/vehicle/yaw', { direction, degrees }); }
  async setMode(mode: 'GUIDED' | 'STABILIZE' | 'LOITER'): Promise<void> { await httpClient.post('/v1/vehicle/mode', { mode }); }
  private async getSafetyContext(): Promise<FlightSafetyContext> { return (await httpClient.get<FlightSafetyContext>('/v1/vehicle/safety')).data; }
}
export class ApiMissionService implements MissionService {
  async getCurrentMission(): Promise<Mission | null> { return (await httpClient.get<Mission | null>('/v1/missions/current', { timeout: 30_000 })).data; }
  async uploadMission(mission: MissionUpload): Promise<Mission> { return (await httpClient.post<Mission>('/v1/missions/upload', mission, { timeout: 120_000 })).data; }
  async startMission(): Promise<void> { await httpClient.post('/v1/missions/start'); }
  async clearMission(): Promise<void> { await httpClient.post('/v1/missions/clear'); }
}
/** Telemetry is Gateway JSON only; browser code never handles MAVLink frames. */
interface VehicleMapResponse {
  home: { valid: boolean; latitude: number; longitude: number; altitude: number };
  track: Array<{ timestamp: number; latitude: number; longitude: number; altitude: number }>;
}

export class ApiTelemetryService extends WebSocketTelemetryService implements TelemetryService {
  async getFlightMap(): Promise<FlightMapSnapshot> {
    const snapshot = (await httpClient.get<VehicleMapResponse>('/vehicle')).data;
    const home = snapshot.home.valid ? {
      latitude: snapshot.home.latitude,
      longitude: snapshot.home.longitude,
      altitude: snapshot.home.altitude,
    } : null;
    const originLatitude = home?.latitude ?? snapshot.track[0]?.latitude ?? 0;
    const originLongitude = home?.longitude ?? snapshot.track[0]?.longitude ?? 0;
    const longitudeScale = 111_111 * Math.cos((originLatitude * Math.PI) / 180);
    return {
      home,
      track: snapshot.track.map((point) => ({
        ...point,
        timestamp: point.timestamp * 1000,
        north: (point.latitude - originLatitude) * 111_111,
        east: (point.longitude - originLongitude) * longitudeScale,
      })),
    };
  }
}
