import { create } from 'zustand';

import { MavlinkMonitorSocket, type MavlinkMonitorEntry, type MavlinkMonitorSnapshot } from '../services/websocket/mavlinkMonitorSocket';
import type { TelemetryConnectionState } from '../types/telemetry';

interface MavlinkMonitorState {
  entries: MavlinkMonitorEntry[];
  packetCount: number;
  connected: boolean;
  connectionState: TelemetryConnectionState;
  connect: () => void;
  disconnect: () => void;
}

const socket = new MavlinkMonitorSocket();
let subscribed = false;
let unsubscribeSnapshot: (() => void) | null = null;
let unsubscribeConnection: (() => void) | null = null;

export const useMavlinkMonitorStore = create<MavlinkMonitorState>((set) => ({
  entries: [],
  packetCount: 0,
  connected: false,
  connectionState: 'idle',
  connect: () => {
    if (!subscribed) {
      unsubscribeSnapshot = socket.subscribe((snapshot: MavlinkMonitorSnapshot) => set({
        entries: snapshot.entries,
        packetCount: snapshot.packetCount,
        connected: snapshot.connection.connected,
      }));
      unsubscribeConnection = socket.subscribeToConnectionState((connectionState) => set({ connectionState }));
      subscribed = true;
    }
    socket.connect();
  },
  disconnect: () => {
    socket.disconnect();
    unsubscribeSnapshot?.();
    unsubscribeConnection?.();
    unsubscribeSnapshot = null;
    unsubscribeConnection = null;
    subscribed = false;
    set({ connected: false, connectionState: 'disconnected' });
  },
}));
