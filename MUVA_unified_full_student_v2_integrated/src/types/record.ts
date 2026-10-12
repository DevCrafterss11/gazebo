import type { TrainingTask } from './experiment';
import type { ExperimentResult } from './result';
import type { ExperimentSession } from './session';
import type { TelemetrySample } from './telemetry';
import type { ExperimentOneAssessment } from './experiment1Assessment';

export interface ExperimentTimelineEvent {
  timestamp: string;
  type: 'TRAINING' | 'TASK_COMPLETED' | 'SAFETY';
  message: string;
}

export interface ExperimentRecord {
  id: string;
  session: ExperimentSession;
  result: ExperimentResult;
  assessment?: ExperimentOneAssessment;
  telemetryHistory: TelemetrySample[];
  tasks: TrainingTask[];
  events: string[];
  eventTimeline: ExperimentTimelineEvent[];
  completedAt: string;
}
