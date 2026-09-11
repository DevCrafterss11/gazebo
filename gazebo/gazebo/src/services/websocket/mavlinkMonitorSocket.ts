import type { MavlinkMonitorMessage, TelemetryConnectionState } from '../../types/telemetry';

export type MavlinkMonitorHandler = (message: MavlinkMonitorMessage) => void;
export type MavlinkMonitorConnectionHandler = (state: TelemetryConnectionState) => void;

/**
 * Optional diagnostics transport. It is intentionally isolated from flight and
 * telemetry services so a monitor failure can never affect vehicle operation.
 */
export class MavlinkMonitorSocket {
  private readonly handlers = new Set<MavlinkMonitorHandler>();
  private readonly connectionHandlers = new Set<MavlinkMonitorConnectionHandler>();
  private socket: WebSocket | null = null;

  constructor(private readonly endpoint = import.meta.env.VITE_MAVLINK_MONITOR_WS_URL ?? 'ws://localhost:8000/ws/mavlink/monitor') {}

  connect(): void {
    if (this.socket) return;
    this.emitConnection('connecting');
    this.socket = new WebSocket(this.endpoint);
    this.socket.onopen = () => this.emitConnection('connected');
    this.socket.onerror = () => this.emitConnection('error');
    this.socket.onclose = () => { this.socket = null; this.emitConnection('disconnected'); };
    this.socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as unknown;
        if (this.isMonitorMessage(message)) this.handlers.forEach((handler) => handler(message));
      } catch {
        // Diagnostics are best-effort and malformed messages are ignored.
      }
    };
  }

  disconnect(): void { this.socket?.close(); this.socket = null; }
  subscribe(handler: MavlinkMonitorHandler): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  subscribeToConnectionState(handler: MavlinkMonitorConnectionHandler): () => void { this.connectionHandlers.add(handler); return () => this.connectionHandlers.delete(handler); }

  private emitConnection(state: TelemetryConnectionState): void { this.connectionHandlers.forEach((handler) => handler(state)); }
  private isMonitorMessage(value: unknown): value is MavlinkMonitorMessage {
    return typeof value === 'object' && value !== null
      && 'messageType' in value && 'systemId' in value && 'componentId' in value
      && 'sequence' in value && 'timestamp' in value && 'payload' in value;
  }
}
