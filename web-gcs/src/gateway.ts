import { useEffect, useState } from "react";

export type Telemetry = {
  altitude: number;
  absoluteAltitude: number;
  groundSpeed: number;
  airSpeed: number;
  climbRate: number;
  heading: number;
  roll: number;
  pitch: number;
  yaw: number;
  voltage: number;
  current: number;
  battery: number;
  satellites: number;
  hdop: number;
  gpsFixType: number;
  latitude: number;
  longitude: number;
  linkQuality: number;
  throttle: number;
};

export type StatusMessage = {
  timestamp: number;
  severity: number;
  text: string;
};

export type HomePosition = {
  valid: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
};

export type TrackPoint = {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude: number;
};

export type GatewaySnapshot = {
  type: "vehicle_state";
  version: number;
  timestamp: number;
  connection: {
    connected: boolean;
    transportConnected: boolean;
    endpoint: string;
    lastHeartbeatAgeMs: number | null;
  };
  vehicle: {
    systemId: number;
    componentId: number;
    mode: string;
    armed: boolean;
    vehicleType: number;
    autopilot: number;
  };
  telemetry: Telemetry;
  home: HomePosition;
  track: TrackPoint[];
  mission: {
    state: "idle" | "loaded" | "starting" | "active" | "completed" | "failed" | "aborted";
    current: number;
    total: number;
    distanceToWaypoint: number;
  };
  messages: StatusMessage[];
};

export type MonitorEntry = {
  id: number;
  timestamp: number;
  type: string;
  category: "status" | "command" | "mission" | "heartbeat" | "telemetry";
  severity: "error" | "warning" | "info" | "debug";
  text: string;
  sourceSystem: number;
  sourceComponent: number;
};

export type MonitorSnapshot = {
  type: "monitor_console";
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
  entries: MonitorEntry[];
};

const demoTelemetry: Telemetry = {
  altitude: 18.4,
  absoluteAltitude: 423.4,
  groundSpeed: 6.8,
  airSpeed: 0,
  climbRate: 0.2,
  heading: 72,
  roll: -2.4,
  pitch: 1.8,
  yaw: 72,
  voltage: 15.7,
  current: 8.3,
  battery: 76,
  satellites: 17,
  hdop: 0.72,
  gpsFixType: 3,
  latitude: 34.3422,
  longitude: 108.9412,
  linkQuality: 98,
  throttle: 46,
};

const initialSnapshot: GatewaySnapshot = {
  type: "vehicle_state",
  version: 0,
  timestamp: Date.now() / 1000,
  connection: {
    connected: false,
    transportConnected: false,
    endpoint: "等待 MAVLink 网关",
    lastHeartbeatAgeMs: null,
  },
  vehicle: {
    systemId: 0,
    componentId: 0,
    mode: "UNKNOWN",
    armed: false,
    vehicleType: 0,
    autopilot: 0,
  },
  telemetry: { ...demoTelemetry, altitude: 0, absoluteAltitude: 0, groundSpeed: 0, climbRate: 0, battery: -1 },
  home: { valid: false, latitude: 0, longitude: 0, altitude: 0 },
  track: [],
  mission: { state: "idle", current: 0, total: 0, distanceToWaypoint: 0 },
  messages: [],
};

const demoMonitorEntries: MonitorEntry[] = [
  { id: 1, timestamp: Date.now() / 1000 - 8, type: "HEARTBEAT", category: "heartbeat", severity: "info", text: "mode=AUTO armed=true state=ACTIVE", sourceSystem: 1, sourceComponent: 1 },
  { id: 2, timestamp: Date.now() / 1000 - 6, type: "MISSION_CURRENT", category: "mission", severity: "info", text: "seq=2 total=4 mission_state=1", sourceSystem: 1, sourceComponent: 1 },
  { id: 3, timestamp: Date.now() / 1000 - 4, type: "STATUSTEXT", category: "status", severity: "info", text: "INFO · Reached command #1", sourceSystem: 1, sourceComponent: 1 },
  { id: 4, timestamp: Date.now() / 1000 - 2, type: "COMMAND_ACK", category: "command", severity: "info", text: "MISSION_START (300) -> ACCEPTED", sourceSystem: 1, sourceComponent: 1 },
];

