import type { SimulatedDroneState } from '../../types/simulator';
import type { TelemetryConnectionState, TelemetrySample } from '../../types/telemetry';
import type { TelemetryConnectionHandler, TelemetryHandler, TelemetryService } from '../contracts';
import { mockDroneSimulator } from './MockDroneSimulator';

export class MockTelemetryService implements TelemetryService {
  private readonly handlers = new Set<TelemetryHandler>();
  private readonly connectionHandlers = new Set<TelemetryConnectionHandler>();
  private unsubscribeSimulator: (() => void) | null = null;

  connect(): void {
    if (this.unsubscribeSimulator) {
      return;
    }
    this.emitConnection('connecting');
    mockDroneSimulator.start();
    this.unsubscribeSimulator = mockDroneSimulator.subscribe((state) => this.emitTelemetry(state));
    this.emitConnection('connected');
  }

  disconnect(): void {
    this.unsubscribeSimulator?.();
    this.unsubscribeSimulator = null;
    mockDroneSimulator.stop();
    this.emitConnection('disconnected');
  }

  subscribe(handler: TelemetryHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribeToConnectionState(handler: TelemetryConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    handler(this.unsubscribeSimulator ? 'connected' : 'idle');
    return () => this.connectionHandlers.delete(handler);
  }

  private emitTelemetry(state: SimulatedDroneState): void {
    const sample: TelemetrySample = {
      timestamp: Date.now(),
      position: { ...state.position },
      attitude: { ...state.attitude },
      speedMetersPerSecond: state.groundSpeed,
      groundSpeed: state.groundSpeed,
      batteryPercent: state.batteryPercent,
      gpsSatellites: state.gpsSatellites,
      ekfStatus: { ...state.ekfStatus },
      mavlinkStatus: { ...state.mavlinkStatus },
      armed: state.armed,
      mode: state.mode,
      flightState: state.flightState,
      north: state.north,
      east: state.east,
    };
    this.handlers.forEach((handler) => handler(sample));
  }

  private emitConnection(state: TelemetryConnectionState): void {
    this.connectionHandlers.forEach((handler) => handler(state));
  }
}
