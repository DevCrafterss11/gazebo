import type { TelemetrySample } from '../../types/telemetry';
import type { AssessmentRuntime } from '../mock/MockAssessmentRuntime';
import type { SimulationSnapshot } from '../../domain/assessment/model';
import { httpClient } from '../http/client';
import { WebSocketTelemetryService } from '../websocket/telemetrySocket';
import { isRealTelemetryReady, toLocalPoint, toViewAttitude, type HomeCoordinates } from './coordinates';

export type AssessmentSource = 'mock' | 'real';
export const assessmentSource: AssessmentSource = import.meta.env.VITE_ASSESSMENT_SOURCE === 'real' ? 'real' : 'mock';

export interface CommandResponse { accepted: boolean; detail: string }
export interface AssessmentDroneAdapter {
  readonly source: AssessmentSource;
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(handler: (sample: TelemetrySample, flight: SimulationSnapshot | null) => void): () => void;
  isFresh(): boolean;
  send(action: string, value?: number | { x: number; z: number }): Promise<CommandResponse>;
}

export class MockDroneAdapter implements AssessmentDroneAdapter {
  readonly source = 'mock';
  constructor(private readonly runtime: AssessmentRuntime) {}
  async connect(): Promise<void> { /* The step-4 startup flow owns the simulation lifecycle. */ }
  disconnect(): void { /* Only the step-4 stop action may stop the mock simulation. */ }
  subscribe(handler: (sample: TelemetrySample, flight: SimulationSnapshot) => void): () => void {
    return this.runtime.subscribe((flight) => handler(this.runtime.telemetry(), flight));
  }
  isFresh(): boolean { return this.runtime.snapshot().telemetryTimestamp > Date.now() - 3000; }
  async send(action: string, value?: number | { x: number; z: number }): Promise<CommandResponse> {
    this.runtime.command(action, value);
    return { accepted: true, detail: 'Mock Runtime 已接受，任务完成仍需遥测验证' };
  }
}

interface VehicleSnapshot {
  connection: { connected: boolean };
  home: { valid: boolean; latitude: number; longitude: number; altitude: number };
}

export class RealMavlinkAdapter implements AssessmentDroneAdapter {
  readonly source = 'real';
  private readonly telemetry = new WebSocketTelemetryService();
  private home: HomeCoordinates | null = null;
  private active = false;
  private readonly listeners = new Set<(sample: TelemetrySample, flight: SimulationSnapshot | null) => void>();
  private unsubscribe: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
  private latest: TelemetrySample | null = null;
  private socketConnected = false;
  private connecting: Promise<void> | null = null;
  isFresh(): boolean { return this.active && this.socketConnected && isRealTelemetryReady(this.latest) && this.home !== null; }
  async connect(): Promise<void> {
    if (this.active) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectGateway();
    try { await this.connecting; } finally { this.connecting = null; }
  }
  private async connectGateway(): Promise<void> {
    const health = (await httpClient.get<{ status: string; vehicleConnected: boolean }>('/health')).data;
    if (health.status !== 'ok') throw new Error('Gateway 未就绪');
    const vehicle = (await httpClient.get<VehicleSnapshot>('/vehicle')).data;
    this.home = vehicle.home.valid && Number.isFinite(vehicle.home.latitude) && Number.isFinite(vehicle.home.longitude) && Number.isFinite(vehicle.home.altitude)
      ? { latitude: vehicle.home.latitude, longitude: vehicle.home.longitude, altitude: vehicle.home.altitude } : null;
    this.unsubscribe = this.telemetry.subscribe((sample) => {
      this.latest = sample;
      const point = toLocalPoint(sample, this.home);
      const valid = this.socketConnected && isRealTelemetryReady(sample) && point !== null;
      const flight: SimulationSnapshot | null = valid && point ? {
        position: point, attitude: toViewAttitude(sample.attitude), velocity: { vx: 0, vy: 0, vz: 0 },
        battery: sample.batteryPercent, armed: sample.armed === true, airborne: point.y > 0.15,
        mode: sample.mode ?? 'UNKNOWN', flightStatus: 'OBSERVED',
        homePosition: { x: 0, y: 0, z: 0 }, targetPosition: { ...point }, telemetryTimestamp: sample.snapshotTimestamp ?? 0, paused: false,
      } : null;
      this.listeners.forEach((listener) => listener(sample, flight));
    });
    this.unsubscribeState = this.telemetry.subscribeToConnectionState((state) => {
      this.socketConnected = state === 'connected';
      if (!this.socketConnected) {
        this.latest = null;
        this.listeners.forEach((listener) => listener(this.unavailableSample(), null));
      }
    });
    this.active = true;
    this.telemetry.connect();
  }
  private unavailableSample(): TelemetrySample {
    return { timestamp: 0, source: 'mavlink', position: { latitude: 0, longitude: 0, altitude: 0 },
      attitude: { roll: 0, pitch: 0, yaw: 0 }, speedMetersPerSecond: 0, batteryPercent: 0,
      gpsSatellites: 0, ekfStatus: { healthy: false, state: 'UNKNOWN' },
      mavlinkStatus: { connected: false, heartbeat: false, version: 'UNKNOWN' } };
  }
  disconnect(): void {
    this.active = false;
    this.socketConnected = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.telemetry.disconnect();
    this.home = null;
    this.latest = null;
  }
  subscribe(handler: (sample: TelemetrySample, flight: SimulationSnapshot | null) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
  async send(): Promise<CommandResponse> {
    throw new Error('只读真实观测：网关没有跨实验飞控资源租约，不发送控制命令');
  }
}
