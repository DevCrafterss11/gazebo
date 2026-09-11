import { create } from 'zustand';

import { services } from '../services/serviceRegistry';
import type { TelemetryAvailability, TelemetryConnectionState, TelemetrySample } from '../types/telemetry';

interface TelemetryState {
  samples: TelemetrySample[];
  latest: TelemetrySample | null;
  connectionState: TelemetryConnectionState;
  availability: TelemetryAvailability;
  connect: () => void;
  disconnect: () => void;
  clear: () => void;
}

const maximumBufferedSamples = 300;
let unsubscribeTelemetry: (() => void) | null = null;
let unsubscribeConnection: (() => void) | null = null;

export const useTelemetryStore = create<TelemetryState>((set) => ({
  samples: [],
  latest: null,
  connectionState: 'idle',
  availability: 'UNKNOWN',
  connect: () => {
    if (!unsubscribeTelemetry) {
      unsubscribeTelemetry = services.telemetry.subscribe((sample) => {
        set((state) => ({
          latest: {
            ...sample,
            ekfStatus: { ...sample.ekfStatus },
            mavlinkStatus: { ...sample.mavlinkStatus },
          },
          availability: 'AVAILABLE',
          samples: [...state.samples, {
            ...sample,
            ekfStatus: { ...sample.ekfStatus },
            mavlinkStatus: { ...sample.mavlinkStatus },
          }].slice(-maximumBufferedSamples),
        }));
      });
      unsubscribeConnection = services.telemetry.subscribeToConnectionState((connectionState) => {
        set((state) => ({
          connectionState,
          availability: connectionState === 'connected' ? state.availability : connectionState === 'idle' || connectionState === 'connecting' ? 'UNKNOWN' : 'LOST',
          // A reconnecting or errored stream must not expose stale samples as current data.
          latest: connectionState === 'connected' ? state.latest : null,
        }));
      });
    }
    services.telemetry.connect();
  },
  disconnect: () => {
    services.telemetry.disconnect();
    unsubscribeTelemetry?.();
    unsubscribeConnection?.();
    unsubscribeTelemetry = null;
    unsubscribeConnection = null;
    set((state) => ({
      connectionState: 'disconnected',
      availability: 'LOST',
      latest: null,
    }));
  },
  clear: () => set({ samples: [], latest: null, availability: 'UNKNOWN' }),
}));
