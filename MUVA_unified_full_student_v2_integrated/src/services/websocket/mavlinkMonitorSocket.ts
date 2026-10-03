import type { TelemetryConnectionState } from '../../types/telemetry';

export interface MavlinkMonitorEntry {
  id: number;
  timestamp: number;
  type: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | 'debug' | string;
  direction?: 'TX' | 'RX' | 'LOCAL' | string;
  text: string;
  sourceSystem: number;
  sourceComponent: number;
}

export interface MavlinkMonitorSnapshot {
  type: 'monitor_console';
  version: number;
  timestamp: number;
  connection: {
    connected: boolean;
    transportConnected: boolean;
    endpoint: string;
    lastHeartbeatAgeMs: number | null;
  };
  packetCount: number;
  messageCounts: Record<string, number>;
  entries: MavlinkMonitorEntry[];
}

export type MavlinkMonitorHandler = (snapshot: MavlinkMonitorSnapshot) => void;
export type MavlinkMonitorConnectionHandler = (state: TelemetryConnectionState) => void;

/**
 * Optional diagnostics transport. It is intentionally isolated from flight and
 * telemetry services so a monitor failure can never affect vehicle operation.
 */
export class MavlinkMonitorSocket {
  private readonly handlers = new Set<MavlinkMonitorHandler>();
  private readonly connectionHandlers = new Set<MavlinkMonitorConnectionHandler>();
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;

  constructor(private readonly endpoint = import.meta.env.VITE_MAVLINK_MONITOR_WS_URL ?? 'ws://localhost:8000/ws/mavlink/monitor') {}

  connect(): void {
    this.shouldReconnect = true;
    if (this.socket) return;
    this.emitConnection('connecting');
    const socket = new WebSocket(this.endpoint);
    this.socket = socket;
    socket.onopen = () => this.emitConnection('connected');
    socket.onerror = () => this.emitConnection('error');
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.emitConnection('disconnected');
      if (this.shouldReconnect) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 1500);
      }
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as unknown;
        if (this.isMonitorSnapshot(message)) this.handlers.forEach((handler) => handler(message));
      } catch {
        // Diagnostics are best-effort and malformed messages are ignored.
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
  subscribe(handler: MavlinkMonitorHandler): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  subscribeToConnectionState(handler: MavlinkMonitorConnectionHandler): () => void { this.connectionHandlers.add(handler); return () => this.connectionHandlers.delete(handler); }

  private emitConnection(state: TelemetryConnectionState): void { this.connectionHandlers.forEach((handler) => handler(state)); }
  private isMonitorSnapshot(value: unknown): value is MavlinkMonitorSnapshot {
    if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'monitor_console') return false;
    const snapshot = value as Partial<MavlinkMonitorSnapshot>;
    return typeof snapshot.version === 'number'
      && typeof snapshot.packetCount === 'number'
      && Array.isArray(snapshot.entries)
      && typeof snapshot.connection === 'object'
      && snapshot.connection !== null;
  }
}
