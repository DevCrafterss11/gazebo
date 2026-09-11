import { create } from 'zustand';

import { services } from '../services/serviceRegistry';
import type { MoveDirection } from '../types/flight';
import type { TelemetryAvailability } from '../types/telemetry';
import type { SimulatedDroneState } from '../types/simulator';
import { useTrainingStore } from './trainingStore';

interface FlightState {
  status: SimulatedDroneState;
  telemetryAvailability: TelemetryAvailability;
  pendingCommand: string | null;
  commandError: string | null;
  operationErrors: number;
  initialize: () => void;
  arm: () => Promise<void>;
  disarm: () => Promise<void>;
  takeoff: (altitudeMeters: number) => Promise<void>;
  land: () => Promise<void>;
  rtl: () => Promise<void>;
  hold: () => Promise<void>;
  ascend: () => Promise<void>;
  descend: () => Promise<void>;
  move: (direction: MoveDirection) => Promise<void>;
  clearError: () => void;
  setDisconnected: () => void;
  reset: () => void;
}

const initialPosition = { latitude: 34.3416, longitude: 108.9398, altitude: 0 };
const initialState: SimulatedDroneState = {
  armed: false,
  mode: 'GUIDED',
  latitude: initialPosition.latitude,
  longitude: initialPosition.longitude,
  homeLatitude: initialPosition.latitude,
  homeLongitude: initialPosition.longitude,
  altitude: 0,
  north: 0,
  east: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  battery: 100,
  ekfHealthy: true,
  mavlinkConnected: false,
  ekfStatus: { healthy: true, state: 'NORMAL' },
  mavlinkStatus: { connected: false, heartbeat: false, version: 'MAVLink 2' },
  health: { ekfStatus: { healthy: true, state: 'NORMAL' }, mavlinkStatus: { connected: false, heartbeat: false, version: 'MAVLink 2' } },
  position: initialPosition,
  homePosition: initialPosition,
  velocity: { vx: 0, vy: 0, vz: 0 },
  groundSpeed: 0,
  attitude: { roll: 0, pitch: 0, yaw: 0 },
  batteryPercent: 100,
  gpsSatellites: 16,
  ekfOk: true,
  connected: false,
  targetAltitude: 0,
  targetPosition: initialPosition,
  targetYaw: 0,
  flightState: 'grounded',
};

let telemetrySubscription: (() => void) | null = null;
let telemetryConnectionSubscription: (() => void) | null = null;

