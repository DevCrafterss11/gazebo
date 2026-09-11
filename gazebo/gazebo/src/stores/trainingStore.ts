import { create } from 'zustand';

import { TrainingEngine } from '../services/training/TrainingEngine';
import { services } from '../services/serviceRegistry';
import type { FlightParameters, SceneLocation } from '../types/configuration';
import type { TrainingTask } from '../types/experiment';
import type { ExperimentResult } from '../types/result';
import type { ExperimentTimelineEvent } from '../types/record';

interface TrainingState {
  tasks: TrainingTask[];
  activeTaskIndex: number;
  hoverSeconds: number;
  startedAt: number | null;
  maxAltitude: number;
  maxSpeed: number;
  averageAltitudeError: number;
  safetyEvents: string[];
  eventTimeline: ExperimentTimelineEvent[];
  result: ExperimentResult | null;
  initialize: (
    parameters: FlightParameters,
    home: SceneLocation,
    droneName: string,
    sceneName: string,
    onComplete: (result: ExperimentResult) => void,
  ) => void;
  recordSafetyEvent: (message: string) => void;
  reset: () => void;
}

let engine: TrainingEngine | null = null;
let unsubscribeTelemetry: (() => void) | null = null;

const initialTasks: TrainingTask[] = [
  'ARM', '起飞', '悬停 10 秒', '上升至 15m', '下降至 8m', '前进 20m', '右移 15m', '偏航 90°', '执行返航', '安全降落',
].map((title, index) => ({ id: index + 1, title, status: index === 0 ? 'PENDING' : 'LOCKED', goal: '等待训练开始', completionCondition: '由 TrainingEngine 判断', progress: 0 }));

export const useTrainingStore = create<TrainingState>((set) => ({
  tasks: initialTasks,
  activeTaskIndex: 0,
  hoverSeconds: 0,
  startedAt: null,
  maxAltitude: 0,
  maxSpeed: 0,
  averageAltitudeError: 0,
  safetyEvents: [],
  eventTimeline: [],
  result: null,
  initialize: (parameters, home, droneName, sceneName, onComplete) => {
    unsubscribeTelemetry?.();
    engine = new TrainingEngine(parameters, home, droneName, sceneName);
    set({ ...engine.snapshot(), startedAt: Date.now() });
    let completionSent = false;
    unsubscribeTelemetry = services.telemetry.subscribe((sample) => {
      if (!engine) return;
      const snapshot = engine.process(sample);
      set({ ...snapshot });
      if (snapshot.result && !completionSent) {
        completionSent = true;
        onComplete(snapshot.result);
      }
    });
  },
  recordSafetyEvent: (message) => {
    if (!engine) return;
    set({ ...engine.recordSafetyEvent(message) });
  },
  reset: () => {
    unsubscribeTelemetry?.();
    unsubscribeTelemetry = null;
    engine = null;
    set({
      tasks: initialTasks,
      activeTaskIndex: 0,
      hoverSeconds: 0,
      startedAt: null,
      maxAltitude: 0,
      maxSpeed: 0,
      averageAltitudeError: 0,
      safetyEvents: [],
      eventTimeline: [],
      result: null,
    });
  },
}));