const initialMonitorSnapshot: MonitorSnapshot = {
  type: "monitor_console",
  version: 0,
  timestamp: Date.now() / 1000,
  connection: {
    connected: false,
    transportConnected: false,
    endpoint: "udpin:0.0.0.0:14553",
    lastHeartbeatAgeMs: null,
  },
  packetCount: 0,
  messageCounts: {},
  entries: [],
};

export function useVehicleGateway(demoMode: boolean): GatewaySnapshot {
  const [snapshot, setSnapshot] = useState<GatewaySnapshot>(() => demoMode
    ? {
      ...initialSnapshot,
      connection: { connected: true, transportConnected: true, endpoint: "demo", lastHeartbeatAgeMs: 32 },
      vehicle: { ...initialSnapshot.vehicle, systemId: 1, componentId: 1, mode: "AUTO", armed: true },
      telemetry: demoTelemetry,
      home: { valid: true, latitude: 34.3416, longitude: 108.9398, altitude: 405 },
      track: [
        { timestamp: Date.now() / 1000 - 42, latitude: 34.34195, longitude: 108.9407, altitude: 14.2 },
        { timestamp: Date.now() / 1000 - 28, latitude: 34.3421, longitude: 108.9412, altitude: 17.8 },
        { timestamp: Date.now() / 1000 - 12, latitude: 34.3422, longitude: 108.9412, altitude: 18.4 },
      ],
      mission: { state: "active", current: 2, total: 4, distanceToWaypoint: 186 },
    }
    : initialSnapshot);

  useEffect(() => {
    if (demoMode) {
      const timer = window.setInterval(() => {
        setSnapshot((current) => ({
          ...current,
          version: current.version + 1,
          timestamp: Date.now() / 1000,
          telemetry: {
            ...current.telemetry,
            altitude: Math.max(0, current.telemetry.altitude + (Math.random() - 0.48) * 0.08),
            groundSpeed: 6.6 + Math.random() * 0.55,
            climbRate: -0.08 + Math.random() * 0.5,
            heading: (current.telemetry.heading + 0.15) % 360,
            roll: -2.8 + Math.random() * 0.8,
            pitch: 1.4 + Math.random() * 0.7,
            current: 7.9 + Math.random() * 0.8,
          },
        }));
      }, 800);
      return () => window.clearInterval(timer);
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectDelay = 500;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/telemetry`);
      socket.onopen = () => { reconnectDelay = 500; };
      socket.onmessage = (event) => {
        try {
          setSnapshot(JSON.parse(event.data) as GatewaySnapshot);
        } catch {
          socket?.close(1003, "Invalid telemetry payload");
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        setSnapshot((current) => ({
          ...current,
          connection: { ...current.connection, connected: false, transportConnected: false },
        }));
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [demoMode]);

  return snapshot;
}

export function useMavlinkMonitor(demoMode: boolean): MonitorSnapshot {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>(() => demoMode
    ? {
      ...initialMonitorSnapshot,
      version: 1,
      connection: { connected: true, transportConnected: true, endpoint: "udpin:0.0.0.0:14553", lastHeartbeatAgeMs: 38 },
      packetCount: 1842,
      messageCounts: { HEARTBEAT: 82, ATTITUDE: 814, GLOBAL_POSITION_INT: 406, STATUSTEXT: 3, COMMAND_ACK: 2 },
      entries: demoMonitorEntries,
    }
    : initialMonitorSnapshot);

  useEffect(() => {
    if (demoMode) return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectDelay = 500;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/monitor`);
      socket.onopen = () => { reconnectDelay = 500; };
      socket.onmessage = (event) => {
        try {
          setSnapshot(JSON.parse(event.data) as MonitorSnapshot);
        } catch {
          socket?.close(1003, "Invalid monitor payload");
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        setSnapshot((current) => ({
          ...current,
          connection: { ...current.connection, connected: false, transportConnected: false },
        }));
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [demoMode]);

  return snapshot;
}

export async function sendGatewayCommand<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail || `Gateway request failed (${response.status})`);
  }
  return payload as T;
}

export async function getGateway<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const payload = await response.json().catch(() => ({})) as { detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail || `Gateway request failed (${response.status})`);
  }
  return payload as T;
}