export const useFlightStore = create<FlightState>((set) => {
  const execute = async (label: string, command: () => Promise<void>): Promise<void> => {
    set({ pendingCommand: label, commandError: null });
    try {
      await command();
      const updatedStatus = services.flight.getState();
      set(updatedStatus ? { status: updatedStatus, pendingCommand: null } : { pendingCommand: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '飞行命令执行失败';
      set((state) => ({
        pendingCommand: null,
        commandError: message,
        operationErrors: state.operationErrors + 1,
      }));
      useTrainingStore.getState().recordSafetyEvent(message);
    }
  };

  return {
    status: initialState,
    telemetryAvailability: 'UNKNOWN',
    pendingCommand: null,
    commandError: null,
    operationErrors: 0,
    initialize: () => {
      if (telemetrySubscription) {
        return;
      }
      telemetrySubscription = services.telemetry.subscribe((sample) => {
        set((state) => ({
          telemetryAvailability: 'AVAILABLE',
          status: {
            ...state.status,
            armed: sample.armed ?? state.status.armed,
            mode: sample.mode === 'STABILIZE' || sample.mode === 'LOITER' || sample.mode === 'RTL' || sample.mode === 'LAND'
              ? sample.mode
              : 'GUIDED',
            position: { ...sample.position },
            groundSpeed: sample.groundSpeed ?? sample.speedMetersPerSecond,
            attitude: { ...sample.attitude },
            batteryPercent: sample.batteryPercent,
            gpsSatellites: sample.gpsSatellites,
            // Keep the flight-domain snapshot aligned with the telemetry domain.
            // This is also used by controls and diagnostics that read flightStore.
            ekfStatus: { ...sample.ekfStatus },
            ekfHealthy: sample.ekfStatus.healthy,
            ekfOk: sample.ekfStatus.healthy,
            mavlinkStatus: { ...sample.mavlinkStatus },
            health: { ekfStatus: { ...sample.ekfStatus }, mavlinkStatus: { ...sample.mavlinkStatus } },
            mavlinkConnected: sample.mavlinkStatus.connected,
            connected: sample.mavlinkStatus.connected,
            latitude: sample.position.latitude,
            longitude: sample.position.longitude,
            altitude: sample.position.altitude,
            north: sample.north ?? state.status.north,
            east: sample.east ?? state.status.east,
            vx: state.status.velocity.vx,
            vy: state.status.velocity.vy,
            vz: state.status.velocity.vz,
            roll: sample.attitude.roll,
            pitch: sample.attitude.pitch,
            yaw: sample.attitude.yaw,
            battery: sample.batteryPercent,
            flightState: sample.flightState === 'taking-off'
              || sample.flightState === 'flying'
              || sample.flightState === 'holding'
              || sample.flightState === 'returning'
              || sample.flightState === 'landing'
              || sample.flightState === 'armed'
              ? sample.flightState
              : 'grounded',
          },
        }));
      });
      telemetryConnectionSubscription = services.telemetry.subscribeToConnectionState((connectionState) => {
        if (connectionState === 'disconnected' || connectionState === 'error') {
          setDisconnectedState(set);
        } else if (connectionState === 'connecting' || connectionState === 'idle') {
          set({ telemetryAvailability: 'UNKNOWN' });
        }
      });
    },
    arm: () => execute('ARM', () => services.flight.arm()),
    disarm: () => execute('DISARM', () => services.flight.disarm()),
    takeoff: (altitudeMeters) => execute('TAKEOFF', () => services.flight.takeoff(altitudeMeters)),
    land: () => execute('LAND', () => services.flight.land()),
    rtl: () => execute('RTL', () => services.flight.rtl()),
    hold: () => execute('HOLD', () => services.flight.hold()),
    ascend: () => execute('ASCEND', () => services.flight.ascend()),
    descend: () => execute('DESCEND', () => services.flight.descend()),
    move: (direction) => {
      const commandMap: Record<MoveDirection, () => Promise<void>> = {
        forward: () => services.flight.moveForward(), backward: () => services.flight.moveBackward(), left: () => services.flight.moveLeft(), right: () => services.flight.moveRight(),
        up: () => services.flight.ascend(), down: () => services.flight.descend(), 'yaw-left': () => services.flight.yawLeft(), 'yaw-right': () => services.flight.yawRight(),
      };
      return execute(direction, commandMap[direction]);
    },
    clearError: () => set({ commandError: null }),
    setDisconnected: () => set((state) => ({
      status: {
        ...state.status,
        connected: false,
        mavlinkConnected: false,
        mavlinkStatus: { ...state.status.mavlinkStatus, connected: false, heartbeat: false },
        health: { ...state.status.health, mavlinkStatus: { ...state.status.health.mavlinkStatus, connected: false, heartbeat: false } },
      },
      pendingCommand: null,
      telemetryAvailability: 'LOST',
    })),
    reset: () => set({
      status: {
        ...initialState,
        position: { ...initialState.position },
        homePosition: { ...initialState.homePosition },
        targetPosition: { ...initialState.targetPosition },
        velocity: { ...initialState.velocity },
        attitude: { ...initialState.attitude },
      },
      pendingCommand: null,
      commandError: null,
      operationErrors: 0,
      telemetryAvailability: 'UNKNOWN',
    }),
  };
});

const setDisconnectedState = (set: (partial: Partial<FlightState> | ((state: FlightState) => Partial<FlightState>)) => void): void => {
  set((state) => ({
    status: {
      ...state.status,
      connected: false,
      mavlinkConnected: false,
      mavlinkStatus: { ...state.status.mavlinkStatus, connected: false, heartbeat: false },
      health: { ...state.status.health, mavlinkStatus: { ...state.status.health.mavlinkStatus, connected: false, heartbeat: false } },
    },
    pendingCommand: null,
    telemetryAvailability: 'LOST',
  }));
};
