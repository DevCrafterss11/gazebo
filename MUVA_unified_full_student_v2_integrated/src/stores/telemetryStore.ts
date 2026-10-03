import { create } from 'zustand';

import { services } from '../services/serviceRegistry';
import type { FlightPathPoint, TelemetryAvailability, TelemetryConnectionState, TelemetrySample } from '../types/telemetry';

interface TelemetryState {
  samples: TelemetrySample[];
  flightPath: FlightPathPoint[];
  mapHome: { latitude: number; longitude: number; altitude: number } | null;
  latest: TelemetrySample | null;
  connectionState: TelemetryConnectionState;
  availability: TelemetryAvailability;
  connect: () => void;
  disconnect: () => void;
  clear: () => void;
}

const maximumBufferedSamples = 300;
const maximumFlightPathPoints = 600;
let unsubscribeTelemetry: (() => void) | null = null;
let unsubscribeConnection: (() => void) | null = null;

export const useTelemetryStore = create<TelemetryState>((set) => ({
  samples: [],
  flightPath: [],
  mapHome: null,
  latest: null,
  connectionState: 'idle',
  availability: 'UNKNOWN',
  connect: () => {
    if (!unsubscribeTelemetry) {
      void services.telemetry.getFlightMap().then((mapSnapshot) => {
        set((state) => ({
          mapHome: mapSnapshot.home,
          flightPath: [...mapSnapshot.track, ...state.flightPath].slice(-maximumFlightPathPoints),
        }));
      }).catch((error: unknown) => {
        console.error('Failed to restore backend flight track', error);
      });
      unsubscribeTelemetry = services.telemetry.subscribe((sample) => {
        set((state) => {
          const nextSample = {
            ...sample,
            ekfStatus: { ...sample.ekfStatus },
            mavlinkStatus: { ...sample.mavlinkStatus },
          };
          const hasLocalPosition = Number.isFinite(sample.north) && Number.isFinite(sample.east)
            && Number.isFinite(sample.position.latitude) && Number.isFinite(sample.position.longitude);
          const previousPoint = state.flightPath.at(-1);
          const moved = hasLocalPosition && (!previousPoint || Math.hypot(sample.north! - previousPoint.north, sample.east! - previousPoint.east) >= 0.08);
          return {
            latest: nextSample,
            availability: 'AVAILABLE',
            samples: [...state.samples, nextSample].slice(-maximumBufferedSamples),
            flightPath: moved
              ? [...state.flightPath, {
                  latitude: sample.position.latitude,
                  longitude: sample.position.longitude,
                  altitude: sample.position.altitude,
                  north: sample.north!,
                  east: sample.east!,
                }].slice(-maximumFlightPathPoints)
              : state.flightPath,
          };
        });
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
  clear: () => set({ samples: [], flightPath: [], mapHome: null, latest: null, availability: 'UNKNOWN' }),
}));
