import axios from 'axios';
import { create } from 'zustand';

import { services } from '../services/serviceRegistry';
import type { MissionWaypoint, RouteDraftWaypoint, RoutePlannerPhase } from '../types/mission';
import { useNotificationStore } from './notificationStore';

interface RouteExecutionContext {
  home: { latitude: number; longitude: number };
  armed: boolean;
  vehicleReady: boolean;
  basicTrainingComplete: boolean;
}

interface RoutePlannerState {
  isOpen: boolean;
  phase: RoutePlannerPhase;
  waypoints: RouteDraftWaypoint[];
  altitudeMeters: number;
  error: string | null;
  open: (defaultAltitudeMeters: number) => void;
  close: () => void;
  cancel: () => void;
  addWaypoint: (latitude: number, longitude: number) => void;
  undoWaypoint: () => void;
  clearWaypoints: () => void;
  setAltitude: (altitudeMeters: number) => void;
  execute: (context: RouteExecutionContext) => Promise<void>;
  markCompleted: () => void;
}

let waypointSequence = 0;

const clampAltitude = (value: number): number => Math.min(120, Math.max(2, Number.isFinite(value) ? value : 10));

const errorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail) return detail;
  }
  return error instanceof Error ? error.message : '航线执行失败';
};

export const useRoutePlannerStore = create<RoutePlannerState>((set, get) => ({
  isOpen: false,
  phase: 'IDLE',
  waypoints: [],
  altitudeMeters: 10,
  error: null,
  open: (defaultAltitudeMeters) => set((state) => ({
    isOpen: true,
    phase: state.phase === 'RUNNING' ? 'RUNNING' : 'PLANNING',
    altitudeMeters: state.waypoints.length > 0 ? state.altitudeMeters : clampAltitude(defaultAltitudeMeters),
    error: null,
  })),
  close: () => set({ isOpen: false }),
  cancel: () => set({ isOpen: false, phase: 'IDLE', waypoints: [], error: null }),
  addWaypoint: (latitude, longitude) => set((state) => {
    if ((state.phase !== 'PLANNING' && state.phase !== 'ERROR') || state.waypoints.length >= 20) return state;
    waypointSequence += 1;
    return {
      waypoints: [...state.waypoints, { id: waypointSequence, latitude, longitude }],
      phase: 'PLANNING',
      error: null,
    };
  }),
  undoWaypoint: () => set((state) => ({ waypoints: state.waypoints.slice(0, -1), phase: 'PLANNING', error: null })),
  clearWaypoints: () => set({ waypoints: [], phase: 'PLANNING', error: null }),
  setAltitude: (altitudeMeters) => set({ altitudeMeters: clampAltitude(altitudeMeters), phase: 'PLANNING', error: null }),
  execute: async ({ home, armed, vehicleReady, basicTrainingComplete }) => {
    const { waypoints, altitudeMeters } = get();
    if (!basicTrainingComplete) {
      set({ phase: 'ERROR', error: '请先完成基础飞行训练的全部操作，再规划自定义航线' });
      return;
    }
    if (!vehicleReady) {
      set({ phase: 'ERROR', error: '飞控尚未连接，无法执行航线' });
      return;
    }
    if (waypoints.length === 0) {
      set({ phase: 'ERROR', error: '请至少选择一个航点' });
      return;
    }

    const missionWaypoints: MissionWaypoint[] = [
      { sequence: 0, latitude: home.latitude, longitude: home.longitude, altitudeMeters },
      ...waypoints.map((point, index) => ({
        sequence: index + 1,
        latitude: point.latitude,
        longitude: point.longitude,
        altitudeMeters,
      })),
      { sequence: waypoints.length + 1, latitude: home.latitude, longitude: home.longitude, altitudeMeters: 0 },
    ];

    try {
      set({ phase: 'UPLOADING', error: null });
      await services.missions.uploadMission({ name: `自定义航线 ${new Date().toLocaleTimeString('zh-CN')}`, waypoints: missionWaypoints });
      if (!armed) {
        set({ phase: 'ARMING' });
        await services.flight.arm();
      }
      set({ phase: 'STARTING' });
      await services.missions.startMission();
      set({ phase: 'RUNNING', isOpen: false, error: null });
      useNotificationStore.getState().addNotification({
        title: '自定义航线已启动',
        detail: `已进入 AUTO 模式，依次执行 ${waypoints.length} 个航点后返回 Home 降落。`,
        kind: 'training',
      });
    } catch (error: unknown) {
      set({ phase: 'ERROR', error: errorMessage(error) });
    }
  },
  markCompleted: () => {
    if (get().phase !== 'RUNNING') return;
    set({ phase: 'COMPLETED' });
    useNotificationStore.getState().addNotification({
      title: '自定义航线已完成',
      detail: '无人机已完成航点飞行并降落。',
      kind: 'training',
    });
  },
}));
