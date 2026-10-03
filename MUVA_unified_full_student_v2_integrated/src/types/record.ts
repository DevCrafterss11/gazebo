import type { TrainingTask } from './experiment';
import type { ExperimentResult } from './result';
import type { ExperimentSession } from './session';
import type { TelemetrySample } from './telemetry';

export interface ExperimentTimelineEvent {
  timestamp: string;
  type: 'TRAINING' | 'TASK_COMPLETED' | 'SAFETY';
  message: string;
}

export interface ExperimentRecord {
  id: string;
  session: ExperimentSession;
  result: ExperimentResult;
  telemetryHistory: TelemetrySample[];
  tasks: TrainingTask[];
  events: string[];
  eventTimeline: ExperimentTimelineEvent[];
  completedAt: string;
}
