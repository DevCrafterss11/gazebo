import { create } from 'zustand';

import { services } from '../services/serviceRegistry';
import { mergeFlightMapTrack, validMapCoordinates } from '../domain/flightMap';
import type { FlightPathPoint, TelemetryAvailability, TelemetryConnectionState, TelemetrySample } from '../types/telemetry';

interface TelemetryState {
  samples: TelemetrySample[];
  flightPath: FlightPathPoint[];
  mapHome: { latitude: number; longitude: number; altitude: number } | null;
  latest: TelemetrySample | null;
  connectionState: TelemetryConnectionState;
  availability: TelemetryAvailability;
  mapContextId: string | null;
  mapStartedAt: number | null;
  mapError: string | null;
  setMapContext: (contextId: string, startedAt: number) => void;
  refreshMap: () => Promise<void>;
  connect: () => void;
  disconnect: () => void;
  clear: () => void;
}

const maximumBufferedSamples = 300;
const maximumFlightPathPoints = 600;
let unsubscribeTelemetry: (() => void) | null = null;
let unsubscribeConnection: (() => void) | null = null;
let mapRequestSequence = 0;
let connectionSequence = 0;

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  samples: [],
  flightPath: [],
  mapHome: null,
  latest: null,
  connectionState: 'idle',
  availability: 'UNKNOWN',
  mapContextId: null,
  mapStartedAt: null,
  mapError: null,
  setMapContext: (contextId, startedAt) => {
    if (get().mapContextId === contextId && get().mapStartedAt === startedAt) return;
    get().disconnect();
    get().clear();
    set({ mapContextId: contextId, mapStartedAt: Number.isFinite(startedAt) ? startedAt : Date.now() });
  },
  refreshMap: async () => {
    const requestSequence = ++mapRequestSequence;
    const contextId = get().mapContextId;
    set({ mapError: null });
    try {
      const snapshot = await services.telemetry.getFlightMap();
      if (requestSequence !== mapRequestSequence || contextId !== get().mapContextId) return;
      set((state) => ({
        mapHome: validMapCoordinates(snapshot.home) ? snapshot.home : null,
        flightPath: mergeFlightMapTrack(snapshot.track, state.flightPath, state.mapStartedAt),
      }));
    } catch (error: unknown) {
      if (requestSequence !== mapRequestSequence || contextId !== get().mapContextId) return;
      set({ mapError: error instanceof Error ? `飞行 HOME 与轨迹读取失败：${error.message}` : '飞行 HOME 与轨迹读取失败，请重试' });
    }
  },
  connect: () => {
    if (!unsubscribeTelemetry) {
      const subscriptionSequence = ++connectionSequence;
      void get().refreshMap();
      unsubscribeTelemetry = services.telemetry.subscribe((sample) => {
        if (subscriptionSequence !== connectionSequence || !Number.isFinite(sample.timestamp)
          || (get().mapStartedAt !== null && sample.timestamp < get().mapStartedAt!)) return;
        set((state) => {
          const nextSample = {
            ...sample,
            ekfStatus: { ...sample.ekfStatus },
            mavlinkStatus: { ...sample.mavlinkStatus },
          };
          const hasLocalPosition = sample.mavlinkStatus.connected && sample.mavlinkStatus.heartbeat
            && Number.isFinite(sample.north) && Number.isFinite(sample.east)
            && validMapCoordinates(sample.position);
          const previousPoint = state.flightPath.at(-1);
          const moved = hasLocalPosition && (!previousPoint || Math.hypot(sample.north! - previousPoint.north, sample.east! - previousPoint.east) >= 0.08);
          return {
            latest: nextSample,
            availability: 'AVAILABLE',
            samples: [...state.samples, nextSample].slice(-maximumBufferedSamples),
            flightPath: moved
              ? [...state.flightPath, {
                  latitude: sample.position.latitude,
                  timestamp: sample.timestamp,
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
        if (subscriptionSequence !== connectionSequence) return;
        if (connectionState === 'connected' && get().connectionState !== 'connected') void get().refreshMap();
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
    connectionSequence += 1;
    mapRequestSequence += 1;
    unsubscribeTelemetry?.();
    unsubscribeConnection?.();
    unsubscribeTelemetry = null;
    unsubscribeConnection = null;
    services.telemetry.disconnect();
    set((state) => ({
      connectionState: 'disconnected',
      availability: 'LOST',
      latest: null,
    }));
  },
  clear: () => {
    mapRequestSequence += 1;
    set({ samples: [], flightPath: [], mapHome: null, latest: null, availability: 'UNKNOWN', mapContextId: null, mapStartedAt: null, mapError: null });
  },
}));
