import { create } from 'zustand';

import { CollaborationMockRuntime, createInitialMission } from '../services/mock/CollaborationMockRuntime';
import type { CollaborationFailure, CollaborationMode, CollaborationScore, FailureType, Mission } from '../types/collaboration';

const initialScore: CollaborationScore = { completion: 40, duration: 20, coordination: 20, response: 20, total: 92 };
const runtimes = new Map<string, CollaborationMockRuntime>();
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

interface CollaborationState {
  currentStep: number;
  selectedTaskGroup: string;
  selectedDrone: string | null;
  missionState: Mission;
  score: CollaborationScore;
  failure: CollaborationFailure | null;
  isRunning: boolean;
  runningTaskGroupIds: string[];
  elapsedSeconds: number;
  setStep: (step: number) => void;
  selectTaskGroup: (groupId: string) => void;
  selectDrone: (droneId: string | null) => void;
  assignDrone: (droneId: string) => void;
  setMode: (mode: CollaborationMode) => void;
  startExecution: () => void;
  stopExecution: () => void;
  startTaskExecution: (groupId: string) => void;
  stopTaskExecution: (groupId: string) => void;
  injectFailure: (type: FailureType, droneId: string) => void;
  resolveFailure: (action: 'continue' | 'return' | 'end') => void;
  reset: () => void;
}

const createState = () => ({
  currentStep: 0,
  selectedTaskGroup: 'group-search',
  selectedDrone: null,
  missionState: createInitialMission(),
  score: initialScore,
  failure: null,
  isRunning: false,
  runningTaskGroupIds: [],
  elapsedSeconds: 0,
});

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  ...createState(),
  setStep: (step) => set({ currentStep: Math.min(5, Math.max(0, step)) }),
  selectTaskGroup: (groupId) => set({ selectedTaskGroup: groupId, selectedDrone: null }),
  selectDrone: (droneId) => set({ selectedDrone: droneId }),
  assignDrone: (droneId) => set((state) => {
    const target = state.missionState.groups.find((group) => group.id === state.selectedTaskGroup);
    if (!target) return state;
    const targetHasDrone = target.drones.includes(droneId);
    if (!targetHasDrone && target.drones.length >= 3) return state;
    const groups = state.missionState.groups.map((group) => ({ ...group, drones: group.id === target.id ? (targetHasDrone ? group.drones.filter((id) => id !== droneId) : [...group.drones, droneId]) : group.drones.filter((id) => id !== droneId) }));
    const drones = state.missionState.drones.map((drone) => drone.id === droneId ? { ...drone, taskGroupId: target.id } : drone);
    return { missionState: { ...state.missionState, groups, drones } };
  }),
  setMode: (mode) => set((state) => ({ missionState: { ...state.missionState, groups: state.missionState.groups.map((group) => group.id === state.selectedTaskGroup ? { ...group, mode } : group) } })),
  startExecution: () => {
    get().missionState.groups.forEach((group) => get().startTaskExecution(group.id));
    set({ currentStep: 3 });
  },
  stopExecution: () => {
    runtimes.forEach((runtime) => runtime.stop());
    runtimes.clear();
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
    set({ isRunning: false, runningTaskGroupIds: [] });
  },
  startTaskExecution: (groupId) => {
    if (runtimes.has(groupId) || !get().missionState.groups.some((group) => group.id === groupId)) return;
    const runtime = new CollaborationMockRuntime();
    runtime.start(() => get().missionState, (mission) => set({ missionState: mission }), groupId);
    runtimes.set(groupId, runtime);
    const runningTaskGroupIds = [...get().runningTaskGroupIds, groupId];
    set({ isRunning: true, runningTaskGroupIds, currentStep: 3 });
    if (!elapsedTimer) elapsedTimer = setInterval(() => set((state) => ({ elapsedSeconds: state.elapsedSeconds + 1 })), 1000);
  },
  stopTaskExecution: (groupId) => {
    runtimes.get(groupId)?.stop();
    runtimes.delete(groupId);
    const runningTaskGroupIds = get().runningTaskGroupIds.filter((id) => id !== groupId);
    if (!runningTaskGroupIds.length && elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    set({ isRunning: runningTaskGroupIds.length > 0, runningTaskGroupIds });
  },
  injectFailure: (type, droneId) => set((state) => {
    const drone = state.missionState.drones.find((item) => item.id === droneId);
    if (!drone) return state;
    const title = type === 'DISCONNECT' ? '无人机失联' : '无人机低电量';
    const impact = type === 'DISCONNECT' ? '通信异常，影响目标跟踪任务' : '电量不足，影响通信中继任务';
    const missionState = { ...state.missionState, drones: state.missionState.drones.map((item) => item.id === droneId ? { ...item, status: 'FAILED' as const, battery: type === 'LOW_BATTERY' ? 15 : item.battery } : item) };
    return { missionState, failure: { type, droneId, title, impact, resolved: false } };
  }),
  resolveFailure: (action) => set((state) => {
    if (!state.failure) return state;
    const failure = { ...state.failure, resolved: true };
    const missionState = { ...state.missionState, drones: state.missionState.drones.map((drone) => drone.id === state.failure?.droneId ? { ...drone, status: action === 'end' ? 'COMPLETE' as const : 'RUNNING' as const, battery: action === 'return' ? Math.max(drone.battery, 28) : drone.battery } : drone) };
    return { missionState, failure };
  }),
  reset: () => {
    runtimes.forEach((runtime) => runtime.stop());
    runtimes.clear();
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
    set({ ...createState() });
  },
}));
