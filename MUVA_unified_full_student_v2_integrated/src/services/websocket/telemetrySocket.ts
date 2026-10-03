import type { TelemetryConnectionState, TelemetryMessageEnvelope, TelemetrySample } from '../../types/telemetry';
import { parseTelemetryEnvelope } from './telemetrySchema';

export type TelemetryMessageHandler = (sample: TelemetrySample) => void;
export type ConnectionStateHandler = (state: TelemetryConnectionState) => void;

export interface TelemetrySocketService {
  readonly endpoint: string;
  connect(): void;
  disconnect(): void;
  subscribe(handler: TelemetryMessageHandler): () => void;
  subscribeToConnectionState(handler: ConnectionStateHandler): () => void;
}

export class WebSocketTelemetryService implements TelemetrySocketService {
  readonly endpoint: string;

  private readonly messageHandlers = new Set<TelemetryMessageHandler>();
  private readonly stateHandlers = new Set<ConnectionStateHandler>();
  private socket: WebSocket | null = null;

  constructor(endpoint = import.meta.env.VITE_TELEMETRY_WS_URL ?? 'ws://localhost:8000/ws/telemetry') {
    this.endpoint = endpoint;
  }

  connect(): void {
    if (this.socket) return;
    this.emitConnectionState('connecting');
    this.socket = new WebSocket(this.endpoint);
    this.socket.onopen = () => this.emitConnectionState('connected');
    this.socket.onclose = () => { this.socket = null; this.emitConnectionState('disconnected'); };
    this.socket.onerror = (event: Event) => {
      console.error('Telemetry WebSocket error', event);
      this.emitConnectionState('error');
    };
    this.socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const envelope = parseTelemetryEnvelope(JSON.parse(event.data) as unknown);
        const sample = this.toTelemetrySample(envelope);
        this.messageHandlers.forEach((handler) => handler(sample));
      } catch (error: unknown) {
        console.error('Invalid telemetry message received from Gateway', error);
        this.emitConnectionState('error');
      }
    };
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.emitConnectionState('disconnected');
  }

  subscribe(handler: TelemetryMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  subscribeToConnectionState(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private emitConnectionState(state: TelemetryConnectionState): void {
    this.stateHandlers.forEach((handler) => handler(state));
  }

  private latest: TelemetrySample = {
    timestamp: 0,
    position: { latitude: 0, longitude: 0, altitude: 0 },
    attitude: { roll: 0, pitch: 0, yaw: 0 },
    speedMetersPerSecond: 0,
    batteryPercent: 0,
    gpsSatellites: 0,
    ekfStatus: { healthy: false, state: 'UNAVAILABLE' },
    mavlinkStatus: { connected: false, heartbeat: false, version: 'UNKNOWN' },
  };

  private toTelemetrySample(envelope: TelemetryMessageEnvelope): TelemetrySample {
    const metadata = { timestamp: envelope.timestamp, vehicleId: envelope.vehicleId, sequence: envelope.sequence, source: envelope.source };
    switch (envelope.payload.type) {
      case 'SNAPSHOT':
        return {
          ...metadata,
          position: { ...envelope.payload.position },
          attitude: { ...envelope.payload.attitude },
          speedMetersPerSecond: envelope.payload.velocity.groundSpeed,
          groundSpeed: envelope.payload.velocity.groundSpeed,
          batteryPercent: envelope.payload.batteryPercent,
          gpsSatellites: envelope.payload.gps.satellites,
          ekfStatus: { ...envelope.payload.health.ekfStatus },
          mavlinkStatus: { ...envelope.payload.health.mavlinkStatus },
          armed: envelope.payload.system.armed,
          mode: envelope.payload.system.mode,
          north: envelope.payload.position.north,
          east: envelope.payload.position.east,
        };
      case 'HEARTBEAT':
        this.latest = { ...this.latest, ...metadata, armed: envelope.payload.armed, mode: envelope.payload.mode, mavlinkStatus: { connected: true, heartbeat: true, version: envelope.payload.version ?? this.latest.mavlinkStatus.version } };
        break;
      case 'ESTIMATOR_STATUS':
        this.latest = { ...this.latest, ...metadata, ekfStatus: { healthy: envelope.payload.healthy, state: envelope.payload.state } };
        break;
      case 'POSITION':
        this.latest = { ...this.latest, ...metadata, position: { latitude: envelope.payload.latitude, longitude: envelope.payload.longitude, altitude: envelope.payload.altitude }, speedMetersPerSecond: envelope.payload.groundSpeed ?? this.latest.speedMetersPerSecond, groundSpeed: envelope.payload.groundSpeed, north: envelope.payload.north, east: envelope.payload.east };
        break;
      case 'ATTITUDE':
        this.latest = { ...this.latest, ...metadata, attitude: { roll: envelope.payload.roll, pitch: envelope.payload.pitch, yaw: envelope.payload.yaw } };
        break;
      case 'GPS':
        this.latest = { ...this.latest, ...metadata, gpsSatellites: envelope.payload.satellites };
        break;
      case 'BATTERY':
        this.latest = { ...this.latest, ...metadata, batteryPercent: envelope.payload.percent };
        break;
      case 'FLIGHT_STATE':
        this.latest = { ...this.latest, ...metadata, flightState: envelope.payload.state };
        break;
    }
    return this.latest;
  }
}

export const telemetrySocket: TelemetrySocketService = new WebSocketTelemetryService();
